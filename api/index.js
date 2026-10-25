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
const booted = (async () => {
  const sync = fromEnv(DATA_DIR);
  if (sync) { try { await sync.ensureBucket(); await sync.pull(); } catch (err) { console.error('[remote-sync] cold-start pull failed; continuing with local data:', err.message); } }
  return require('../server');
})();

function isMutating(req) { return !['GET', 'HEAD', 'OPTIONS'].includes(req.method) || /^\/api\/cron\//.test(req.url) || /^\/track\//.test(req.url); }

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
  const app = await booted;
  const mutating = isMutating(req);
  if (mutating && app.remoteSync) deferEndUntilPersisted(app, res);
  await new Promise(resolve => { res.once('finish', resolve); res.once('close', resolve); Promise.resolve(app.requestHandler(req, res)).catch(err => { console.error(err); if (!res.headersSent) { res.statusCode = 500; res.end('Internal error'); } else if (!res.writableEnded) res.end(); resolve(); }); });
  if (mutating && !app.remoteSync) { try { app.flushPendingWrites(); } catch (err) { console.error('Flush after response failed:', err.message); } }
};
module.exports.deferEndUntilPersisted = deferEndUntilPersisted;
