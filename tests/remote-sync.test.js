const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createRemoteSync, TRACKED } = require('../lib/remote-sync');

// Minimal stand-in for Supabase Storage's object API (POST upsert / GET / bucket create).
function fakeStorage() {
  const objects = new Map(); let calls = [];
  const server = http.createServer((req, res) => {
    calls.push(`${req.method} ${req.url}`);
    const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
      const body = Buffer.concat(chunks);
      if (req.headers.authorization !== 'Bearer service-key') { res.writeHead(401); return res.end('{"error":"unauthorised"}'); }
      if (req.method === 'POST' && req.url === '/storage/v1/bucket') { res.writeHead(objects.has('__bucket') ? 409 : 200); objects.set('__bucket', 1); return res.end('{}'); }
      const m = req.url.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/); if (!m) { res.writeHead(404); return res.end(); }
      const key = decodeURIComponent(m[2]);
      if (req.method === 'POST') { if (objects.has(key) && req.headers['x-upsert'] !== 'true') { res.writeHead(409); return res.end(); } objects.set(key, body); res.writeHead(200); return res.end('{"Key":"x"}'); }
      if (req.method === 'GET') { if (!objects.has(key)) { res.writeHead(404); return res.end('{"error":"not found"}'); } res.writeHead(200); return res.end(objects.get(key)); }
      res.writeHead(405); res.end();
    });
  });
  return { server, objects, calls, start: () => new Promise(r => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}`))) };
}

test('remote-sync: push uploads only changed files with a versioned manifest; pull restores a wiped data dir; conflicts are counted not fatal', async t => {
  const storage = fakeStorage(); const url = await storage.start(); t.after(() => storage.server.close());
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-a-')); const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-b-'));
  fs.writeFileSync(path.join(dirA, 'chelo.sqlite'), Buffer.from('sqlite-bytes-v1')); fs.writeFileSync(path.join(dirA, 'settings.json'), '{"a":1}'); fs.writeFileSync(path.join(dirA, '.settings-key'), 'k');
  fs.writeFileSync(path.join(dirA, 'chelo.sqlite-wal'), 'wal'); // must never be uploaded
  let checkpoints = 0;
  const a = createRemoteSync({ url, serviceKey: 'service-key', bucket: 'chelo-data', dataDir: dirA, log: console.log, beforeSnapshot: () => { checkpoints += 1; } });
  await a.ensureBucket(); await a.ensureBucket(); // idempotent (409 tolerated)
  const first = await a.push(); assert.equal(first.pushed, 3); assert.equal(first.version, 1); assert.equal(checkpoints, 1);
  assert.ok(!storage.objects.has('workspace/chelo.sqlite-wal')); assert.ok(storage.objects.has('workspace/.settings-key'));
  assert.deepEqual(await a.push(), { pushed: 0 }, 'unchanged → nothing uploaded');
  fs.writeFileSync(path.join(dirA, 'chelo.sqlite'), Buffer.from('sqlite-bytes-v2'));
  const second = await a.push(); assert.equal(second.pushed, 1); assert.equal(second.version, 2);
  const manifest = JSON.parse(storage.objects.get('workspace/manifest.json').toString()); assert.equal(manifest.version, 2); assert.equal(Object.keys(manifest.files).length, 3);

  // Cold start elsewhere: pull restores everything (and drops stale WAL/SHM)
  fs.writeFileSync(path.join(dirB, 'chelo.sqlite-shm'), 'stale');
  const b = createRemoteSync({ url, serviceKey: 'service-key', bucket: 'chelo-data', dataDir: dirB });
  const pulled = await b.pull(); assert.equal(pulled.pulled, 3); assert.equal(pulled.version, 2);
  assert.equal(fs.readFileSync(path.join(dirB, 'chelo.sqlite'), 'utf8'), 'sqlite-bytes-v2'); assert.ok(!fs.existsSync(path.join(dirB, 'chelo.sqlite-shm')));
  assert.deepEqual(await b.pull(), { pulled: 0, version: 2 }, 'second pull is a no-op when hashes match');
  // Both instances write: B pushes v3, then A (still at v2) pushes → conflict counted, last writer wins at v4
  fs.writeFileSync(path.join(dirB, 'settings.json'), '{"a":2}'); assert.equal((await b.push()).version, 3);
  fs.writeFileSync(path.join(dirA, 'settings.json'), '{"a":3}'); const r = await a.push(); assert.equal(r.version, 4); assert.equal(a.status().conflicts, 1);
  assert.equal(TRACKED.length, 5);
  // Fresh bucket → pull reports fresh, no throw
  const c = createRemoteSync({ url, serviceKey: 'service-key', bucket: 'chelo-data', prefix: 'other', dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'rs-c-')) });
  assert.equal((await c.pull()).fresh, true);
  // Bad key → push returns error (never throws into the request path)
  const bad = createRemoteSync({ url, serviceKey: 'wrong', bucket: 'chelo-data', dataDir: dirA }); const res = await bad.push({ force: true }); assert.ok(res.error); assert.match(bad.status().lastError, /401/);
});

test('remote-sync: end-to-end with the real server — mutations persist across a simulated cold start', async t => {
  const storage = fakeStorage(); const url = await storage.start(); t.after(() => storage.server.close());
  const { spawn } = require('node:child_process');
  const ROOT = path.join(__dirname, '..');
  const boot = (dir, port) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'start.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), DATA_DIR: dir, NODE_ENV: 'test', SETTINGS_ENCRYPTION_KEY: 'rs-key', SMTP_PROBE_DISABLED: 'true', SUPABASE_URL: url, SUPABASE_SERVICE_KEY: 'service-key', SYNC_INTERVAL_SECONDS: '15' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; const timer = setTimeout(() => reject(new Error(`no start: ${out}`)), 15000);
    child.stdout.on('data', c => { out += c; if (/running at/.test(out)) { clearTimeout(timer); resolve(child); } }); child.stderr.on('data', c => { out += c; });
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`exit ${code}: ${out}`)); });
  });
  const api = (base, jar) => async (method, p, body) => {
    const headers = { 'Content-Type': 'application/json', Origin: base }; if (jar.cookie) headers.Cookie = jar.cookie; if (jar.csrf) headers['X-CSRF-Token'] = jar.csrf;
    const res = await fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0];
    const payload = (res.headers.get('content-type') || '').includes('json') ? await res.json() : null; if (payload?.csrfToken) jar.csrf = payload.csrfToken; return { status: res.status, payload };
  };
  const port1 = 7200 + Math.floor(Math.random() * 300); const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-s1-'));
  const s1 = await boot(dir1, port1); const base1 = `http://127.0.0.1:${port1}`; const jar1 = {}; const a1 = api(base1, jar1);
  assert.equal((await a1('POST', '/api/auth/setup', { username: 'admin@cheloapp.com', displayName: 'Nandi', password: 'correct-horse-battery' })).status, 201);
  assert.equal((await a1('POST', '/api/leads', { company: 'Durable Co', contactName: 'Keep Me', website: 'https://www.durable.co.za/', sourceName: 'Website' })).status, 201);
  const st = (await a1('GET', '/api/storage')).payload; assert.equal(st.durable, true);
  await new Promise(r => { s1.on('exit', r); s1.kill('SIGTERM'); }); // graceful stop pushes the final snapshot
  assert.ok(storage.objects.has('workspace/chelo.sqlite') && storage.objects.has('workspace/auth.json'), 'snapshot uploaded on shutdown');
  // "Cold start" on a brand-new empty directory → pulls the snapshot → login + lead still there
  const port2 = port1 + 1; const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-s2-'));
  const s2 = await boot(dir2, port2); t.after(() => s2.kill('SIGTERM')); const base2 = `http://127.0.0.1:${port2}`; const jar2 = {}; const a2 = api(base2, jar2);
  const login = await a2('POST', '/api/auth/login', { username: 'admin@cheloapp.com', password: 'correct-horse-battery' }); assert.equal(login.status, 200, JSON.stringify(login.payload));
  const leads = (await a2('GET', '/api/leads')).payload; assert.ok(leads.some(l => l.company === 'Durable Co'), 'lead survived the cold start');
  const st2 = (await a2('GET', '/api/storage')).payload; assert.ok(st2.sync.lastPullAt);
});
