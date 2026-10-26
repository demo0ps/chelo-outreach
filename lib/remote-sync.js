'use strict';
// Durable storage on ephemeral hosts (Vercel) — zero dependencies.
// Mirrors the workspace data directory (SQLite file + settings/auth/audit JSON) to a private Supabase Storage
// bucket over plain HTTPS. Pull on cold start, push after every mutating request. Optimistic concurrency via a
// manifest version: if another instance pushed in between we log + record the conflict (last writer wins) —
// acceptable for a small team; the hash check means unchanged files are never re-uploaded.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const TRACKED = ['chelo.sqlite', 'settings.json', 'auth.json', 'audit.jsonl', '.settings-key'];

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

function httpsFetch(target, { method = 'GET', headers = {}, body, timeoutMs = 25000 } = {}) {
  const mod = String(target).startsWith('http:') ? require('node:http') : require('node:https');
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    const req = mod.request(target, { method, agent: false, headers: { ...headers, Connection: 'close', ...(payload ? { 'Content-Length': payload.length } : {}) } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => { const buf = Buffer.concat(chunks); resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text: async () => buf.toString('utf8'), json: async () => JSON.parse(buf.toString('utf8')), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }); });
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`The operation was aborted due to timeout (${method} after ${timeoutMs} ms)`)));
    req.on('error', reject);
    if (payload) req.end(payload); else req.end();
  });
}

function createRemoteSync({ url, serviceKey, bucket = 'chelo-data', dataDir, prefix = 'workspace', fetchImpl = globalThis.fetch, log = () => {}, beforeSnapshot = null, timeoutMs = Number(process.env.SUPABASE_TIMEOUT_MS) || 25000 } = {}) {
  const hooks = { beforeSnapshot };
  if (!url || !serviceKey || !dataDir) throw new Error('remote-sync requires url, serviceKey and dataDir');
  const base = String(url).replace(/\/+$/, '');
  const headers = { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey };
  const state = { enabled: true, bucket, lastPullAt: null, lastPushAt: null, lastError: null, version: 0, remoteVersion: null, conflicts: 0, pushes: 0, uploadedBytes: 0, hashes: {} };
  const objUrl = name => `${base}/storage/v1/object/${encodeURIComponent(bucket)}/${prefix}/${encodeURIComponent(name)}`;

  // Transport: fresh TLS connection per call (agent:false). Serverless hosts freeze the process between
  // invocations; a kept-alive socket that the remote edge has since closed makes POST uploads hang until
  // timeout (Node retries idempotent GETs on a dead socket, never POSTs). Tests inject fetchImpl instead.
  const transport = fetchImpl !== globalThis.fetch ? fetchImpl : httpsFetch;
  async function call(method, target, { body, type, extra = {} } = {}) {
    const init = { method, headers: { ...headers, ...(type ? { 'Content-Type': type } : {}), ...extra }, body, timeoutMs };
    try { return await transport(target, init); }
    catch (err) { if (!/abort|timeout|ECONNRESET|EPIPE|socket hang up/i.test(err.message)) throw err; log(`${method} ${target.split('/storage/')[1]} ${err.message} — retrying once on a fresh connection`); return transport(target, init); }
  }
  async function ensureBucket() {
    const res = await call('POST', `${base}/storage/v1/bucket`, { body: JSON.stringify({ id: bucket, name: bucket, public: false }), type: 'application/json' });
    if (res.ok || res.status === 409 || res.status === 400) return true; // 400/409 = already exists
    throw new Error(`bucket create failed: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
  }
  async function download(name) {
    const res = await call('GET', objUrl(name));
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new Error(`download ${name}: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  async function upload(name, buf, type = 'application/octet-stream') {
    const res = await call('POST', objUrl(name), { body: buf, type, extra: { 'x-upsert': 'true', 'cache-control': 'no-store' } });
    if (!res.ok) throw new Error(`upload ${name}: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
    state.uploadedBytes += buf.length;
  }
  async function readManifest() { const buf = await download('manifest.json'); if (!buf) return null; try { return JSON.parse(buf.toString('utf8')); } catch { return null; } }

  function localFiles() {
    const out = {};
    // Key separation: when SETTINGS_ENCRYPTION_KEY is set the env is authoritative and the local key file is never uploaded,
    // so bucket access alone cannot decrypt stored mailbox/API secrets.
    const tracked = process.env.SETTINGS_ENCRYPTION_KEY ? TRACKED.filter(n => n !== '.settings-key') : TRACKED;
    for (const name of tracked) { const file = path.join(dataDir, name); if (fs.existsSync(file)) out[name] = fs.readFileSync(file); }
    return out;
  }

  // Cold start: bring the remote snapshot down before the SQLite store opens.
  async function pull() {
    try {
      fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
      const manifest = await readManifest();
      if (!manifest) { state.lastPullAt = new Date().toISOString(); state.remoteVersion = 0; log('no remote snapshot yet — starting fresh'); return { pulled: 0, fresh: true }; }
      let pulled = 0;
      for (const [name, meta] of Object.entries(manifest.files || {})) {
        if (!TRACKED.includes(name)) continue;
        const file = path.join(dataDir, name);
        if (fs.existsSync(file) && sha256(fs.readFileSync(file)) === meta.sha256) { state.hashes[name] = meta.sha256; continue; }
        const buf = await download(name);
        if (!buf) continue;
        if (sha256(buf) !== meta.sha256) log(`warning: ${name} hash mismatch vs manifest (partial push?) — using downloaded copy`);
        fs.writeFileSync(file, buf, { mode: name === '.settings-key' ? 0o600 : 0o644 });
        state.hashes[name] = sha256(buf); pulled += 1;
      }
      for (const stale of ['chelo.sqlite-wal', 'chelo.sqlite-shm']) { try { fs.unlinkSync(path.join(dataDir, stale)); } catch {} }
      state.version = state.remoteVersion = Number(manifest.version || 0); state.lastPullAt = new Date().toISOString(); state.lastError = null;
      log(`pulled ${pulled} file(s), snapshot v${state.version} from ${manifest.pushedAt || '?'}`);
      return { pulled, version: state.version };
    } catch (err) { state.lastError = `pull: ${err.message}`; log(state.lastError); throw err; }
  }

  // Daily point-in-time copies under <prefix>/history/<YYYY-MM-DD>/ (first push of each UTC day), pruned to HISTORY_DAYS.
  const HISTORY_DAYS = Number(process.env.SUPABASE_HISTORY_DAYS) || 7;
  const histUrl = (day, name) => `${base}/storage/v1/object/${encodeURIComponent(bucket)}/${prefix}/history/${day}/${encodeURIComponent(name)}`;
  async function snapshotHistory(files, manifest) {
    if (!HISTORY_DAYS) return;
    const day = new Date().toISOString().slice(0, 10);
    if (state.lastHistoryDay === day) return;
    const head = await call('GET', histUrl(day, 'manifest.json'));
    if (head.ok) { state.lastHistoryDay = day; return; } // another instance already wrote today's copy
    for (const [name, buf] of Object.entries(files)) {
      const res = await call('POST', histUrl(day, name), { body: buf, type: 'application/octet-stream', extra: { 'x-upsert': 'true' } });
      if (!res.ok) throw new Error(`history upload ${name}: HTTP ${res.status}`);
    }
    await call('POST', histUrl(day, 'manifest.json'), { body: Buffer.from(JSON.stringify(manifest)), type: 'application/json', extra: { 'x-upsert': 'true' } });
    state.lastHistoryDay = day; state.historyDays = (state.historyDays || 0) + 1;
    await pruneHistory(day);
  }
  async function pruneHistory(today) {
    const res = await call('POST', `${base}/storage/v1/object/list/${encodeURIComponent(bucket)}`, { body: JSON.stringify({ prefix: `${prefix}/history/`, limit: 1000 }), type: 'application/json' });
    if (!res.ok) return;
    const entries = await res.json().catch(() => []);
    const days = entries.map(e => e.name).filter(n => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort();
    const cutoff = new Date(Date.parse(today) - (HISTORY_DAYS - 1) * 86400000).toISOString().slice(0, 10);
    const stale = days.filter(d => d < cutoff);
    if (!stale.length) return;
    const prefixes = stale.flatMap(d => [...TRACKED, 'manifest.json'].map(n => `${prefix}/history/${d}/${n}`));
    await call('DELETE', `${base}/storage/v1/object/${encodeURIComponent(bucket)}`, { body: JSON.stringify({ prefixes }), type: 'application/json' });
    log(`history: pruned ${stale.length} day(s) older than ${cutoff}`);
  }

  let pushing = null;
  // After mutations: upload only files whose content hash changed; bump manifest version.
  async function push({ force = false } = {}) {
    if (pushing) return pushing; // coalesce concurrent pushes
    if (hooks.beforeSnapshot) { try { hooks.beforeSnapshot(); } catch (err) { log(`checkpoint: ${err.message}`); } }
    const files = localFiles();
    const changed = Object.entries(files).filter(([name, buf]) => force || state.hashes[name] !== sha256(buf));
    if (!changed.length) return { pushed: 0 };
    const run = async () => {
      try {
        const remote = await readManifest();
        const remoteVersion = Number(remote?.version || 0);
        if (remote && remoteVersion !== state.version) { state.conflicts += 1; log(`conflict: remote v${remoteVersion} ≠ local v${state.version}; another instance wrote in between — last writer wins`); }
        for (const [name, buf] of changed) { await upload(name, buf, name.endsWith('.json') ? 'application/json' : 'application/octet-stream'); state.hashes[name] = sha256(buf); }
        const version = Math.max(remoteVersion, state.version) + 1;
        const manifest = { version, pushedAt: new Date().toISOString(), host: process.env.VERCEL_REGION || require('node:os').hostname(), files: Object.fromEntries(Object.entries(files).map(([name, buf]) => [name, { sha256: sha256(buf), size: buf.length }])) };
        await upload('manifest.json', Buffer.from(JSON.stringify(manifest)), 'application/json');
        state.version = state.remoteVersion = version; state.lastPushAt = manifest.pushedAt; state.pushes += 1; state.lastError = null;
        await snapshotHistory(files, manifest).catch(err => log(`history: ${err.message}`));
        log(`pushed ${changed.length} file(s) → v${version}`);
        return { pushed: changed.length, version };
      } catch (err) { state.lastError = `push: ${err.message}`; log(state.lastError); return { pushed: 0, error: err.message }; }
      finally { pushing = null; }
    };
    pushing = run();
    return pushing;
  }
  function status() { return { ...state, hashes: undefined, provider: 'supabase-storage', prefix, tracked: TRACKED, timeoutMs, historyDays: HISTORY_DAYS, lastHistoryDay: state.lastHistoryDay || null, localBytes: Object.values(localFiles()).reduce((n, b) => n + b.length, 0) }; }
  // Diagnostic: one round-trip to the bucket endpoint so operators can see reachability, auth and latency.
  async function probe() {
    const started = Date.now();
    try {
      const res = await transport(`${base}/storage/v1/bucket/${encodeURIComponent(bucket)}`, { method: 'GET', headers, timeoutMs: 8000 });
      const text = (await res.text()).slice(0, 200);
      const verdict = res.ok ? 'ok' : res.status === 404 ? 'bucket-missing' : (res.status === 401 || res.status === 403) ? 'auth-failed' : 'http-error';
      return { ok: res.ok, verdict, status: res.status, ms: Date.now() - started, host: new URL(base).host, body: res.ok ? undefined : text };
    } catch (err) {
      const timeout = /abort|timeout/i.test(err.message);
      return { ok: false, verdict: timeout ? 'unreachable-timeout' : 'network-error', ms: Date.now() - started, host: new URL(base).host, error: err.message, hint: timeout ? 'Supabase did not answer within 8 s. Most common cause: the Supabase project is PAUSED (free tier pauses after inactivity) — open the Supabase dashboard and click Restore.' : undefined };
    }
  }
  return { pull, push, ensureBucket, probe, status, TRACKED, setBeforeSnapshot(fn) { hooks.beforeSnapshot = fn; } };
}

function fromEnv(dataDir, extra = {}) {
  const url = process.env.SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  if (globalThis.__cheloRemoteSync) return globalThis.__cheloRemoteSync;
  return globalThis.__cheloRemoteSync = createRemoteSync({ url, serviceKey: key, bucket: process.env.SUPABASE_BUCKET || 'chelo-data', prefix: process.env.SUPABASE_PREFIX || 'workspace', dataDir, log: m => console.log(`[remote-sync] ${m}`), ...extra });
}

module.exports = { createRemoteSync, fromEnv, httpsFetch, TRACKED };
