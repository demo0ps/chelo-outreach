// Root account: the founding administrator alone sees the technical surface; the account itself is immutable to everyone else.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

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
  return async (method, url, body) => {
    const headers = { 'Content-Type': 'application/json', Origin: base };
    if (jar.cookie) headers.Cookie = jar.cookie;
    if (jar.csrf) headers['X-CSRF-Token'] = jar.csrf;
    const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) jar.cookie = setCookie.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    const payload = ct.includes('application/json') ? await res.json() : await res.text();
    if (payload && payload.csrfToken) jar.csrf = payload.csrfToken;
    return { status: res.status, payload };
  };
}

test('root account: technical surface is root-only; root is immutable to other admins; governance stays admin-wide', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chelo-root-'));
  const port = 6900 + Math.floor(Math.random() * 500);
  const child = await startServer({ PORT: String(port), DATA_DIR: dir, NODE_ENV: 'test', SETTINGS_ENCRYPTION_KEY: 'root-key', SMTP_PROBE_DISABLED: 'true' });
  t.after(() => { child.kill('SIGTERM'); });
  const base = `http://127.0.0.1:${port}`;
  const root = client(base); const other = client(base);

  // Founding admin becomes root
  assert.equal((await root('POST', '/api/auth/setup', { username: 'founder@cheloapp.com', displayName: 'Founder', password: 'correct-horse-battery' })).status, 201);
  const status = (await root('GET', '/api/auth/status')).payload;
  assert.equal(status.isRoot, true);
  const staff = (await root('GET', '/api/staff')).payload;
  assert.equal(staff.users[0].isRoot, true); assert.equal(staff.rootUserId, staff.users[0].id);
  const rootId = staff.users[0].id;

  // Root sees everything technical
  assert.equal((await root('GET', '/api/ops')).status, 200);
  assert.equal((await root('GET', '/api/deliverability')).status, 200);
  assert.equal((await root('GET', '/api/data')).status, 200);
  assert.ok((await root('GET', '/api/settings')).payload.smtpHost !== undefined, 'root sees integration fields');
  assert.equal((await root('GET', '/api/audit/export.csv')).status, 200);

  // A second administrator (full admin, not root)
  const created = await root('POST', '/api/staff', { username: 'ops.admin@cheloapp.com', displayName: 'Second Admin', role: 'admin', password: 'another-strong-password' });
  assert.equal(created.status, 201, JSON.stringify(created.payload)); assert.equal(created.payload.isRoot, false);
  assert.equal((await other('POST', '/api/auth/login', { username: 'ops.admin@cheloapp.com', password: 'another-strong-password' })).status, 200);
  const otherStatus = (await other('GET', '/api/auth/status')).payload;
  assert.equal(otherStatus.role, 'admin'); assert.equal(otherStatus.isRoot, false);

  // …is locked out of the technical surface (hidden = 403 on API)
  for (const url of ['/api/ops', '/api/deliverability', '/api/data', '/api/storage', '/api/inbound/webhook-info', '/api/audit/export.csv']) {
    const r = await other('GET', url); assert.equal(r.status, 403, `${url} → ${r.status}`); assert.match(String(r.payload.error), /root account/);
  }
  assert.equal((await other('POST', '/api/deliverability/mailboxes', { label: 'x' })).status, 403);
  assert.equal((await other('POST', '/api/settings/test-smtp', {})).status, 403);
  assert.equal((await other('POST', '/api/demo/clear', {})).status, 403);
  assert.equal((await other('POST', '/api/data/check-duplicates', { company: 'Umoya', email: '' })).status, 200, 'intake dedup remains available to all staff');

  // …sees no integration fields anywhere
  const init = (await other('GET', '/api/init')).payload;
  assert.equal(init.settings.smtpHost, undefined); assert.equal(init.settings.aiEndpoint, undefined); assert.equal(init.settings.imapHost, undefined);
  assert.equal(init.settings.technicalHidden, true); assert.equal(init.settings.approvalPolicy, 'single');
  assert.equal(init.settings.aiConfigured, false, 'status booleans stay so the workbench can explain itself');

  // …can change governance, but not integrations
  const gov = await other('PUT', '/api/settings', { approvalPolicy: 'four-eyes', guardrail: 'warn' });
  assert.equal(gov.status, 200, JSON.stringify(gov.payload)); assert.equal(gov.payload.approvalPolicy, 'four-eyes'); assert.equal(gov.payload.smtpHost, undefined);
  const mixed = await other('PUT', '/api/settings', { approvalPolicy: 'single', smtpHost: 'evil.example' });
  assert.equal(mixed.status, 403);
  assert.equal((await root('GET', '/api/settings')).payload.smtpHost, '', 'smtpHost untouched');
  assert.equal((await root('GET', '/api/settings')).payload.approvalPolicy, 'four-eyes');

  // …cannot demote, deactivate, rename or reset the root account
  for (const patch of [{ role: 'reviewer' }, { active: false }, { displayName: 'Hijacked' }, { password: 'brand-new-password-123' }]) {
    const r = await other('PUT', `/api/staff/${rootId}`, patch);
    assert.equal(r.status, 400, `${JSON.stringify(patch)} → ${r.status} ${JSON.stringify(r.payload)}`);
    assert.match(String(r.payload.error), /root account/i);
  }
  const rootStill = (await root('GET', '/api/staff')).payload.users.find(u => u.id === rootId);
  assert.equal(rootStill.role, 'admin'); assert.equal(rootStill.active, true); assert.equal(rootStill.displayName, 'Founder');

  // Root can rename itself and change its own password, but never demote/deactivate itself
  assert.equal((await root('PUT', `/api/staff/${rootId}`, { displayName: 'Founder (root)' })).status, 200);
  assert.equal((await root('PUT', `/api/staff/${rootId}`, { role: 'owner' })).status, 400);
  assert.equal((await root('PUT', `/api/staff/${rootId}`, { active: false })).status, 400);
  const pw = await root('PUT', `/api/staff/${rootId}`, { password: 'rotated-root-password-9' });
  assert.equal(pw.status, 200);
  assert.equal((await root('GET', '/api/auth/status')).payload.authenticated, false, 'password change invalidates sessions');
  assert.equal((await root('POST', '/api/auth/login', { username: 'founder@cheloapp.com', password: 'rotated-root-password-9' })).status, 200);
  assert.equal((await root('GET', '/api/auth/status')).payload.isRoot, true);

  // Other admins keep everyday admin powers: staff management of non-root accounts
  const owner = await other('POST', '/api/staff', { username: 'owner@cheloapp.com', displayName: 'Owner', role: 'owner', password: 'owner-password-strong-1' });
  assert.equal(owner.status, 201);
  assert.equal((await other('PUT', `/api/staff/${owner.payload.id}`, { role: 'reviewer' })).status, 200);
});
