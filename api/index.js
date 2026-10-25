// Vercel serverless entry: delegates every request to the same Node http handler used by `npm start`.
// Serverless filesystems are ephemeral. With SUPABASE_URL + SUPABASE_SERVICE_KEY set, the data directory is
// pulled from a private Supabase Storage bucket on cold start and pushed back after every mutating request,
// so the workspace survives restarts. Without them, run with DATA_DIR=/tmp/... + DEMO_OPEN_ACCESS=true (demo only).
const path = require('node:path');
const { fromEnv } = require('../lib/remote-sync');
const DATA_DIR = path.resolve(process.env.DATA_DIR || '/tmp/chelo-data');
process.env.DATA_DIR = DATA_DIR;
const booted = (async () => {
  const sync = fromEnv(DATA_DIR);
  if (sync) { try { await sync.ensureBucket(); await sync.pull(); } catch (err) { console.error('[remote-sync] cold-start pull failed; continuing with local data:', err.message); } }
  return require('../server');
})();
module.exports = async (req, res) => {
  const app = await booted;
  await new Promise(resolve => { res.once('finish', resolve); res.once('close', resolve); Promise.resolve(app.requestHandler(req, res)).catch(err => { console.error(err); if (!res.headersSent) { res.statusCode = 500; res.end('Internal error'); } resolve(); }); });
  try { app.flushPendingWrites(); } catch (err) { console.error('Flush after response failed:', err.message); }
  const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method) || /^\/api\/cron\//.test(req.url) || /^\/track\//.test(req.url);
  if (app.remoteSync && mutating) await app.remoteSync.push();
};
