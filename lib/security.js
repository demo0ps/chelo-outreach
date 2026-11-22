'use strict';
// Four Desks — Release 5 (v64): security backlog. Pure helpers, no I/O.
//   - rateLimiter: fixed-window counter per key (IP or session), used API-wide, not only at login.
//   - TOTP (RFC 6238, SHA-1, 30 s, 6 digits) for two-step sign-in with any authenticator app; base32 per RFC 4648.
//   - Recovery codes: 8 one-time codes, stored hashed, each usable once.
//   - mfaChallenges: a short-lived token between "password correct" and "code correct" so no session exists in between.
const crypto = require('node:crypto');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) { value = (value << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}

function generateSecret(bytes = 20) { return base32Encode(crypto.randomBytes(bytes)); }
function hotp(secretB32, counter, digits = 6) {
  const key = base32Decode(secretB32);
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(msg).digest();
  const off = h[h.length - 1] & 0x0f;
  const code = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(code % 10 ** digits).padStart(digits, '0');
}
function totp(secretB32, { time = Date.now(), step = 30, digits = 6 } = {}) { return hotp(secretB32, Math.floor(time / 1000 / step), digits); }
/** Accepts the current code and one step either side (clock drift). Returns the matched counter so a code cannot be replayed within its window. */
function verifyTotp(secretB32, code, { time = Date.now(), step = 30, window = 1, lastCounter = -1 } = {}) {
  const wanted = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(wanted)) return { ok: false };
  const base = Math.floor(time / 1000 / step);
  for (let d = -window; d <= window; d += 1) {
    const counter = base + d;
    if (counter <= lastCounter) continue;
    const a = Buffer.from(hotp(secretB32, counter)); const b = Buffer.from(wanted);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return { ok: true, counter };
  }
  return { ok: false };
}
function otpauthUrl({ secret, account, issuer = 'Chelo' }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

const hashCode = code => crypto.createHash('sha256').update(String(code).toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex');
function makeRecoveryCodes(n = 8) {
  const plain = Array.from({ length: n }, () => { const s = base32Encode(crypto.randomBytes(5)).slice(0, 8); return `${s.slice(0, 4)}-${s.slice(4)}`; });
  return { plain, hashes: plain.map(hashCode) };
}
/** Returns the remaining hashes with the used code removed, or null when the code is not one of them. */
function useRecoveryCode(hashes, code) {
  const h = hashCode(code || '');
  const idx = (hashes || []).findIndex(x => { const a = Buffer.from(x); const b = Buffer.from(h); return a.length === b.length && crypto.timingSafeEqual(a, b); });
  if (idx < 0) return null;
  return hashes.filter((_, i) => i !== idx);
}

/** Fixed-window limiter. hit(key) → { ok, remaining, retryAfterSeconds }. Memory-bounded by pruning stale windows on each hit. */
function rateLimiter({ windowMs = 60_000, max = 300, now = Date.now } = {}) {
  const buckets = new Map();
  let lastPrune = 0;
  function prune(t) { if (t - lastPrune < windowMs) return; lastPrune = t; for (const [k, b] of buckets) if (b.resetAt <= t) buckets.delete(k); }
  return {
    hit(key, limit = max) {
      const t = now(); prune(t);
      let b = buckets.get(key);
      if (!b || b.resetAt <= t) { b = { count: 0, resetAt: t + windowMs }; buckets.set(key, b); }
      b.count += 1;
      const ok = b.count <= limit;
      return { ok, remaining: Math.max(0, limit - b.count), retryAfterSeconds: ok ? 0 : Math.max(1, Math.ceil((b.resetAt - t) / 1000)) };
    },
    reset(key) { buckets.delete(key); },
    size() { return buckets.size; }
  };
}

/** Password-verified, code-pending sign-ins. A challenge lives 5 minutes and is single-use. */
function mfaChallenges({ ttlMs = 5 * 60_000, now = Date.now } = {}) {
  const open = new Map();
  return {
    issue(payload) {
      for (const [k, v] of open) if (v.expiresAt <= now()) open.delete(k);
      const token = crypto.randomBytes(24).toString('base64url');
      open.set(token, { ...payload, attempts: 0, expiresAt: now() + ttlMs });
      return token;
    },
    peek(token) { const c = open.get(String(token || '')); if (!c || c.expiresAt <= now()) { open.delete(token); return null; } return c; },
    fail(token) { const c = this.peek(token); if (!c) return 0; c.attempts += 1; if (c.attempts >= 6) open.delete(token); return c.attempts; },
    take(token) { const c = this.peek(token); open.delete(String(token || '')); return c; }
  };
}

module.exports = { base32Encode, base32Decode, generateSecret, hotp, totp, verifyTotp, otpauthUrl, makeRecoveryCodes, useRecoveryCode, hashCode, rateLimiter, mfaChallenges };
