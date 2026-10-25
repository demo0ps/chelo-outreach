#!/usr/bin/env node
// Long-running start (Docker / VPS / laptop): optional Supabase durable sync, then the normal http server.
const path = require('node:path');
const { fromEnv } = require('./lib/remote-sync');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
process.env.DATA_DIR = DATA_DIR;
(async () => {
  const sync = fromEnv(DATA_DIR);
  if (sync) { try { await sync.ensureBucket(); await sync.pull(); } catch (err) { console.error('[remote-sync] pull failed; continuing with local data:', err.message); } }
  const app = require('./server');
  app.listen();
  if (app.remoteSync) {
    const every = Math.max(15, Number(process.env.SYNC_INTERVAL_SECONDS || 60)) * 1000;
    setInterval(() => { app.flushPendingWrites(); app.remoteSync.push(); }, every).unref();
  }
})();
