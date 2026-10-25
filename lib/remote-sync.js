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

function createRemoteSync({ url, serviceKey, bucket = 'chelo-data', dataDir, prefix = 'workspace', fetchImpl = globalThis.fetch, log = () => {}, beforeSnapshot = null, timeoutMs = Number(process.env.SUPABASE_TIMEOUT_MS) || 25000 } = {}) {
  const hooks = { beforeSnapshot };
  if (!url || !serviceKey || !dataDir) throw new Error('remote-sync requires url, serviceKey and dataDir');
  const base = String(url).replace(/\/+$/, '');
  const headers = { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey };
  const state = { enabled: true, bucket, lastPullAt: null, lastPushAt: null, lastError: null, version: 0, remoteVersion: null, conflicts: 0, pushes: 0, uploadedBytes: 0, hashes: {} };
  const objUrl = name => `${base}/storage/v1/object/${encodeURIComponent(bucket)}/${prefix}/${encodeURIComponent(name)}`;

  async function call(method, target, { body, type, extra = {} } = {}) {
    const res = await fetchImpl(target, { method, headers: { ...headers, ...(type ? { 'Content-Type': type } : {}), ...extra }, body, signal: AbortSignal.timeout(timeoutMs) });
    return res;
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
    for (const name of TRACKED) { const file = path.join(dataDir, name); if (fs.existsSync(file)) out[name] = fs.readFileSync(file); }
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
        log(`pushed ${changed.length} file(s) → v${version}`);
        return { pushed: changed.length, version };
      } catch (err) { state.lastError = `push: ${err.message}`; log(state.lastError); return { pushed: 0, error: err.message }; }
      finally { pushing = null; }
    };
    pushing = run();
    return pushing;
  }
  function status() { return { ...state, hashes: undefined, provider: 'supabase-storage', prefix, tracked: TRACKED, timeoutMs, localBytes: Object.values(localFiles()).reduce((n, b) => n + b.length, 0) }; }
  // Diagnostic: one round-trip to the bucket endpoint so operators can see reachability, auth and latency.
  async function probe() {
    const started = Date.now();
    try {
      const res = await fetchImpl(`${base}/storage/v1/bucket/${encodeURIComponent(bucket)}`, { headers, signal: AbortSignal.timeout(8000) });
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

module.exports = { createRemoteSync, fromEnv, TRACKED };
