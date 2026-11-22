// Four Desks — Release 5 (v64): security backlog. TOTP two-step sign-in with recovery codes, sign-out-everywhere,
// API-wide rate limiting, privacy notice page, desk mailbox fallback audit.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const security = require('../lib/security');

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
function client(base) {
  const jar = { cookie: '', csrf: '' };
  const call = async (method, url, body, extra = {}) => {
    const headers = { 'Content-Type': 'application/json', Origin: base, ...extra };
    if (jar.cookie) headers.Cookie = jar.cookie;
    if (jar.csrf) headers['X-CSRF-Token'] = jar.csrf;
    const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) jar.cookie = setCookie.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    const payload = ct.includes('application/json') ? await res.json() : await res.text();
    if (payload && payload.csrfToken) jar.csrf = payload.csrfToken;
    return { status: res.status, payload, headers: res.headers };
  };
  call.jar = jar; return call;
}

test('security module: RFC 6238 vectors, drift window, replay guard, recovery codes, limiter, challenges', () => {
  const secret = security.base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(security.hotp(secret, 1, 8), '94287082'); // RFC 6238 T=59 (SHA-1)
  assert.equal(security.totp(secret, { time: 1111111109 * 1000 }), '081804');
  assert.deepEqual(security.base32Decode(secret), Buffer.from('12345678901234567890'));
  const now = 1_700_000_000_000; const code = security.totp(secret, { time: now });
  assert.equal(security.verifyTotp(secret, code, { time: now + 29_000 }).ok, true, 'one step of drift is accepted');
  assert.equal(security.verifyTotp(secret, code, { time: now + 90_000 }).ok, false, 'three steps late is refused');
  const first = security.verifyTotp(secret, code, { time: now });
  assert.equal(security.verifyTotp(secret, code, { time: now, lastCounter: first.counter }).ok, false, 'the same code cannot be replayed');
  assert.equal(security.verifyTotp(secret, '12345', { time: now }).ok, false);
  const rc = security.makeRecoveryCodes(8);
  assert.equal(rc.plain.length, 8); assert.match(rc.plain[0], /^[A-Z2-7]{4}-[A-Z2-7]{4}$/);
  const left = security.useRecoveryCode(rc.hashes, rc.plain[2].toLowerCase());
  assert.equal(left.length, 7); assert.equal(security.useRecoveryCode(left, rc.plain[2]), null, 'a recovery code works once');
  let t = 0; const lim = security.rateLimiter({ windowMs: 1000, max: 3, now: () => t });
  assert.deepEqual([lim.hit('a').ok, lim.hit('a').ok, lim.hit('a').ok, lim.hit('a').ok], [true, true, true, false]);
  assert.equal(lim.hit('a').retryAfterSeconds, 1); assert.equal(lim.hit('b').ok, true, 'keys are independent');
  t = 1001; assert.equal(lim.hit('a').ok, true, 'window resets');
  assert.equal(lim.hit('a', 1).ok, false, 'per-call limit override');
  let c = 0; const ch = security.mfaChallenges({ ttlMs: 100, now: () => c });
  const tok = ch.issue({ userId: 'u1' }); assert.equal(ch.peek(tok).userId, 'u1');
  for (let i = 0; i < 5; i += 1) ch.fail(tok); assert.ok(ch.peek(tok)); ch.fail(tok); assert.equal(ch.peek(tok), null, 'six wrong codes burn the challenge');
  const tok2 = ch.issue({ userId: 'u2' }); c = 101; assert.equal(ch.peek(tok2), null, 'challenges expire');
  const tok3 = ch.issue({ userId: 'u3' }); assert.equal(ch.take(tok3).userId, 'u3'); assert.equal(ch.take(tok3), null, 'single use');
});

test('two-step sign-in end to end: setup → enable → login needs code → recovery code → sign out everywhere → admin reset; rate limits; privacy page', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chelo-security-'));
  const port = 9700 + Math.floor(Math.random() * 90);
  const child = await startServer({ PORT: String(port), DATA_DIR: dir, NODE_ENV: 'test', SETTINGS_ENCRYPTION_KEY: 'sec-key', SMTP_PROBE_DISABLED: 'true' });
  t.after(() => { child.kill('SIGTERM'); });
  const base = `http://127.0.0.1:${port}`;
  const root = client(base); const other = client(base); const staff = client(base);
  assert.equal((await root('POST', '/api/auth/setup', { username: 'founder@cheloapp.com', displayName: 'Founder', password: 'correct-horse-battery' })).status, 201);

  // Privacy notice is public; MFA endpoints are not.
  const priv = await fetch(`${base}/privacy`); assert.equal(priv.status, 200); assert.match(await priv.text(), /section 72/i);
  assert.equal((await fetch(`${base}/api/auth/mfa`)).status, 401, 'MFA management needs a session even though it lives under /api/auth');
  assert.equal((await root('GET', '/api/auth/mfa')).payload.enabled, false);

  // Setup → wrong code refused → right code enables and returns 8 recovery codes; other sessions of mine are ended.
  assert.equal((await other('POST', '/api/auth/login', { username: 'founder@cheloapp.com', password: 'correct-horse-battery' })).status, 200);
  const setup = (await root('POST', '/api/auth/mfa/setup', {})).payload;
  assert.match(setup.secret, /^[A-Z2-7]{32}$/); assert.match(setup.otpauth, /^otpauth:\/\/totp\/Chelo%3Afounder%40cheloapp.com\?secret=/);
  assert.equal((await root('POST', '/api/auth/mfa/enable', { code: '000000' })).status, 400);
  const enabled = await root('POST', '/api/auth/mfa/enable', { code: security.totp(setup.secret, { time: Date.now() - 30_000 }) }); // previous step: the current code stays fresh for the login below (used codes never replay)
  assert.equal(enabled.status, 200, JSON.stringify(enabled.payload)); assert.equal(enabled.payload.recoveryCodes.length, 8); assert.equal(enabled.payload.status.enabled, true);
  assert.equal((await other('GET', '/api/init')).status, 401, 'enabling two-step signs out my other sessions');
  assert.equal((await root('GET', '/api/init')).status, 200, 'but not this one');
  assert.equal((await root('GET', '/api/staff')).payload.users[0].mfaEnabled, true);

  // Login now needs the code. Password alone gives a challenge, not a session.
  const fresh = client(base);
  const step1 = await fresh('POST', '/api/auth/login', { username: 'founder@cheloapp.com', password: 'correct-horse-battery' });
  assert.equal(step1.status, 200); assert.equal(step1.payload.mfaRequired, true); assert.ok(step1.payload.mfaToken); assert.equal(fresh.jar.cookie, '', 'no cookie before the code');
  assert.equal((await fresh('GET', '/api/init')).status, 401);
  assert.equal((await fresh('POST', '/api/auth/mfa/verify', { mfaToken: step1.payload.mfaToken, code: '123456' })).status, 401);
  assert.equal((await fresh('POST', '/api/auth/mfa/verify', { mfaToken: 'bogus', code: '123456' })).payload.restart, true);
  const ok = await fresh('POST', '/api/auth/mfa/verify', { mfaToken: step1.payload.mfaToken, code: security.totp(setup.secret) });
  assert.equal(ok.status, 200, JSON.stringify(ok.payload)); assert.equal(ok.payload.authenticated, true); assert.ok(fresh.jar.cookie);
  assert.equal((await fresh('GET', '/api/init')).status, 200);
  assert.equal((await fresh('POST', '/api/auth/mfa/verify', { mfaToken: step1.payload.mfaToken, code: security.totp(setup.secret) })).status, 401, 'challenge is single-use');

  // Recovery code path, once.
  const rec = client(base);
  const s1 = (await rec('POST', '/api/auth/login', { username: 'founder@cheloapp.com', password: 'correct-horse-battery' })).payload;
  const viaRecovery = await rec('POST', '/api/auth/mfa/verify', { mfaToken: s1.mfaToken, code: enabled.payload.recoveryCodes[0] });
  assert.equal(viaRecovery.status, 200); assert.equal(viaRecovery.payload.recoveryUsed, true); assert.equal(viaRecovery.payload.recoveryLeft, 7);
  const s2 = (await client(base)('POST', '/api/auth/login', { username: 'founder@cheloapp.com', password: 'correct-horse-battery' })).payload;
  assert.equal((await client(base)('POST', '/api/auth/mfa/verify', { mfaToken: s2.mfaToken, code: enabled.payload.recoveryCodes[0] })).status, 401, 'a recovery code works once');

  // Sign out everywhere else keeps the current session.
  const rv = (await root('POST', '/api/auth/sessions/revoke-all', {})).payload;
  assert.ok(rv.revoked >= 2, JSON.stringify(rv)); assert.equal((await fresh('GET', '/api/init')).status, 401); assert.equal((await root('GET', '/api/init')).status, 200);

  // Disable needs the password; then login is one step again.
  assert.equal((await root('POST', '/api/auth/mfa/disable', { password: 'wrong-password-here' })).status, 401);
  assert.equal((await root('POST', '/api/auth/mfa/disable', { password: 'correct-horse-battery' })).payload.status.enabled, false);
  assert.equal((await client(base)('POST', '/api/auth/login', { username: 'founder@cheloapp.com', password: 'correct-horse-battery' })).payload.authenticated, true);

  // Admin resets a colleague's two-step (lost phone) and signs them out; root is protected from others.
  const u = (await root('POST', '/api/staff', { username: 'nandi@cheloapp.com', displayName: 'Nandi', role: 'owner', password: 'another-long-password' })).payload;
  assert.equal((await staff('POST', '/api/auth/login', { username: 'nandi@cheloapp.com', password: 'another-long-password' })).status, 200);
  const su = (await staff('POST', '/api/auth/mfa/setup', {})).payload;
  assert.equal((await staff('POST', '/api/auth/mfa/enable', { code: security.totp(su.secret) })).status, 200);
  assert.equal((await root('GET', '/api/staff')).payload.users.find(x => x.id === u.id).mfaEnabled, true);
  const reset = await root('PUT', `/api/staff/${u.id}`, { mfaReset: true });
  assert.equal(reset.status, 200); assert.equal(reset.payload.mfaEnabled, false); assert.equal(reset.payload.revoked, 1);
  assert.equal((await staff('GET', '/api/init')).status, 401);
  assert.equal((await staff('POST', '/api/auth/login', { username: 'nandi@cheloapp.com', password: 'another-long-password' })).payload.authenticated, true, 'password-only again');
  const rootId = (await root('GET', '/api/staff')).payload.rootUserId;
  assert.equal((await staff('PUT', `/api/staff/${rootId}`, { mfaReset: true })).status, 403, 'non-admin blocked');
  const audit = (await root('GET', '/api/audit?limit=200')).payload;
  const actions = JSON.stringify(audit);
  for (const a of ['auth.mfa_enabled', 'auth.login.mfa_pending', 'auth.sessions_revoked', 'auth.mfa_disabled', 'staff.mfa_reset']) assert.ok(actions.includes(a), `audit has ${a}`);

  // API-wide rate limit: the public supplier form stops at 90/min per IP with Retry-After, and the staff session is unaffected.
  let limited = null;
  for (let i = 0; i < 95 && !limited; i += 1) { const r = await fetch(`${base}/api/public/suppliers/signup`); if (r.status === 429) limited = r; }
  assert.ok(limited, 'public form rate-limited'); assert.ok(Number(limited.headers.get('retry-after')) >= 1);
  assert.match((await limited.json()).error, /Too many requests/);
  assert.equal((await root('GET', '/api/init')).status, 200, 'signed-in session has its own bucket');
});

test('desk mailbox fallback is recorded on the job and in the audit trail (#3)', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chelo-fallback-'));
  const port = 9600 + Math.floor(Math.random() * 90);
  const child = await startServer({ PORT: String(port), DATA_DIR: dir, NODE_ENV: 'test', SETTINGS_ENCRYPTION_KEY: 'fb-key', SMTP_PROBE_DISABLED: 'true' });
  t.after(() => { child.kill('SIGTERM'); });
  const base = `http://127.0.0.1:${port}`; const c = client(base);
  assert.equal((await c('POST', '/api/auth/setup', { username: 'founder@cheloapp.com', displayName: 'Founder', password: 'correct-horse-battery' })).status, 201);
  const mb = (await c('POST', '/api/deliverability/mailboxes', { label: 'CSI box', fromEmail: 'csi@github.com', fromName: 'Chelo', host: '127.0.0.1', port: 2525, username: 'u', password: 'secret' })).payload.mailbox;
  assert.equal((await c('PUT', `/api/deliverability/mailboxes/${mb.id}/desk`, { desk: 'csi' })).status, 200);
  // A supplier broadcast from the Suppliers desk has no box of its own → falls back to the CSI box and says so.
  const lead = await fetch(`${base}/api/public/suppliers/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company: 'Thabo Plumbing', contactName: 'Thabo', email: 'thabo@github.com', phone: '0825551234', trades: ['sanitation'], provinces: ['Gauteng'], town: 'Soweto', consent: true }) });
  assert.equal(lead.status, 201);
  const sup = (await c('GET', '/api/init', undefined, { 'X-Chelo-Desk': 'suppliers' })).payload.leads.find(l => l.company === 'Thabo Plumbing');
  assert.equal((await c('PUT', `/api/leads/${sup.id}/vetting`, { status: 'approved' }, { 'X-Chelo-Desk': 'suppliers' })).status, 200);
  const project = (await c('POST', '/api/projects', { name: 'Sanitation — Test School', recipientName: 'Test School', province: 'Gauteng', sector: 'Education', targetAmount: 1000, summary: 'Toilets.' })).payload;
  const bc = (await c('POST', `/api/projects/${project.id}/tender`, { trade: 'sanitation', province: 'Gauteng' }, { 'X-Chelo-Desk': 'suppliers' })).payload;
  assert.equal(bc.queued, 1, JSON.stringify(bc));
  const audit = JSON.stringify((await c('GET', '/api/audit?limit=100')).payload);
  assert.ok(audit.includes('mailbox.fallback'), 'fallback is audited');
  assert.ok(audit.includes('No mailbox tagged for the suppliers desk'), audit.slice(0, 300));
});
