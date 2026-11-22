// Vercel serverless entry: delegates every request to the same Node http handler used by `npm start`.
// Serverless filesystems are ephemeral. With SUPABASE_URL + SUPABASE_SERVICE_KEY set, the data directory is
// pulled from a private Supabase Storage bucket on cold start and pushed back after every mutating request,
// so the workspace survives restarts. Without them, run with DATA_DIR=/tmp/... + DEMO_OPEN_ACCESS=true (demo only).
//
// IMPORTANT ordering: Vercel may freeze the function the moment the HTTP response completes. Anything still in
// flight at that point (a TLS handshake, an upload) is suspended and later fails with "socket disconnected before
// secure TLS connection was established" or an abort timeout. So for mutating requests the push runs *inside*
// res.end(): the SQLite checkpoint + upload complete first, then the response body is finished.
const path = require('node:path');
const { fromEnv } = require('../lib/remote-sync');
const DATA_DIR = path.resolve(process.env.DATA_DIR || '/tmp/chelo-data');
process.env.DATA_DIR = DATA_DIR;
const PUSH_BUDGET_MS = Number(process.env.SYNC_PUSH_BUDGET_MS) || 40000; // < Vercel maxDuration (60 s)
const ROOT = path.resolve(__dirname, '..');
function loadApp() { return require('../server'); }
let booted = (async () => {
  const sync = fromEnv(DATA_DIR);
  if (sync) { try { await sync.ensureBucket(); await sync.pull(); } catch (err) { console.error('[remote-sync] cold-start pull failed; continuing with local data:', err.message); } }
  return loadApp();
})();

// Several warm instances serve one workspace. Each loads the snapshot at cold start; if another instance pushed since,
// this one is stale (drafts/PDFs "missing", and its next save would overwrite newer data). So before handling a request we
// compare the shared manifest version with ours (one small read, throttled for GETs) and, when behind, pull and re-require
// the app so every module re-reads SQLite/settings from disk. Costs ~1 s only when somebody else actually wrote.
const CHECK_EVERY_MS = Number(process.env.SYNC_CHECK_INTERVAL_MS) || 2000;
let lastCheckAt = 0, reloading = null;
// /api/auth/status is included: it is the only call the login page makes, and it decides whether Sign in with Google is offered.
function needsFreshness(req) { return /^\/(api|track|proposal|book|opt-out|p)\b/.test(req.url) && !/^\/api\/health\b/.test(req.url); }
async function ensureFresh(req) {
  const app = await booted;
  if (!app.remoteSync || !needsFreshness(req)) return app;
  const mutating = isMutating(req);
  if (!mutating && Date.now() - lastCheckAt < CHECK_EVERY_MS) return app;
  lastCheckAt = Date.now();
  const check = await app.remoteSync.checkFresh();
  if (!check.stale) return app;
  if (!reloading) {
    reloading = (async () => {
      console.log(`[remote-sync] snapshot v${check.remoteVersion} is newer than local v${check.localVersion}; reloading`);
      try { app.close(); } catch (err) { console.error('[remote-sync] close before reload failed:', err.message); }
      for (const key of Object.keys(require.cache)) if (key.startsWith(ROOT) && !key.includes('node_modules') && !key.startsWith(path.join(ROOT, 'api'))) delete require.cache[key];
      try { await app.remoteSync.pull(); } catch (err) { console.error('[remote-sync] reload pull failed:', err.message); }
      return loadApp();
    })();
    booted = reloading.finally(() => { reloading = null; });
  }
  return booted;
}

function isMutating(req) { return !['GET', 'HEAD', 'OPTIONS'].includes(req.method) || /^\/api\/cron\//.test(req.url) || /^\/track\//.test(req.url) || /^\/api\/oauth\//.test(req.url) || /^\/api\/auth\/google\/callback/.test(req.url); } // Google returns with GET, but it creates sessions/accounts/mailboxes

async function persist(app) {
  try { app.flushPendingWrites(); } catch (err) { console.error('Flush failed:', err.message); }
  if (!app.remoteSync) return;
  try { await Promise.race([app.remoteSync.push(), new Promise(resolve => setTimeout(resolve, PUSH_BUDGET_MS))]); }
  catch (err) { console.error('[remote-sync] push failed:', err.message); }
}

// Wrap res.end so the durable push completes before the response is finished (and the function frozen).
function deferEndUntilPersisted(app, res) {
  const originalEnd = res.end.bind(res);
  let wrapped = false;
  res.end = (...args) => {
    if (wrapped) return res;
    wrapped = true;
    persist(app).finally(() => originalEnd(...args));
    return res;
  };
}

module.exports = async (req, res) => {
  const app = await ensureFresh(req);
  const mutating = isMutating(req);
  if (mutating && app.remoteSync) deferEndUntilPersisted(app, res);
  await new Promise(resolve => { res.once('finish', resolve); res.once('close', resolve); Promise.resolve(app.requestHandler(req, res)).catch(err => { console.error(err); if (!res.headersSent) { res.statusCode = 500; res.end('Internal error'); } else if (!res.writableEnded) res.end(); resolve(); }); });
  if (mutating && !app.remoteSync) { try { app.flushPendingWrites(); } catch (err) { console.error('Flush after response failed:', err.message); } }
};
module.exports.deferEndUntilPersisted = deferEndUntilPersisted;
