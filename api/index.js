// Vercel serverless entry: delegates every request to the same Node http handler used by `npm start`.
// Serverless filesystems are ephemeral — run with DATA_DIR=/tmp/... and DEMO_OPEN_ACCESS=true for demos only.
const { requestHandler, flushPendingWrites } = require('../server');
module.exports = (req, res) => {
  res.on('finish', () => { try { flushPendingWrites(); } catch (err) { console.error('Flush after response failed:', err.message); } });
  return requestHandler(req, res);
};
