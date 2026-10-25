'use strict';
// Send engine: mailbox registry, daily caps with ramp + jitter, business-hours windows, durable SQLite queue,
// retry/backoff, workspace-wide suppression gate and a per-mailbox circuit breaker.
// Nothing in here composes copy; it only moves already-approved messages safely.
const crypto = require('node:crypto');

const DAY_MS = 86400000;
const RETRY_BACKOFF_MS = [60e3, 5 * 60e3, 30 * 60e3, 2 * 3600e3, 6 * 3600e3];
const DEFAULT_POLICY = {
  timezone: 'Africa/Johannesburg',
  windowStart: '08:30', windowEnd: '16:30',
  sendDays: [1, 2, 3, 4, 5],          // Mon–Fri
  preferredDays: [2, 3, 4],           // Tue–Thu get first pick when a slot is chosen
  minGapSeconds: 90, jitterSeconds: 240,
  defaultDailyCap: 25,
  ramp: [5, 10, 15, 20],              // caps for week 1..4 of a new mailbox, then the full cap
  breaker: { minSample: 20, hardBounceRate: 0.02, complaintRate: 0.001, windowDays: 7, softBounceRate: 0.08 }
};
const PERMANENT_SMTP = /\b(5[0-5]\d)\b|user unknown|no such user|does not exist|mailbox unavailable|recipient rejected|address rejected|invalid recipient|unrouteable|domain not found/i;
const RATE_LIMIT_SMTP = /\b4[25]\d\b|rate ?limit|too many|try again later|throttl|temporarily deferred|quota/i;

function uid(prefix) { return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`; }
function hhmm(value, fallback) { return /^\d{2}:\d{2}$/.test(String(value || '')) ? value : fallback; }
function toMinutes(h) { const [a, b] = h.split(':').map(Number); return a * 60 + b; }

// Local wall-clock parts for an instant in a given IANA timezone (no deps).
function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]));
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second), dow, dateKey: `${parts.year}-${parts.month}-${parts.day}` };
}
function zoneOffsetMs(date, timeZone) {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}
// Instant for local date (dateKey) + minutes-of-day in timeZone.
function zonedInstant(dateKey, minutes, timeZone) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60));
  return new Date(guess.getTime() - zoneOffsetMs(guess, timeZone));
}

function normalisePolicy(raw = {}) {
  const p = { ...DEFAULT_POLICY, ...raw, breaker: { ...DEFAULT_POLICY.breaker, ...(raw.breaker || {}) } };
  p.windowStart = hhmm(p.windowStart, DEFAULT_POLICY.windowStart); p.windowEnd = hhmm(p.windowEnd, DEFAULT_POLICY.windowEnd);
  if (toMinutes(p.windowEnd) <= toMinutes(p.windowStart)) { p.windowStart = DEFAULT_POLICY.windowStart; p.windowEnd = DEFAULT_POLICY.windowEnd; }
  p.sendDays = [...new Set((Array.isArray(p.sendDays) ? p.sendDays : DEFAULT_POLICY.sendDays).map(Number).filter(n => n >= 0 && n <= 6))];
  if (!p.sendDays.length) p.sendDays = DEFAULT_POLICY.sendDays;
  p.preferredDays = (Array.isArray(p.preferredDays) ? p.preferredDays : DEFAULT_POLICY.preferredDays).map(Number).filter(n => p.sendDays.includes(n));
  p.minGapSeconds = Math.min(900, Math.max(20, Number(p.minGapSeconds) || DEFAULT_POLICY.minGapSeconds));
  p.jitterSeconds = Math.min(1800, Math.max(0, Number(p.jitterSeconds) || 0));
  p.defaultDailyCap = Math.min(500, Math.max(1, Number(p.defaultDailyCap) || DEFAULT_POLICY.defaultDailyCap));
  p.ramp = (Array.isArray(p.ramp) ? p.ramp : DEFAULT_POLICY.ramp).map(Number).filter(n => n > 0).slice(0, 8);
  try { new Intl.DateTimeFormat('en-US', { timeZone: p.timezone }); } catch { p.timezone = DEFAULT_POLICY.timezone; }
  return p;
}

module.exports = function createSendEngine({ conn, encryptSecret, decryptSecret, transportFactory, isSuppressed, now = () => new Date(), log = () => {}, random = Math.random }) {
  if (!conn) throw new Error('send-engine needs a SQLite connection');
  conn.exec(`
    CREATE TABLE IF NOT EXISTS mailboxes (
      id TEXT PRIMARY KEY, pos INTEGER NOT NULL DEFAULT 0, label TEXT NOT NULL DEFAULT '',
      from_email TEXT NOT NULL, from_name TEXT NOT NULL DEFAULT '', host TEXT NOT NULL, port INTEGER NOT NULL DEFAULT 587,
      secure INTEGER NOT NULL DEFAULT 0, username TEXT NOT NULL DEFAULT '', password_json TEXT,
      daily_cap INTEGER NOT NULL DEFAULT 25, ramp_enabled INTEGER NOT NULL DEFAULT 1, ramp_started_at TEXT NOT NULL DEFAULT '',
      dkim_selector TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active', paused_reason TEXT NOT NULL DEFAULT '', paused_at TEXT NOT NULL DEFAULT '',
      health_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS send_jobs (
      id TEXT PRIMARY KEY, mailbox_id TEXT NOT NULL, lead_id TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'initial',
      to_email TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '', payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0, scheduled_at TEXT NOT NULL, local_day TEXT NOT NULL DEFAULT '',
      last_error TEXT NOT NULL DEFAULT '', error_class TEXT NOT NULL DEFAULT '', provider_message_id TEXT NOT NULL DEFAULT '',
      requested_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, sent_at TEXT NOT NULL DEFAULT '', result_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_send_jobs_due ON send_jobs(status, scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_send_jobs_mailbox_day ON send_jobs(mailbox_id, local_day);
    CREATE INDEX IF NOT EXISTS idx_send_jobs_lead ON send_jobs(lead_id);
    CREATE TABLE IF NOT EXISTS send_attempts (
      id TEXT PRIMARY KEY, job_id TEXT NOT NULL, mailbox_id TEXT NOT NULL, attempted_at TEXT NOT NULL, ok INTEGER NOT NULL, error_class TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_send_attempts_job ON send_attempts(job_id);
    CREATE TABLE IF NOT EXISTS delivery_signals (
      id TEXT PRIMARY KEY, mailbox_id TEXT NOT NULL DEFAULT '', job_id TEXT NOT NULL DEFAULT '', lead_id TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', occurred_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_signals_mailbox ON delivery_signals(mailbox_id, occurred_at);
  `);

  const q = {
    insertMailbox: conn.prepare(`INSERT INTO mailboxes (id,pos,label,from_email,from_name,host,port,secure,username,password_json,daily_cap,ramp_enabled,ramp_started_at,dkim_selector,status,paused_reason,paused_at,health_json,created_at,updated_at)
      VALUES (@id,@pos,@label,@from_email,@from_name,@host,@port,@secure,@username,@password_json,@daily_cap,@ramp_enabled,@ramp_started_at,@dkim_selector,@status,@paused_reason,@paused_at,@health_json,@created_at,@updated_at)`),
    updateMailbox: conn.prepare(`UPDATE mailboxes SET pos=@pos,created_at=@created_at,label=@label,from_email=@from_email,from_name=@from_name,host=@host,port=@port,secure=@secure,username=@username,password_json=@password_json,daily_cap=@daily_cap,ramp_enabled=@ramp_enabled,ramp_started_at=@ramp_started_at,dkim_selector=@dkim_selector,status=@status,paused_reason=@paused_reason,paused_at=@paused_at,health_json=@health_json,updated_at=@updated_at WHERE id=@id`),
    allMailboxes: conn.prepare('SELECT * FROM mailboxes ORDER BY pos ASC, created_at ASC'),
    mailbox: conn.prepare('SELECT * FROM mailboxes WHERE id = ?'),
    deleteMailbox: conn.prepare('DELETE FROM mailboxes WHERE id = ?'),
    maxPos: conn.prepare('SELECT COALESCE(MAX(pos),0) AS p FROM mailboxes'),
    insertJob: conn.prepare(`INSERT INTO send_jobs (id,mailbox_id,lead_id,kind,to_email,subject,payload_json,status,attempts,scheduled_at,local_day,requested_by,created_at,updated_at)
      VALUES (@id,@mailbox_id,@lead_id,@kind,@to_email,@subject,@payload_json,@status,0,@scheduled_at,@local_day,@requested_by,@created_at,@updated_at)`),
    job: conn.prepare('SELECT * FROM send_jobs WHERE id = ?'),
    dueJobs: conn.prepare("SELECT * FROM send_jobs WHERE status = 'queued' AND scheduled_at <= ? ORDER BY scheduled_at ASC LIMIT ?"),
    claim: conn.prepare("UPDATE send_jobs SET status = 'sending', updated_at = ? WHERE id = ? AND status = 'queued'"),
    finishJob: conn.prepare('UPDATE send_jobs SET status=@status, attempts=@attempts, scheduled_at=@scheduled_at, local_day=@local_day, last_error=@last_error, error_class=@error_class, provider_message_id=@provider_message_id, sent_at=@sent_at, result_json=@result_json, updated_at=@updated_at WHERE id=@id'),
    setStatus: conn.prepare("UPDATE send_jobs SET status=?, last_error=?, updated_at=? WHERE id=? AND status IN ('queued','held','failed','sending')"),
    reschedule: conn.prepare("UPDATE send_jobs SET status='queued', scheduled_at=?, local_day=?, updated_at=?, last_error='' WHERE id=? AND status IN ('held','failed','dead','queued')"),
    dayCount: conn.prepare("SELECT COUNT(*) AS n FROM send_jobs WHERE mailbox_id = ? AND local_day = ? AND status IN ('queued','sending','sent')"),
    daySentCount: conn.prepare("SELECT COUNT(*) AS n FROM send_jobs WHERE mailbox_id = ? AND local_day = ? AND status = 'sent'"),
    lastScheduled: conn.prepare("SELECT MAX(scheduled_at) AS t FROM send_jobs WHERE mailbox_id = ? AND local_day = ? AND status IN ('queued','sending','sent')"),
    recentJobs: conn.prepare('SELECT * FROM send_jobs ORDER BY CASE status WHEN \'sending\' THEN 0 WHEN \'queued\' THEN 1 WHEN \'held\' THEN 2 WHEN \'failed\' THEN 3 ELSE 4 END, scheduled_at DESC LIMIT ?'),
    jobsForLead: conn.prepare('SELECT * FROM send_jobs WHERE lead_id = ? ORDER BY created_at DESC LIMIT 20'),
    insertAttempt: conn.prepare('INSERT INTO send_attempts (id,job_id,mailbox_id,attempted_at,ok,error_class,detail) VALUES (?,?,?,?,?,?,?)'),
    insertSignal: conn.prepare('INSERT INTO delivery_signals (id,mailbox_id,job_id,lead_id,type,detail,occurred_at) VALUES (?,?,?,?,?,?,?)'),
    signalCounts: conn.prepare('SELECT type, COUNT(*) AS n FROM delivery_signals WHERE mailbox_id = ? AND occurred_at >= ? GROUP BY type'),
    sentSince: conn.prepare("SELECT COUNT(*) AS n FROM send_jobs WHERE mailbox_id = ? AND status = 'sent' AND sent_at >= ?"),
    queueCounts: conn.prepare('SELECT status, COUNT(*) AS n FROM send_jobs GROUP BY status'),
    jobByProviderId: conn.prepare('SELECT * FROM send_jobs WHERE provider_message_id = ? LIMIT 1'),
    seriesSince: conn.prepare("SELECT local_day AS day, mailbox_id, status, COUNT(*) AS n FROM send_jobs WHERE local_day >= ? GROUP BY local_day, mailbox_id, status"),
    staleSending: conn.prepare("UPDATE send_jobs SET status='queued', updated_at=? WHERE status='sending' AND updated_at < ?")
  };

  let policy = normalisePolicy();
  let onSent = () => {}; let onDead = () => {}; let onPaused = () => {};

  // ---------- mailboxes ----------
  function rowToMailbox(row, { secrets = false } = {}) {
    if (!row) return null;
    const m = {
      id: row.id, label: row.label, fromEmail: row.from_email, fromName: row.from_name, host: row.host, port: row.port, secure: Boolean(row.secure), username: row.username,
      hasPassword: Boolean(row.password_json), dailyCap: row.daily_cap, rampEnabled: Boolean(row.ramp_enabled), rampStartedAt: row.ramp_started_at,
      dkimSelector: row.dkim_selector, status: row.status, pausedReason: row.paused_reason, pausedAt: row.paused_at,
      health: safeJson(row.health_json, {}), createdAt: row.created_at, updatedAt: row.updated_at, domain: row.from_email.split('@')[1] || ''
    };
    if (secrets) m.password = row.password_json ? decryptSecret(JSON.parse(row.password_json)) : '';
    return m;
  }
  function safeJson(text, fallback) { try { return JSON.parse(text); } catch { return fallback; } }
  function listMailboxes() { return q.allMailboxes.all().map(r => decorate(rowToMailbox(r))); }
  function getMailbox(id, opts) { return rowToMailbox(q.mailbox.get(id), opts); }
  function decorate(m) {
    if (!m) return m;
    const today = zonedParts(now(), policy.timezone).dateKey;
    const used = q.dayCount.get(m.id, today).n;
    const cap = effectiveCap(m);
    const breaker = breakerState(m.id);
    return { ...m, today: { used, cap, remaining: Math.max(0, cap - used), day: today }, rampWeek: rampWeek(m), breaker };
  }
  function rampWeek(m) {
    if (!m.rampEnabled || !m.rampStartedAt) return null;
    const days = Math.floor((now().getTime() - new Date(m.rampStartedAt).getTime()) / DAY_MS);
    return Math.floor(Math.max(0, days) / 7) + 1;
  }
  function effectiveCap(m) {
    const cap = m.dailyCap || policy.defaultDailyCap;
    const week = rampWeek(m);
    if (!week || week > policy.ramp.length) return cap;
    return Math.min(cap, policy.ramp[week - 1]);
  }
  function saveMailbox(input, { actor = 'system' } = {}) {
    const t = now().toISOString();
    const existing = input.id ? q.mailbox.get(input.id) : null;
    const fromEmail = String(input.fromEmail || existing?.from_email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail)) throw new Error('A valid From email is required.');
    const host = String(input.host ?? existing?.host ?? '').trim();
    if (!host) throw new Error('SMTP host is required.');
    const port = Number(input.port ?? existing?.port ?? 587);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SMTP port must be 1–65535.');
    const row = {
      id: existing?.id || uid('mbx'), pos: existing?.pos ?? (q.maxPos.get().p + 1),
      label: String(input.label ?? existing?.label ?? fromEmail).trim().slice(0, 80) || fromEmail,
      from_email: fromEmail, from_name: String(input.fromName ?? existing?.from_name ?? 'Chelo Partnerships Team').trim().slice(0, 120),
      host: host.slice(0, 253), port, secure: (input.secure ?? (existing ? Boolean(existing.secure) : port === 465)) ? 1 : 0,
      username: String(input.username ?? existing?.username ?? '').trim().slice(0, 250),
      password_json: input.password ? JSON.stringify(encryptSecret(String(input.password))) : (input.clearPassword ? null : existing?.password_json || null),
      daily_cap: Math.min(500, Math.max(1, Number(input.dailyCap ?? existing?.daily_cap ?? policy.defaultDailyCap) || policy.defaultDailyCap)),
      ramp_enabled: (input.rampEnabled ?? (existing ? Boolean(existing.ramp_enabled) : true)) ? 1 : 0,
      ramp_started_at: existing?.ramp_started_at || t,
      dkim_selector: String(input.dkimSelector ?? existing?.dkim_selector ?? '').trim().slice(0, 60),
      status: existing?.status || 'active', paused_reason: existing?.paused_reason || '', paused_at: existing?.paused_at || '',
      health_json: existing?.health_json || '{}', created_at: existing?.created_at || t, updated_at: t
    };
    if (input.restartRamp) row.ramp_started_at = t;
    if (existing) q.updateMailbox.run(row); else q.insertMailbox.run(row);
    log(`mailbox ${existing ? 'updated' : 'created'} ${row.from_email} by ${actor}`);
    return decorate(rowToMailbox(q.mailbox.get(row.id)));
  }
  function deleteMailbox(id) { q.deleteMailbox.run(id); }
  function setMailboxStatus(id, status, reason = '') {
    const row = q.mailbox.get(id); if (!row) throw new Error('Mailbox not found.');
    const t = now().toISOString();
    q.updateMailbox.run({ ...row, status, paused_reason: status === 'paused' ? String(reason).slice(0, 200) : '', paused_at: status === 'paused' ? t : '', updated_at: t });
    if (status === 'paused') onPaused(rowToMailbox(q.mailbox.get(id)), reason);
    return decorate(rowToMailbox(q.mailbox.get(id)));
  }
  function setMailboxHealth(id, health) {
    const row = q.mailbox.get(id); if (!row) return null;
    q.updateMailbox.run({ ...row, health_json: JSON.stringify(health || {}), updated_at: now().toISOString() });
    if (health && health.status === 'fail' && row.status === 'active') setMailboxStatus(id, 'paused', `auto: domain authentication failing (${health.issues.map(i => i.title).join(', ')})`);
    return decorate(rowToMailbox(q.mailbox.get(id)));
  }
  function pickMailbox(preferredId) {
    const boxes = listMailboxes().filter(m => m.status === 'active');
    if (preferredId) { const hit = boxes.find(m => m.id === preferredId); if (hit) return hit; }
    // Most remaining capacity today first, then least recently created.
    return boxes.sort((a, b) => b.today.remaining - a.today.remaining)[0] || null;
  }

  // ---------- scheduling ----------
  function slotFor(mailbox, from = now()) {
    const tz = policy.timezone; const start = toMinutes(policy.windowStart); const end = toMinutes(policy.windowEnd);
    const cap = effectiveCap(mailbox);
    for (let dayOffset = 0; dayOffset < 21; dayOffset += 1) {
      const probe = new Date(from.getTime() + dayOffset * DAY_MS);
      const parts = zonedParts(probe, tz);
      if (!policy.sendDays.includes(parts.dow)) continue;
      const used = q.dayCount.get(mailbox.id, parts.dateKey).n;
      if (used >= cap) continue;
      const windowOpen = zonedInstant(parts.dateKey, start, tz); const windowClose = zonedInstant(parts.dateKey, end, tz);
      const lastT = q.lastScheduled.get(mailbox.id, parts.dateKey).t;
      const gap = policy.minGapSeconds * 1000 + Math.floor(random() * policy.jitterSeconds * 1000);
      let candidate = new Date(Math.max(dayOffset === 0 ? from.getTime() : windowOpen.getTime(), windowOpen.getTime(), lastT ? new Date(lastT).getTime() + gap : 0));
      if (dayOffset === 0 && from.getTime() >= windowOpen.getTime() && candidate.getTime() === from.getTime()) candidate = new Date(candidate.getTime() + Math.floor(random() * Math.min(policy.jitterSeconds, 45) * 1000));
      if (candidate.getTime() >= windowClose.getTime()) continue;
      return { at: candidate, localDay: parts.dateKey, cap, used, preferredDay: policy.preferredDays.includes(parts.dow) };
    }
    return null;
  }

  // ---------- queue ----------
  function enqueue({ leadId = '', kind = 'initial', to, subject, text, html, headers = {}, attachments = [], mailboxId = '', requestedBy = '', sendAt = null, meta = {} }) {
    const toEmail = String(to || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) throw Object.assign(new Error('Recipient address is not valid.'), { code: 'invalid_recipient' });
    if (isSuppressed && isSuppressed(toEmail)) throw Object.assign(new Error('Recipient is on the workspace suppression list (opt-out, bounce or do-not-contact).'), { code: 'suppressed' });
    const mailbox = pickMailbox(mailboxId);
    if (!mailbox) throw Object.assign(new Error('No active sending mailbox. Add one under Deliverability or resume a paused mailbox.'), { code: 'no_mailbox' });
    if (mailbox.health && mailbox.health.status === 'fail') throw Object.assign(new Error(`Mailbox ${mailbox.fromEmail} is blocked: domain authentication is failing.`), { code: 'domain_health' });
    const slot = sendAt ? { at: new Date(sendAt), localDay: zonedParts(new Date(sendAt), policy.timezone).dateKey } : slotFor(mailbox);
    if (!slot) throw Object.assign(new Error('No sending capacity in the next three weeks for this mailbox.'), { code: 'no_capacity' });
    const t = now().toISOString();
    const job = {
      id: uid('job'), mailbox_id: mailbox.id, lead_id: leadId, kind, to_email: toEmail, subject: String(subject || '').slice(0, 500),
      payload_json: JSON.stringify({ text, html, headers, attachments, meta }), status: 'queued', scheduled_at: slot.at.toISOString(), local_day: slot.localDay,
      requested_by: requestedBy, created_at: t, updated_at: t
    };
    q.insertJob.run(job);
    return getJob(job.id);
  }
  function rowToJob(r) { if (!r) return null; const payload = safeJson(r.payload_json, {}); return { id: r.id, mailboxId: r.mailbox_id, leadId: r.lead_id, kind: r.kind, to: r.to_email, subject: r.subject, status: r.status, attempts: r.attempts, scheduledAt: r.scheduled_at, localDay: r.local_day, lastError: r.last_error, errorClass: r.error_class, providerMessageId: r.provider_message_id, requestedBy: r.requested_by, createdAt: r.created_at, updatedAt: r.updated_at, sentAt: r.sent_at, meta: payload.meta || {}, result: safeJson(r.result_json, {}) }; }
  function getJob(id) { return rowToJob(q.job.get(id)); }
  function jobsForLead(leadId) { return q.jobsForLead.all(leadId).map(rowToJob); }
  function cancelJob(id, reason = 'cancelled by staff') { q.setStatus.run('cancelled', reason, now().toISOString(), id); return getJob(id); }
  function retryJob(id) {
    const job = getJob(id); if (!job) throw new Error('Job not found.');
    const mailbox = getMailbox(job.mailboxId); if (!mailbox || mailbox.status !== 'active') throw new Error('Mailbox is not active.');
    const slot = slotFor(mailbox); if (!slot) throw new Error('No capacity available.');
    q.reschedule.run(slot.at.toISOString(), slot.localDay, now().toISOString(), id);
    return getJob(id);
  }
  function classifyError(err) {
    const msg = String(err?.response || err?.message || err || '');
    const code = Number(err?.responseCode || (msg.match(/\b([45]\d\d)\b/) || [])[1] || 0);
    if (err?.code === 'EAUTH' || code === 535 || /\bEAUTH\b|authentication (failed|unsuccessful|required)|invalid login|username and password/i.test(msg)) return { cls: 'auth', detail: msg.slice(0, 300) };
    if (code >= 500 || (PERMANENT_SMTP.test(msg) && !RATE_LIMIT_SMTP.test(msg))) return { cls: 'permanent', detail: msg.slice(0, 300) };
    if (code >= 400 || RATE_LIMIT_SMTP.test(msg)) return { cls: 'rate_limited', detail: msg.slice(0, 300) };
    return { cls: 'transient', detail: msg.slice(0, 300) };
  }

  async function processJob(jobRow) {
    const t = now().toISOString();
    if (q.claim.run(t, jobRow.id).changes !== 1) return null; // someone else took it
    const job = rowToJob(jobRow);
    const mailbox = getMailbox(job.mailboxId, { secrets: true });
    const finish = (patch) => { q.finishJob.run({ id: job.id, attempts: job.attempts, scheduled_at: job.scheduled_at || jobRow.scheduled_at, local_day: jobRow.local_day, last_error: '', error_class: '', provider_message_id: '', sent_at: '', result_json: '{}', status: 'failed', ...patch, updated_at: now().toISOString() }); return getJob(job.id); };
    const hold = (reason) => finish({ status: 'held', last_error: reason, error_class: 'held' });
    if (!mailbox) return finish({ status: 'dead', last_error: 'Mailbox no longer exists.', error_class: 'config' });
    if (mailbox.status !== 'active') return hold(`Mailbox paused: ${mailbox.pausedReason || 'manual'}`);
    if (isSuppressed && isSuppressed(job.to)) return finish({ status: 'cancelled', last_error: 'Recipient became suppressed before sending.', error_class: 'suppressed' });
    if (q.daySentCount.get(mailbox.id, jobRow.local_day).n >= effectiveCap(mailbox)) { const slot = slotFor(decorate(mailbox), new Date(now().getTime() + DAY_MS)); return finish({ status: 'queued', scheduled_at: slot ? slot.at.toISOString() : jobRow.scheduled_at, local_day: slot ? slot.localDay : jobRow.local_day, last_error: 'Daily cap reached; moved to next slot.', error_class: 'cap' }); }
    const payload = safeJson(jobRow.payload_json, {});
    let transport;
    const attempts = job.attempts + 1;
    try {
      transport = transportFactory(mailbox);
      const info = await transport.sendMail({
        from: { name: mailbox.fromName, address: mailbox.fromEmail }, to: job.to, subject: job.subject, text: payload.text, html: payload.html, headers: payload.headers || {},
        attachments: (payload.attachments || []).map(a => a.path ? { filename: a.filename, path: a.path, contentType: a.contentType } : a)
      });
      if (!info || !info.accepted || !info.accepted.length) throw Object.assign(new Error(`SMTP did not accept the recipient (${(info?.rejected || []).join(', ') || 'no accepted recipients'})`), { responseCode: 550 });
      q.insertAttempt.run(uid('att'), job.id, mailbox.id, now().toISOString(), 1, '', String(info.response || '').slice(0, 200));
      const done = finish({ status: 'sent', attempts, sent_at: now().toISOString(), provider_message_id: String(info.messageId || '').slice(0, 250), result_json: JSON.stringify({ response: String(info.response || '').slice(0, 200), accepted: info.accepted }) });
      try { onSent(done, { mailbox: rowToMailbox(q.mailbox.get(mailbox.id)), info }); } catch (err) { log(`onSent hook failed: ${err.message}`); }
      return done;
    } catch (err) {
      const { cls, detail } = classifyError(err);
      q.insertAttempt.run(uid('att'), job.id, mailbox.id, now().toISOString(), 0, cls, detail);
      if (cls === 'permanent') {
        recordSignal({ mailboxId: mailbox.id, jobId: job.id, leadId: job.leadId, type: 'hard_bounce', detail });
        const dead = finish({ status: 'dead', attempts, last_error: detail, error_class: cls });
        try { onDead(dead, { mailbox, error: detail, cls }); } catch (e) { log(`onDead hook failed: ${e.message}`); }
        evaluateBreaker(mailbox.id);
        return dead;
      }
      if (cls === 'auth') { setMailboxStatus(mailbox.id, 'paused', `auto: SMTP authentication failed (${detail.slice(0, 80)})`); return finish({ status: 'held', attempts, last_error: detail, error_class: cls }); }
      if (attempts > RETRY_BACKOFF_MS.length) { const dead = finish({ status: 'dead', attempts, last_error: detail, error_class: cls }); try { onDead(dead, { mailbox, error: detail, cls }); } catch {} return dead; }
      const backoff = RETRY_BACKOFF_MS[attempts - 1] * (cls === 'rate_limited' ? 2 : 1);
      const next = new Date(now().getTime() + backoff);
      return finish({ status: 'queued', attempts, scheduled_at: next.toISOString(), local_day: zonedParts(next, policy.timezone).dateKey, last_error: detail, error_class: cls });
    } finally {
      try { transport && transport.close && transport.close(); } catch {}
    }
  }

  let ticking = false;
  async function tick({ limit = 10, onlyJobId = null } = {}) {
    if (ticking) return { ran: 0, skipped: 'busy' };
    ticking = true;
    try {
      q.staleSending.run(now().toISOString(), new Date(now().getTime() - 10 * 60e3).toISOString()); // crash recovery
      const rows = onlyJobId ? [q.job.get(onlyJobId)].filter(r => r && r.status === 'queued' && r.scheduled_at <= now().toISOString()) : q.dueJobs.all(now().toISOString(), limit);
      const results = [];
      for (const row of rows) results.push(await processJob(row));
      return { ran: results.filter(Boolean).length, results: results.filter(Boolean) };
    } finally { ticking = false; }
  }

  // ---------- signals & breaker ----------
  function recordSignal({ mailboxId = '', jobId = '', leadId = '', type, detail = '' }) {
    q.insertSignal.run(uid('sig'), mailboxId, jobId, leadId, type, String(detail).slice(0, 300), now().toISOString());
    if (mailboxId) evaluateBreaker(mailboxId);
  }
  function breakerState(mailboxId) {
    const since = new Date(now().getTime() - policy.breaker.windowDays * DAY_MS).toISOString();
    const sent = q.sentSince.get(mailboxId, since).n;
    const counts = Object.fromEntries(q.signalCounts.all(mailboxId, since).map(r => [r.type, r.n]));
    const hard = counts.hard_bounce || 0; const soft = counts.soft_bounce || 0; const complaints = (counts.complaint || 0) + (counts.unsubscribe || 0);
    const attempted = sent + hard; // dead-on-send jobs never reach 'sent', so count them in the denominator
    const rates = { hardBounce: attempted ? hard / attempted : 0, softBounce: attempted ? soft / attempted : 0, complaint: sent ? complaints / sent : 0 };
    const sampled = attempted >= policy.breaker.minSample;
    let trip = '';
    if (sampled && rates.hardBounce >= policy.breaker.hardBounceRate) trip = `hard-bounce rate ${(rates.hardBounce * 100).toFixed(1)}% ≥ ${(policy.breaker.hardBounceRate * 100).toFixed(1)}%`;
    else if (sampled && rates.complaint >= policy.breaker.complaintRate) trip = `complaint/unsubscribe rate ${(rates.complaint * 100).toFixed(2)}% ≥ ${(policy.breaker.complaintRate * 100).toFixed(2)}%`;
    else if (sampled && rates.softBounce >= policy.breaker.softBounceRate) trip = `soft-bounce rate ${(rates.softBounce * 100).toFixed(1)}% ≥ ${(policy.breaker.softBounceRate * 100).toFixed(1)}%`;
    else if (!sampled && hard >= 2 && rates.hardBounce >= 0.2) trip = `${hard} hard bounces in the first ${attempted} sends`;
    const warn = !trip && sent > 0 && (rates.hardBounce >= policy.breaker.hardBounceRate / 2 || rates.complaint >= policy.breaker.complaintRate / 2);
    return { windowDays: policy.breaker.windowDays, sent, attempted, hardBounces: hard, softBounces: soft, complaints, rates, sampled, tripped: Boolean(trip), reason: trip, level: trip ? 'tripped' : warn ? 'warning' : 'ok' };
  }
  function evaluateBreaker(mailboxId) {
    const state = breakerState(mailboxId);
    const row = q.mailbox.get(mailboxId);
    if (state.tripped && row && row.status === 'active') setMailboxStatus(mailboxId, 'paused', `auto: ${state.reason}`);
    return state;
  }

  // ---------- metrics ----------
  function metrics({ days = 14 } = {}) {
    const since = zonedParts(new Date(now().getTime() - days * DAY_MS), policy.timezone).dateKey;
    const series = {};
    for (const r of q.seriesSince.all(since)) { series[r.day] = series[r.day] || { day: r.day, sent: 0, dead: 0, queued: 0, cancelled: 0 }; series[r.day][r.status] = (series[r.day][r.status] || 0) + r.n; }
    return { queue: Object.fromEntries(q.queueCounts.all().map(r => [r.status, r.n])), series: Object.values(series).sort((a, b) => a.day.localeCompare(b.day)), policy, mailboxes: listMailboxes() };
  }
  function recentJobs(limit = 100) { return q.recentJobs.all(limit).map(rowToJob); }
  function findJobByProviderId(pid) { return rowToJob(q.jobByProviderId.get(pid)); }

  return {
    get policy() { return policy; },
    setPolicy(raw) { policy = normalisePolicy({ ...policy, ...raw, breaker: { ...policy.breaker, ...(raw?.breaker || {}) } }); return policy; },
    hooks({ onSent: s, onDead: d, onPaused: p } = {}) { if (s) onSent = s; if (d) onDead = d; if (p) onPaused = p; },
    listMailboxes, getMailbox, saveMailbox, deleteMailbox, setMailboxStatus, setMailboxHealth, effectiveCap, pickMailbox, slotFor,
    enqueue, getJob, jobsForLead, cancelJob, retryJob, tick, recordSignal, breakerState, evaluateBreaker, metrics, recentJobs, findJobByProviderId,
    _internals: { zonedParts, zonedInstant, normalisePolicy, classifyError }
  };
};
module.exports.DEFAULT_POLICY = DEFAULT_POLICY;
module.exports.normalisePolicy = normalisePolicy;
