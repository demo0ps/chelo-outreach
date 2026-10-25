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
