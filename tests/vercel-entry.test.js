const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('vercel entry: durable push completes before the response is finished (function may freeze at finish)', async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chelo-entry-'));
  process.env.NODE_ENV = 'test'; process.env.SETTINGS_ENCRYPTION_KEY = 'entry-key'; process.env.SMTP_PROBE_DISABLED = 'true';
  const { deferEndUntilPersisted } = require('../api/index.js');
  const order = [];
  const app = { flushPendingWrites: () => order.push('flush'), remoteSync: { push: async () => { await new Promise(r => setTimeout(r, 30)); order.push('push'); return { pushed: 1 }; } } };
  const res = { end: (...args) => { order.push(`end:${args[0]}`); } };
  deferEndUntilPersisted(app, res);
  res.end('{"ok":true}'); res.end('again-ignored');
  await new Promise(r => setTimeout(r, 80));
  assert.deepEqual(order, ['flush', 'push', 'end:{"ok":true}']);
});

test('vercel entry: a warm instance that is behind the shared snapshot reloads the app before serving (no stale drafts, no stale overwrites)', async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chelo-entry2-'));
  process.env.NODE_ENV = 'test'; process.env.SETTINGS_ENCRYPTION_KEY = 'entry-key'; process.env.SMTP_PROBE_DISABLED = 'true'; process.env.DEMO_OPEN_ACCESS = 'true';
  process.env.SUPABASE_URL = 'https://example.supabase.co'; process.env.SUPABASE_SERVICE_KEY = 'k';
  const log = [];
  let version = 1; let remote = 1;
  const fake = { get version() { return version; }, ensureBucket: async () => {}, pull: async () => { log.push('pull'); version = remote; return { pulled: 0, version }; }, push: async () => { log.push('push'); version = remote = version + 1; return { pushed: 1 }; }, checkFresh: async () => { log.push('check'); return { stale: remote > version, remoteVersion: remote, localVersion: version }; }, status: () => ({}), setBeforeSnapshot: () => {}, probe: async () => ({ ok: true }) };
  globalThis.__cheloRemoteSync = fake;
  for (const key of Object.keys(require.cache)) if (/[\\/](api|server\.js|lib)[\\/]?/.test(key) && !key.includes('node_modules')) delete require.cache[key];
  const handler = require('../api/index.js');
  const call = (method, url) => new Promise(resolve => {
    const req = { method, url, headers: { host: 'x', 'content-type': 'application/json' }, on: (ev, fn) => { if (ev === 'end') fn(); return req; }, once() { return req; }, socket: { remoteAddress: '127.0.0.1' } };
    let body = ''; const listeners = {};
    const res = { statusCode: 200, headersSent: false, setHeader() {}, getHeader() {}, writeHead(c) { this.statusCode = c; }, write(c) { body += c; }, end(c) { if (c) body += c; (listeners.finish || []).forEach(f => f()); resolve({ status: res.statusCode, body }); }, once(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); }, on(ev, fn) { this.once(ev, fn); } };
    handler(req, res);
  });
  const first = await call('GET', '/api/init');
  assert.equal(first.status, 200);
  assert.ok(log.includes('check'), 'checks the manifest on an API request');
  assert.ok(!log.includes('pull') || log.indexOf('pull') < log.indexOf('check'), 'no reload while up to date');
  // Another instance writes → version 2. The next request must pull + reload before serving.
  remote = 2; log.length = 0;
  await new Promise(r => setTimeout(r, 2100)); // past the GET throttle
  const second = await call('GET', '/api/init');
  assert.equal(second.status, 200);
  assert.deepEqual(log.slice(0, 2), ['check', 'pull'], 'stale instance pulled the newer snapshot');
  assert.equal(version, 2);
  // Mutating requests always check (never save over newer data), even inside the throttle window.
  log.length = 0;
  await call('POST', '/api/engine/nudge');
  assert.equal(log[0], 'check');
  delete globalThis.__cheloRemoteSync; delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
});
