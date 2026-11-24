// Four Desks — Release 1 (v60): one Chelo, four desks (CSI, Marketing, Schools, Suppliers) sharing one engine.
// Accounts hold one or more desks; admins/root hold all; the X-Chelo-Desk header scopes targets by `kind`;
// mailboxes may be tagged to one desk; everything that pre-dates desks is CSI (kind = funder).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const desks = require('../lib/desks');

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
  return async (method, url, body, extra = {}) => {
    const headers = { 'Content-Type': 'application/json', Origin: base, ...extra };
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

test('desks module: catalogue, cleaning, holders, lead kinds', () => {
  assert.deepEqual(desks.DESKS.map(d => d.id), ['csi', 'marketing', 'schools', 'suppliers', 'supporters']);
  assert.deepEqual(desks.cleanDesks(['Marketing', 'csi', 'csi', 'bogus']), ['marketing', 'csi'], 'order kept: first ticked is home'); assert.deepEqual(desks.cleanDesks([]), []); assert.deepEqual(desks.desksOf({ role: 'owner', desks: [] }), ['csi'], 'legacy record with no desks');
  assert.deepEqual(desks.desksOf({ role: 'admin' }), ['csi', 'marketing', 'schools', 'suppliers', 'supporters']);
  assert.deepEqual(desks.desksOf({ role: 'owner', desks: ['schools'] }), ['schools']);
  assert.deepEqual(desks.desksOf({ role: 'owner' }), ['csi'], 'accounts from before desks are CSI');
  assert.equal(desks.resolveDesk({ desks: ['csi', 'marketing'] }, 'marketing'), 'marketing');
  assert.equal(desks.resolveDesk({ desks: ['schools'] }, 'marketing'), 'schools', 'a desk you do not hold falls back to your first desk');
  assert.equal(desks.kindOfLead({}), 'funder');
  assert.equal(desks.deskOfLead({ kind: 'media' }), 'marketing');
  assert.equal(desks.deskOfLead({ kind: 'school' }), 'schools');
  assert.equal(desks.deskOfLead({}), 'csi');
  assert.equal(desks.kindForDesk('suppliers'), 'supplier');
});

test('desks end-to-end: header scopes leads, staff desks, mailbox desk tag', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chelo-desks-'));
  const port = 8400 + Math.floor(Math.random() * 500);
  const child = await startServer({ PORT: String(port), DATA_DIR: dir, NODE_ENV: 'test', SETTINGS_ENCRYPTION_KEY: 'desk-key', SMTP_PROBE_DISABLED: 'true' });
  t.after(() => { child.kill('SIGTERM'); });
  const base = `http://127.0.0.1:${port}`;
  const root = client(base); const naledi = client(base);
  assert.equal((await root('POST', '/api/auth/setup', { username: 'founder@cheloapp.com', displayName: 'Founder', password: 'correct-horse-battery' })).status, 201);
  const status = (await root('GET', '/api/auth/status')).payload;
  assert.deepEqual(status.desks, ['csi', 'marketing', 'schools', 'suppliers', 'supporters'], 'root holds every desk');
  assert.equal(status.deskCatalogue.length, 5);

  // Everything that already exists is CSI.
  const csiCount = (await root('GET', '/api/init', undefined, { 'X-Chelo-Desk': 'csi' })).payload.leads.length;
  assert.ok(csiCount > 0);
  assert.equal((await root('GET', '/api/init', undefined, { 'X-Chelo-Desk': 'marketing' })).payload.leads.length, 0, 'the Marketing desk starts empty');

  // A lead added on the Marketing desk is a media target and shows only there.
  const media = (await root('POST', '/api/leads', { company: 'Daily Maverick', contactName: 'News desk', email: 'csi@github.com', sector: 'Media', province: 'Gauteng' }, { 'X-Chelo-Desk': 'marketing' })).payload;
  assert.ok(media.id, JSON.stringify(media));
  assert.equal(media.kind, 'media');
  assert.equal((await root('GET', '/api/init', undefined, { 'X-Chelo-Desk': 'marketing' })).payload.leads.length, 1);
  assert.equal((await root('GET', '/api/init', undefined, { 'X-Chelo-Desk': 'csi' })).payload.leads.length, csiCount, 'the media target does not leak into CSI');

  // Staff accounts hold desks; a desk you do not hold falls back to one you do.
  const u = (await root('POST', '/api/staff', { username: 'naledi@cheloapp.com', displayName: 'Naledi', role: 'owner', password: 'naledi-strong-password', desks: ['schools', 'marketing'] })).payload;
  assert.deepEqual(u.desks, ['schools', 'marketing'], 'order as ticked: Schools is her home desk');
  assert.equal((await naledi('POST', '/api/auth/login', { username: 'naledi@cheloapp.com', password: 'naledi-strong-password' })).status, 200);
  assert.deepEqual((await naledi('GET', '/api/auth/status')).payload.desks, ['schools', 'marketing']);
  assert.equal((await naledi('GET', '/api/init', undefined, { 'X-Chelo-Desk': 'csi' })).payload.leads.length, 0, 'asking for CSI without holding it gives her first desk (empty for her)');
  const updated = (await root('PUT', `/api/staff/${encodeURIComponent(u.id)}`, { desks: ['csi'] })).payload;
  assert.deepEqual(updated.desks, ['csi']);

  // Mailbox desk tag.
  const mb = (await root('POST', '/api/deliverability/mailboxes', { label: 'Press', fromEmail: 'press@github.com', fromName: 'Chelo Press', host: '127.0.0.1', port: 2525, username: 'u', password: 'secret-pass' })).payload;
  const mbId = mb.id || mb.mailbox?.id;
  assert.ok(mbId, JSON.stringify(mb));
  const tagged = (await root('PUT', `/api/deliverability/mailboxes/${encodeURIComponent(mbId)}/desk`, { desk: 'marketing' })).payload;
  assert.equal((tagged.mailbox || tagged).desk, 'marketing');
  assert.equal((await root('PUT', `/api/deliverability/mailboxes/${encodeURIComponent(mbId)}/desk`, { desk: 'nonsense' })).status, 400);
});
