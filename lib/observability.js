'use strict';
// Batch 6 — Observability. Pure: takes a snapshot of engine state, returns one ops picture:
// overall status, ranked health checks (each with a plain-English fix + where to click), KPIs, 30-day funnel,
// 14-day send/bounce series and per-area summaries. No I/O here; server.js assembles the snapshot.
const DAY = 86400e3;
const SEV = { critical: 3, warn: 2, info: 1, ok: 0 };

function pct(n, d) { return d ? Math.round((n / d) * 1000) / 10 : 0; }
function hoursAgo(iso, now) { const t = Date.parse(iso || ''); return Number.isFinite(t) ? (now - t) / 3600e3 : null; }

function buildOps(snap, now = new Date()) {
  const t = now.getTime();
  const checks = [];
  const add = (status, area, id, title, detail, fix, view = null) => checks.push({ id, area, status, title, detail, fix, view });

  // ---- Deliverability ----
  const mailboxes = snap.mailboxes || [];
  const active = mailboxes.filter(m => m.status === 'active');
  const paused = mailboxes.filter(m => m.status === 'paused');
  if (!mailboxes.length) add('critical', 'deliverability', 'no-mailbox', 'No sending mailbox registered', 'Nothing can be sent until a staff mailbox (SMTP/IMAP) is registered.', 'Deliverability → Add mailbox, then run the domain health check.', 'deliverability');
  else if (!active.length) add('critical', 'deliverability', 'all-paused', 'All mailboxes are paused', `${paused.length} paused: ${paused.map(m => `${m.fromEmail} (${m.pausedReason || 'manual'})`).join('; ')}`, 'Fix the cause (bounces / DNS), then Resume in Deliverability.', 'deliverability');
  for (const m of mailboxes) {
    const h = m.health || {};
    if (h.status === 'blocked' || h.status === 'failing') add('critical', 'deliverability', `dns-${m.id}`, `${m.fromEmail}: domain health ${h.status}`, (h.issues || []).map(i => i.title).join(', ') || 'SPF/DKIM/DMARC failing', (h.issues || []).map(i => i.fix).filter(Boolean)[0] || 'Fix DNS records, then re-check.', 'deliverability');
    else if (h.status === 'needs-work') add('warn', 'deliverability', `dns-${m.id}`, `${m.fromEmail}: domain needs work`, (h.issues || []).map(i => i.title).join(', '), (h.issues || []).map(i => i.fix).filter(Boolean)[0] || 'Add the missing DNS record.', 'deliverability');
    else if (!h.status) add('warn', 'deliverability', `dns-${m.id}`, `${m.fromEmail}: domain never checked`, 'SPF/DKIM/DMARC status unknown — sends are blocked until checked.', 'Deliverability → Check domain.', 'deliverability');
    const b = m.breaker || {};
    if (b.tripped) add('critical', 'deliverability', `breaker-${m.id}`, `${m.fromEmail}: circuit breaker tripped`, b.reason || 'Bounce/complaint rate over threshold', 'Clean the list (verify before send), wait for the window to roll, then resume.', 'deliverability');
    else if (b.rates && (b.rates.hardBounce > 0.01 || b.rates.complaint > 0.001) && b.sampled) add('warn', 'deliverability', `rates-${m.id}`, `${m.fromEmail}: bounce/complaint rate climbing`, `hard bounce ${pct(b.rates.hardBounce, 1)}% · complaints ${pct(b.rates.complaint, 1)}% (targets <2% / <0.1%)`, 'Verify every address before it is queued; slow the ramp.', 'deliverability');
    if (m.today && m.today.cap && m.today.used >= m.today.cap) add('info', 'deliverability', `cap-${m.id}`, `${m.fromEmail}: daily cap reached`, `${m.today.used}/${m.today.cap} today`, 'Queued mail sends tomorrow in business hours; add a second mailbox to raise throughput.', 'deliverability');
  }
  const q = snap.queue || {};
  if ((q.dead || 0) > 0) add('warn', 'deliverability', 'dead-letter', `${q.dead} message(s) in dead-letter`, 'Permanent failures after retries.', 'Deliverability → Queue → inspect, fix the address or retry.', 'deliverability');
  if ((q.queued || 0) > 0 && !snap.workerHealthy) add('warn', 'deliverability', 'worker', `${q.queued} queued but no worker ran recently`, snap.serverless ? 'Serverless host: the queue drains only when the cron or a request triggers it.' : 'The background worker has not ticked.', snap.serverless ? 'Set CRON_SECRET and keep the Vercel cron enabled, or move to a long-running host.' : 'Restart the app; check logs.', 'deliverability');
  const series = snap.series || [];
  const last14 = series.reduce((a, d) => ({ sent: a.sent + (d.sent || 0), dead: a.dead + (d.dead || 0) }), { sent: 0, dead: 0 });

  // ---- Sequences + replies ----
  const seq = snap.sequences || {};
  if ((seq.pendingApproval || 0) > 0) add('info', 'sequences', 'seq-approval', `${seq.pendingApproval} sequence plan(s) awaiting approval`, 'First touch + follow-ups are drafted but not approved.', 'Workbench → Approve plan (4-eyes if enabled).', 'workbench');
  if ((seq.failed || 0) > 0) add('warn', 'sequences', 'seq-failed', `${seq.failed} sequence step(s) failed`, 'A scheduled step could not be sent.', 'Open the lead → sequence panel → retry or re-plan.', 'workbench');
  const tri = snap.triage || {};
  if ((tri.overdue || 0) > 0) add('critical', 'replies', 'sla-overdue', `${tri.overdue} funder repl${tri.overdue === 1 ? 'y' : 'ies'} past SLA`, 'Human replies waiting longer than the agreed response time — fast replies are 3× meetings.', 'Replies → answer the oldest first.', 'triage');
  else if ((tri.open || 0) > 0) add('info', 'replies', 'sla-open', `${tri.open} repl${tri.open === 1 ? 'y' : 'ies'} to handle`, 'Within SLA.', 'Replies view.', 'triage');
  if (!snap.inboundConfigured) add('warn', 'replies', 'inbound', 'Inbound sync not configured', 'Replies and bounces are not being read, so sequences cannot stop on a human reply.', 'Settings → Inbound: IMAP or webhook.', 'settings');

  // ---- Data engine ----
  const data = snap.data || {};
  if ((data.mergeReviewsOpen || 0) > 0) add('info', 'data', 'merge', `${data.mergeReviewsOpen} possible duplicate(s) to review`, 'Likely duplicates are parked, not merged silently.', 'Data quality → Merge reviews.', 'data');
  if ((data.reverifyDue || 0) > 0) add('info', 'data', 'reverify', `${data.reverifyDue} contact(s) overdue for re-verification`, 'Older than 90 days.', 'Data quality → Re-verify stale now (or wait for the daily cron).', 'data');
  const cat = snap.catalogue || {};
  if (cat.total && !cat.imported) add('info', 'data', 'cat-load', 'Discovered funders not loaded', `${cat.total} curated SA CSI funders available.`, 'Discover → Load.', 'discover');
  else if ((cat.mailboxes?.toSearch || 0) > 0) add('info', 'data', 'cat-mailboxes', `${cat.mailboxes.toSearch} discovered funder(s) still need a mailbox search`, `${cat.visible || 0} in pipeline · ${cat.awaitingContact || 0} hidden awaiting contact.`, 'Discover → Find mailboxes, or let the daily cron work through them.', 'discover');

  // ---- Platform ----
  if (snap.ephemeralHost && !snap.durable) add('critical', 'platform', 'storage', 'No durable storage on this host', 'Vercel wipes /tmp: leads, found mailboxes, logins and audit vanish on restart.', 'Set SUPABASE_URL + SUPABASE_SERVICE_KEY (docs/durable-storage.md).', 'discover');
  if (snap.durable && snap.sync?.lastError) {
    const timeout = /abort|timeout/i.test(snap.sync.lastError);
    add('warn', 'platform', 'sync-error', 'Durable sync reported an error', `${snap.sync.lastError}${snap.sync.localBytes ? ` · snapshot ${(snap.sync.localBytes / 1048576).toFixed(1)} MB` : ''}`,
      timeout ? 'Supabase did not answer in time. Check the Supabase project is not PAUSED (dashboard → Restore), then open /api/storage?probe=1 to confirm reachability. Data is safe locally until the next successful push.'
        : 'Check the Supabase key/bucket (open /api/storage?probe=1 for the exact HTTP answer); data is still safe locally until the next successful push.', null);
  }
  if (snap.durable && (snap.sync?.conflicts || 0) > 0) add('info', 'platform', 'sync-conflict', `${snap.sync.conflicts} sync conflict(s) resolved last-writer-wins`, 'Two instances wrote at once.', 'Harmless at this scale; tell us if it grows.', null);
  for (const [name, run] of Object.entries(snap.cron || {})) {
    const h = run?.at ? hoursAgo(run.at, t) : null;
    const expected = name === 'send-tick' ? 30 : 36;
    if (h === null) add(snap.serverless ? 'warn' : 'info', 'platform', `cron-${name}`, `Cron ${name} has never run`, snap.serverless ? 'On Vercel the engine depends on it.' : 'The in-process worker covers this on long-running hosts.', 'Set CRON_SECRET in Vercel and confirm the cron in vercel.json is enabled.', null);
    else if (h > expected) add('warn', 'platform', `cron-${name}`, `Cron ${name} last ran ${Math.round(h)}h ago`, `Expected at least every ${expected}h.`, 'Check Vercel → Cron Jobs → logs.', null);
  }
  if (!snap.approvalPolicy || snap.approvalPolicy === 'single') add('info', 'platform', 'four-eyes', 'Single-approver mode', 'One person can approve and send.', 'Settings → Governance → 4-eyes once a second reviewer is onboarded.', 'settings');
  if (!snap.aiConfigured) add('info', 'platform', 'ai', 'AI drafting not configured', 'Drafts use templates; the engine runs fully without AI.', 'Settings → AI key (optional cherry on top).', 'settings');
  if ((snap.recentFailures || []).length) add('warn', 'platform', 'errors', `${snap.recentFailures.length} failure event(s) in the last 7 days`, snap.recentFailures.slice(0, 3).map(e => e.summary).join(' · '), 'See the audit log for details.', 'audit');

  checks.sort((a, b) => SEV[b.status] - SEV[a.status]);
  const worst = checks.reduce((w, c) => Math.max(w, SEV[c.status]), 0);
  const status = worst >= 3 ? 'critical' : worst === 2 ? 'attention' : 'healthy';

  // ---- Funnel (30d) ----
  const f = snap.funnel || {};
  const funnel = [
    { key: 'added', label: 'Leads added', n: f.added || 0 },
    { key: 'contactable', label: 'Contact-ready', n: f.contactable || 0 },
    { key: 'drafted', label: 'Drafted', n: f.drafted || 0 },
    { key: 'sent', label: 'First touch sent', n: f.sent || 0 },
    { key: 'replied', label: 'Human reply', n: f.replied || 0 },
    { key: 'interested', label: 'Interested', n: f.interested || 0 },
    { key: 'meeting', label: 'Meeting booked', n: f.meeting || 0 },
    { key: 'won', label: 'Won', n: f.won || 0 }
  ].map((s, i, arr) => ({ ...s, ofPrev: i ? pct(s.n, arr[i - 1].n) : 100, ofTop: pct(s.n, arr[0].n) }));

  const kpis = {
    sent14d: last14.sent, bounce14dPct: pct(last14.dead, last14.sent + last14.dead),
    replyRatePct: pct(f.replied || 0, f.sent || 0), interestedRatePct: pct(f.interested || 0, f.sent || 0), meetingRatePct: pct(f.meeting || 0, f.sent || 0),
    activeSequences: seq.running || 0, stoppedByReply: seq.stoppedByReply || 0, repliesOpen: tri.open || 0, repliesOverdue: tri.overdue || 0, medianReplyHours: tri.medianHandleHours ?? null,
    pipelineLeads: snap.pipeline?.visible || 0, awaitingContact: cat.awaitingContact || 0, dataGradeA: data.gradeA || 0, dataGradeTotal: data.graded || 0,
    mailboxesActive: active.length, mailboxesPaused: paused.length, queued: q.queued || 0, dead: q.dead || 0
  };
  const counts = { critical: checks.filter(c => c.status === 'critical').length, warn: checks.filter(c => c.status === 'warn').length, info: checks.filter(c => c.status === 'info').length };
  return { generatedAt: now.toISOString(), status, counts, checks, kpis, funnel, series, areas: { deliverability: { mailboxes, queue: q, last14 }, sequences: seq, replies: tri, data, catalogue: cat, platform: { durable: Boolean(snap.durable), ephemeralHost: Boolean(snap.ephemeralHost), serverless: Boolean(snap.serverless), sync: snap.sync || null, cron: snap.cron || {}, approvalPolicy: snap.approvalPolicy || 'single', aiConfigured: Boolean(snap.aiConfigured), inboundConfigured: Boolean(snap.inboundConfigured) } } };
}

// Funnel + sequence/triage rollups from raw records (kept here so they are unit-testable).
function rollup(leads, bookings = [], now = new Date(), days = 30) {
  const since = now.getTime() - days * DAY;
  const inWin = iso => { const t = Date.parse(iso || ''); return Number.isFinite(t) && t >= since; };
  const recent = leads.filter(l => !l.isDemo && inWin(l.createdAt));
  const sentLeads = leads.filter(l => !l.isDemo && (inWin(l.firstSentAt) || inWin(l.lastContactedAt)));
  const replied = sentLeads.filter(l => l.triage && l.triage.category && l.triage.category !== 'automatic');
  const funnel = {
    added: recent.length,
    contactable: recent.filter(l => l.contactCheck?.status === 'ready').length,
    drafted: recent.filter(l => l.emailDraft || l.sequence).length,
    sent: sentLeads.length,
    replied: replied.length,
    interested: replied.filter(l => l.triage.category === 'interested').length,
    meeting: bookings.filter(b => inWin(b.createdAt) && ['Requested', 'Confirmed'].includes(b.status)).length,
    won: leads.filter(l => !l.isDemo && l.stage === 'Won' && inWin(l.wonAt || l.updatedAt)).length
  };
  const seqs = leads.map(l => l.sequence).filter(Boolean);
  const sequences = {
    running: seqs.filter(s => s.status === 'running').length, pendingApproval: seqs.filter(s => s.status === 'pending-approval').length,
    completed: seqs.filter(s => s.status === 'completed').length, stoppedByReply: seqs.filter(s => s.status === 'stopped' && /repl/i.test(s.stoppedReason || s.stopReason || '')).length,
    stopped: seqs.filter(s => s.status === 'stopped').length, failed: seqs.reduce((n, s) => n + (s.steps || []).filter(st => st.status === 'failed').length, 0)
  };
  const open = leads.filter(l => l.triage && !l.triage.handled);
  const handled = leads.filter(l => l.triage && l.triage.handled && l.triage.handledAt && l.triage.receivedAt);
  const handleHours = handled.map(l => (Date.parse(l.triage.handledAt) - Date.parse(l.triage.receivedAt)) / 3600e3).filter(h => h >= 0).sort((a, b) => a - b);
  const triage = { open: open.length, overdue: open.filter(l => l.triage.dueAt && Date.parse(l.triage.dueAt) < now.getTime()).length, medianHandleHours: handleHours.length ? Math.round(handleHours[Math.floor(handleHours.length / 2)] * 10) / 10 : null, byCategory: open.reduce((a, l) => { a[l.triage.category] = (a[l.triage.category] || 0) + 1; return a; }, {}) };
  return { funnel, sequences, triage };
}

module.exports = { buildOps, rollup, SEV };
