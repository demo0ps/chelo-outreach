const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const createSendEngine = require('../lib/send-engine');
const createDomainHealth = require('../lib/domain-health');

const ROOT = path.join(__dirname, '..');
function startServer(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => reject(new Error(`server did not start: ${out}`)), 15000);
    child.stdout.on('data', chunk => { out += chunk; if (/running at/.test(out)) { clearTimeout(timer); resolve(child); } });
    child.stderr.on('data', chunk => { out += chunk; });
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${out}`)); });
  });
}

function fakeEngine({ clock, transport, suppressed = () => false }) {
  const conn = new DatabaseSync(':memory:');
  return createSendEngine({ conn, encryptSecret: v => ({ v }), decryptSecret: r => r.v, isSuppressed: suppressed, now: () => clock.t, random: () => 0.5, transportFactory: () => transport });
}

test('send engine: ramp caps, business-hours slots, spill-over, suppression gate', () => {
  const clock = { t: new Date('2026-10-26T20:00:00Z') }; // Monday 22:00 SAST → first slot Tuesday 08:30
  const sent = [];
  const engine = fakeEngine({ clock, transport: { sendMail: async m => { sent.push(m); return { accepted: [m.to], messageId: '<m>', response: '250 ok' }; }, close() {} }, suppressed: e => e === 'optout@github.com' });
  const mailbox = engine.saveMailbox({ fromEmail: 'team@chelo.org', host: 'smtp.test', port: 587, username: 'u', password: 'p', dailyCap: 40 });
  assert.equal(engine.effectiveCap(mailbox), 5, 'week-1 ramp cap applies before the configured cap');
  assert.throws(() => engine.enqueue({ to: 'optout@github.com', subject: 's', text: 't' }), /suppression/);
  const jobs = Array.from({ length: 7 }, (_, i) => engine.enqueue({ leadId: `l${i}`, to: `p${i}@github.com`, subject: 's', text: 't' }));
  assert.ok(jobs.every(j => j.status === 'queued'));
  assert.equal(jobs[0].scheduledAt, '2026-10-27T06:30:00.000Z', 'first slot is the next window opening in Africa/Johannesburg');
  assert.equal(new Set(jobs.slice(0, 5).map(j => j.localDay)).size, 1);
  assert.equal(jobs[5].localDay, '2026-10-28', 'sixth email spills to the next day once the ramp cap is used');
  const gaps = jobs.slice(1, 5).map((j, i) => new Date(j.scheduledAt) - new Date(jobs[i].scheduledAt));
  assert.ok(gaps.every(g => g >= 90e3), 'minimum gap between sends is respected');
  const paused = engine.setMailboxStatus(mailbox.id, 'paused', 'manual');
  assert.equal(paused.status, 'paused');
  assert.throws(() => engine.enqueue({ to: 'x@github.com', subject: 's', text: 't' }), /No active sending mailbox/);
  engine.setMailboxStatus(mailbox.id, 'active');
});

test('send engine: worker sends due jobs, classifies failures, retries with backoff and trips the breaker', async () => {
  const clock = { t: new Date('2026-10-27T06:00:00Z') };
  let behaviour = 'ok'; const sent = [];
  const transport = { sendMail: async m => { if (behaviour === 'ok') { sent.push(m); return { accepted: [m.to], messageId: '<id>', response: '250 queued' }; } if (behaviour === 'permanent') throw Object.assign(new Error('550 5.1.1 The email account does not exist'), { responseCode: 550 }); if (behaviour === 'auth') throw Object.assign(new Error('Invalid login: 535 5.7.8 Username and password not accepted'), { code: 'EAUTH' }); throw new Error('Connection timeout'); }, close() {} };
  const engine = fakeEngine({ clock, transport });
  const sentHook = []; const deadHook = []; const pausedHook = [];
  engine.hooks({ onSent: j => sentHook.push(j.id), onDead: j => deadHook.push(j.errorClass), onPaused: (m, r) => pausedHook.push(r) });
  const mailbox = engine.saveMailbox({ fromEmail: 'team@chelo.org', host: 'smtp.test', port: 587, username: 'u', password: 'p', dailyCap: 25, rampEnabled: false });
  const a = engine.enqueue({ leadId: 'a', to: 'a@github.com', subject: 's', text: 't', headers: { 'List-Unsubscribe': '<https://x/opt-out/1>' } });
  assert.equal((await engine.tick()).ran, 0, 'nothing is due before its slot');
  clock.t = new Date(a.scheduledAt);
  const r1 = await engine.tick();
  assert.equal(r1.ran, 1); assert.equal(engine.getJob(a.id).status, 'sent'); assert.deepEqual(sentHook, [a.id]);
  assert.equal(sent[0].headers['List-Unsubscribe'], '<https://x/opt-out/1>');

  behaviour = 'transient';
  const b = engine.enqueue({ leadId: 'b', to: 'b@github.com', subject: 's', text: 't' }); clock.t = new Date(b.scheduledAt);
  await engine.tick();
  const retry = engine.getJob(b.id);
  assert.equal(retry.status, 'queued'); assert.equal(retry.attempts, 1); assert.equal(retry.errorClass, 'transient');
  assert.ok(new Date(retry.scheduledAt) - clock.t >= 60e3, 'first retry backs off by a minute');

  engine.cancelJob(b.id, 'test');
  behaviour = 'permanent';
  const dead = [];
  for (let i = 0; i < 2; i += 1) { const j = engine.enqueue({ leadId: `d${i}`, to: `d${i}@github.com`, subject: 's', text: 't' }); clock.t = new Date(j.scheduledAt); await engine.tick(); dead.push(engine.getJob(j.id)); }
  assert.ok(dead.every(j => j.status === 'dead' && j.errorClass === 'permanent'));
  assert.deepEqual(deadHook, ['permanent', 'permanent']);
  const breaker = engine.breakerState(mailbox.id);
  assert.equal(breaker.tripped, true, JSON.stringify(breaker));
  assert.equal(engine.getMailbox(mailbox.id).status, 'paused');
  assert.match(pausedHook[0], /hard bounces/);

  engine.setMailboxStatus(mailbox.id, 'active');
  behaviour = 'auth';
  const c = engine.enqueue({ leadId: 'c', to: 'c@github.com', subject: 's', text: 't' }); clock.t = new Date(c.scheduledAt); await engine.tick();
  assert.equal(engine.getJob(c.id).status, 'held');
  assert.match(engine.getMailbox(mailbox.id).pausedReason, /authentication/);
  const m = engine.metrics();
  assert.equal(m.queue.sent, 1); assert.equal(m.queue.dead, 2); assert.equal(m.queue.held, 1);
});

test('domain health: SPF/DMARC parsing and DKIM selector probe with fix guidance', async () => {
  const records = {
    'good.test': ['v=spf1 include:_spf.google.com ~all'], '_dmarc.good.test': ['v=DMARC1; p=quarantine; rua=mailto:d@good.test'], 'google._domainkey.good.test': [`v=DKIM1; k=rsa; p=${Buffer.alloc(294).toString('base64')}`],
    'weak.test': ['v=spf1 include:a.test +all', 'v=spf1 include:b.test ~all'], '_dmarc.weak.test': []
  };
  const resolver = { async resolveTxt(name) { return (records[name] || []).map(r => [r]); }, async resolveMx(domain) { return domain === 'weak.test' ? [] : [{ exchange: 'mx.' + domain, priority: 10 }]; } };
  const health = createDomainHealth({ resolver });
  const good = await health.check('team@good.test');
  assert.equal(good.status, 'pass', JSON.stringify(good.issues));
  assert.equal(good.checks.dkim.selector, 'google');
  assert.equal(good.checks.dmarc.policy, 'quarantine');
  const weak = await health.check('weak.test');
  assert.equal(weak.status, 'fail');
  assert.deepEqual(weak.issues.map(i => i.code).sort(), ['dkim', 'dmarc', 'mx', 'spf']);
  assert.match(weak.issues.find(i => i.code === 'spf').detail, /Multiple SPF/);
  assert.ok(weak.issues.every(i => i.fix.length > 20), 'every issue ships with a fix');
  assert.equal((await health.check('team@good.test')).cached, true);
});

test('deliverability API: mailbox registry, domain health, policy, approved email goes through the queue with unsubscribe headers', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chelo-dlv-'));
  const port = 5400 + Math.floor(Math.random() * 500);
  const child = await startServer({ PORT: String(port), DATA_DIR: dir, NODE_ENV: 'test', SETTINGS_ENCRYPTION_KEY: 'dlv-key', SMTP_PROBE_DISABLED: 'true' });
  t.after(() => { child.kill('SIGTERM'); });
  const base = `http://127.0.0.1:${port}`;
  const jar = { cookie: '', csrf: '' };
  const api = async (method, url, body) => {
    const headers = { 'Content-Type': 'application/json', Origin: base };
    if (jar.cookie) headers.Cookie = jar.cookie;
    if (jar.csrf) headers['X-CSRF-Token'] = jar.csrf;
    const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) jar.cookie = setCookie.split(';')[0];
    const payload = (res.headers.get('content-type') || '').includes('application/json') ? await res.json() : null;
    if (payload && payload.csrfToken) jar.csrf = payload.csrfToken;
    return { status: res.status, payload };
  };
  assert.equal((await api('POST', '/api/auth/setup', { username: 'admin@cheloapp.com', displayName: 'Nandi', password: 'correct-horse-battery' })).status, 201);

  const empty = await api('GET', '/api/deliverability');
  assert.equal(empty.status, 200); assert.deepEqual(empty.payload.mailboxes, []); assert.equal(empty.payload.openTrackingEnabled, false, 'open pixel is off by default');

  const bad = await api('POST', '/api/deliverability/mailboxes', { fromEmail: 'nope', host: 'smtp.test' });
  assert.equal(bad.status, 400);
  const created = await api('POST', '/api/deliverability/mailboxes', { label: 'Partnerships', fromEmail: 'partnerships@github.com', fromName: 'Chelo', host: '127.0.0.1', port: 2525, username: 'u', password: 'secret', dailyCap: 30 });
  assert.equal(created.status, 201, JSON.stringify(created.payload));
  const mailbox = created.payload.mailbox;
  assert.equal(mailbox.hasPassword, true); assert.equal(mailbox.password, undefined, 'secrets never leave the server');
  assert.ok(['pass', 'needs-work', 'fail'].includes(mailbox.health.status));
  assert.ok(Array.isArray(mailbox.health.issues));
  assert.equal(mailbox.today.cap, 5, 'new mailboxes ramp');

  const policy = await api('POST', '/api/deliverability/policy', { windowStart: '09:00', windowEnd: '15:00', sendDays: [1, 2, 3, 4], defaultDailyCap: 20, ramp: [3, 6, 12] });
  assert.equal(policy.status, 200); assert.equal(policy.payload.policy.windowStart, '09:00'); assert.deepEqual(policy.payload.policy.ramp, [3, 6, 12]);
  assert.equal((await api('GET', '/api/deliverability')).payload.mailboxes[0].today.cap, 3, 'policy change re-prices ramp caps');

  // Approved lead → queue
  const lead = await api('POST', '/api/leads', { company: 'Thabo Capital', contactName: 'Thabo N', email: 'thabo@github.com', sector: 'Finance', sourceName: 'Website', sourceUrl: 'https://github.com' });
  assert.equal(lead.status, 201, JSON.stringify(lead.payload));
  const approve = await api('POST', `/api/leads/${lead.payload.id}/approve-email`, { kind: 'initial', subject: 'Partnership with Chelo', body: `Dear Thabo,\n\nWould you be open to a short call?\n\nYes — choose a time: ${base}/track/cta/${lead.payload.bookingToken}\n\nKind regards` });
  assert.equal(approve.status, 200, JSON.stringify(approve.payload));
  const send = await api('POST', `/api/leads/${lead.payload.id}/send-email`, { kind: 'initial', sendNow: true });
  assert.ok([200, 502].includes(send.status), JSON.stringify(send.payload));
  const job = send.payload.job;
  assert.ok(job, 'response carries the queue item');
  assert.ok(['queued', 'held', 'dead', 'sent'].includes(job.status));
  assert.equal(job.to, 'thabo@github.com');
  const queue = await api('GET', '/api/deliverability');
  const listed = queue.payload.jobs.find(j => j.id === job.id);
  assert.ok(listed); assert.equal(listed.leadId, lead.payload.id);
  if (job.status === 'queued') {
    assert.ok(job.attempts >= 1 || new Date(job.scheduledAt) > new Date(), 'either retried after a transient failure or scheduled');
    const dup = await api('POST', `/api/leads/${lead.payload.id}/send-email`, { kind: 'initial' });
    assert.equal(dup.status, 409, 'the same email cannot be queued twice');
    const cancel = await api('POST', `/api/deliverability/jobs/${job.id}/cancel`, {});
    assert.equal(cancel.status, 200); assert.equal(cancel.payload.job.status, 'cancelled');
    const leadAfter = (await api('GET', '/api/init')).payload.leads.find(l => l.id === lead.payload.id);
    assert.equal(leadAfter.emailStatus, 'Approved', 'cancelling returns the lead to approved');
  }

  // One-click unsubscribe cancels anything pending and suppresses workspace-wide
  const out = await fetch(`${base}/api/public/opt-out/${lead.payload.bookingToken}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base }, body: 'List-Unsubscribe=One-Click' });
  assert.equal(out.status, 200);
  const blocked = await api('POST', `/api/leads/${lead.payload.id}/send-email`, { kind: 'initial' });
  assert.equal(blocked.status, 409);

  // Pause / resume / delete
  assert.equal((await api('POST', `/api/deliverability/mailboxes/${mailbox.id}/pause`, { reason: 'maintenance' })).payload.mailbox.status, 'paused');
  const resumed = await api('POST', `/api/deliverability/mailboxes/${mailbox.id}/resume`, {});
  assert.ok([200, 409].includes(resumed.status));
  assert.equal((await api('DELETE', `/api/deliverability/mailboxes/${mailbox.id}`)).status, 200);
  const health = await api('GET', '/api/health');
  assert.ok(health.payload.sendWorker);
});
