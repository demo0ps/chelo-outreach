// Google Workspace mailboxes via OAuth ("Connect with Google") — no passwords stored.
// • OAuth 2.0 authorization code flow with offline access (refresh token kept encrypted per mailbox).
// • Sending through the Gmail API (gmail.send) — MIME built by nodemailer's composer, so headers/attachments match SMTP sends.
// • Reply and bounce detection through the Gmail API (gmail.readonly, metadata only) — same `signals` shape as the IMAP reader.
// Plain HTTPS throughout; no SDK. The state parameter is HMAC-signed so the callback is stateless across serverless instances.
const crypto = require('node:crypto');
const https = require('node:https');
const http = require('node:http'); // only reached by the test-time token URL override
const MailComposerModule = require('nodemailer/lib/mail-composer');
const MailComposer = MailComposerModule.default || MailComposerModule.MailComposer || MailComposerModule;

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = process.env.GOOGLE_TOKEN_URL_OVERRIDE && process.env.NODE_ENV !== 'production' ? process.env.GOOGLE_TOKEN_URL_OVERRIDE : 'https://oauth2.googleapis.com/token'; // override only for local tests
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const SCOPES = ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.readonly', 'openid', 'email'];
const SCOPE_LABELS = { send: 'Send email as this mailbox', read: 'Read email (read-only) to notice replies and bounces' };

function request(url, { method = 'GET', headers = {}, body = null, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = (u.protocol === 'http:' ? http : https).request({ hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, method, headers }, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let json = null; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, text, json }); });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Google did not answer within ${Math.round(timeoutMs / 1000)} s`)));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
const form = obj => Object.entries(obj).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
const b64url = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = str => Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function googleError(res, fallback) {
  const j = res.json || {};
  const code = j.error?.status || j.error || '';
  const msg = j.error?.message || j.error_description || (typeof j.error === 'string' ? j.error : '') || fallback;
  const err = new Error(`${msg}${code && !String(msg).includes(code) ? ` (${code})` : ''}`.slice(0, 240));
  err.status = res.status; err.code = code;
  err.disconnected = res.status === 401 || code === 'invalid_grant' || /invalid_grant|unauthorized_client|invalid_client|Token has been expired or revoked/i.test(res.text || '');
  return err;
}

module.exports = function createGoogleMail({ getConfig, signingKey, now = () => new Date(), fetch = request, log = () => {} }) {
  if (typeof getConfig !== 'function') throw new Error('google-mail needs getConfig()');
  const key = crypto.createHash('sha256').update(String(signingKey || 'chelo-google-state')).digest();
  const accessCache = new Map(); // mailboxId → { token, expiresAt }

  // ---- OAuth state: signed, time-limited, carries who started it (so the callback can audit) ----
  function signState(payload) {
    const body = b64url(JSON.stringify({ ...payload, ts: now().getTime(), nonce: crypto.randomBytes(8).toString('hex') }));
    const mac = b64url(crypto.createHmac('sha256', key).update(body).digest());
    return `${body}.${mac}`;
  }
  function verifyState(state, { maxAgeMs = 15 * 60e3 } = {}) {
    const [body, mac] = String(state || '').split('.');
    if (!body || !mac) return null;
    const expected = b64url(crypto.createHmac('sha256', key).update(body).digest());
    if (expected.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(mac))) return null;
    try { const p = JSON.parse(fromB64url(body).toString('utf8')); if (now().getTime() - Number(p.ts) > maxAgeMs) return null; return p; } catch { return null; }
  }
  function redirectUri(baseUrl) { return `${String(baseUrl || '').replace(/\/+$/, '')}/api/oauth/google/callback`; }
  function authUrl({ baseUrl, actor = '', mailboxId = '', loginHint = '' }) {
    const cfg = getConfig(); if (!cfg.configured) throw new Error('Google is not set up yet. Add the Client ID and Client secret under Settings → Google.');
    const params = { client_id: cfg.clientId, redirect_uri: redirectUri(baseUrl), response_type: 'code', scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state: signState({ actor, mailboxId }) };
    if (cfg.hostedDomain) params.hd = cfg.hostedDomain;
    if (loginHint) params.login_hint = loginHint;
    return `${AUTH_URL}?${form(params)}`;
  }
  // ---- Sign in with Google (identity only: openid email profile; no Gmail access, no refresh token kept) ----
  const LOGIN_SCOPES = ['openid', 'email', 'profile'];
  function loginRedirectUri(baseUrl) { return `${String(baseUrl || '').replace(/\/+$/, '')}/api/auth/google/callback`; }
  function loginUrl({ baseUrl, loginHint = '' }) {
    const cfg = getConfig(); if (!cfg.configured) throw new Error('Sign in with Google is not set up yet. An administrator adds the Google Client ID and secret under Settings → My mailbox.');
    const params = { client_id: cfg.clientId, redirect_uri: loginRedirectUri(baseUrl), response_type: 'code', scope: LOGIN_SCOPES.join(' '), prompt: 'select_account', state: signState({ purpose: 'login' }) };
    if (cfg.hostedDomain) params.hd = cfg.hostedDomain;
    if (loginHint) params.login_hint = loginHint;
    return `${AUTH_URL}?${form(params)}`;
  }
  /** Exchange the login code and return the verified identity. Throws plain-English errors; refuses unverified or wrong-domain accounts. */
  async function exchangeLoginCode({ code, baseUrl }) {
    const cfg = getConfig();
    const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: loginRedirectUri(baseUrl), grant_type: 'authorization_code' }) });
    if (!res.ok) throw googleError(res, 'Google refused the sign-in.');
    const t = res.json || {};
    let claims = {}; try { claims = JSON.parse(fromB64url(String(t.id_token).split('.')[1]).toString('utf8')); } catch { claims = {}; }
    // The id_token came straight from Google's token endpoint over TLS using our client secret, so its claims are trustworthy without a separate signature check.
    if (claims.aud && claims.aud !== cfg.clientId) throw new Error('Google returned a token for a different app.');
    const email = String(claims.email || '').toLowerCase();
    if (!email || claims.email_verified === false) throw new Error('Google did not confirm the email address of that account.');
    if (cfg.hostedDomain && (String(claims.hd || '').toLowerCase() !== cfg.hostedDomain || !email.endsWith(`@${cfg.hostedDomain}`))) { const e = new Error(`${email} is not a ${cfg.hostedDomain} account. Sign in with your company Google account.`); e.wrongDomain = true; throw e; }
    return { email, name: String(claims.name || '').trim().slice(0, 80), picture: String(claims.picture || ''), sub: String(claims.sub || '') };
  }
  async function exchangeCode({ code, baseUrl }) {
    const cfg = getConfig();
    const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: redirectUri(baseUrl), grant_type: 'authorization_code' }) });
    if (!res.ok) throw googleError(res, 'Google refused the sign-in code.');
    const t = res.json || {};
    if (!t.refresh_token) throw new Error('Google did not return a long-lived token. Remove Chelo under myaccount.google.com → Security → Third-party access, then connect again.');
    const email = emailFromIdToken(t.id_token) || (await profileEmail(t.access_token));
    if (!email) throw new Error('Google did not tell us which mailbox was connected.');
    const granted = String(t.scope || '').split(/\s+/);
    const missing = [];
    if (!granted.some(s => /gmail\.send/.test(s))) missing.push(SCOPE_LABELS.send);
    if (!granted.some(s => /gmail\.readonly|mail\.google\.com|gmail\.modify/.test(s))) missing.push(SCOPE_LABELS.read);
    return { email: email.toLowerCase(), refreshToken: t.refresh_token, accessToken: t.access_token, expiresIn: Number(t.expires_in) || 3600, scopes: granted, missing };
  }
  function emailFromIdToken(idToken) { try { const payload = JSON.parse(fromB64url(String(idToken).split('.')[1]).toString('utf8')); return payload.email_verified === false ? '' : String(payload.email || ''); } catch { return ''; } }
  async function profileEmail(accessToken) { const r = await fetch(`${GMAIL}/profile`, { headers: { authorization: `Bearer ${accessToken}` } }); return r.ok ? String(r.json?.emailAddress || '') : ''; }

  // ---- access tokens (cached per mailbox; refreshed with the stored refresh token) ----
  async function accessToken(mailbox) {
    const hit = accessCache.get(mailbox.id);
    if (hit && hit.expiresAt > now().getTime() + 60e3) return hit.token;
    const cfg = getConfig();
    if (!mailbox.refreshToken) { const e = new Error('This mailbox is not connected to Google any more. Press Reconnect.'); e.disconnected = true; throw e; }
    const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ refresh_token: mailbox.refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'refresh_token' }) });
    if (!res.ok) { const e = googleError(res, 'Google refused to refresh the connection.'); if (e.disconnected) e.message = `Google disconnected this mailbox (${e.message}). Press Reconnect on the mailbox card.`; throw e; }
    const token = res.json.access_token; accessCache.set(mailbox.id, { token, expiresAt: now().getTime() + (Number(res.json.expires_in) || 3600) * 1000 });
    return token;
  }
  function forget(mailboxId) { accessCache.delete(mailboxId); }

  // ---- sending: the same object shape nodemailer transports expose (sendMail / verify / close) ----
  function transport(mailbox) {
    return {
      async verify() { const tok = await accessToken(mailbox); const r = await fetch(`${GMAIL}/profile`, { headers: { authorization: `Bearer ${tok}` } }); if (!r.ok) throw googleError(r, 'Gmail did not accept the connection.'); return true; },
      async sendMail(message) {
        const tok = await accessToken(mailbox);
        const raw = await new Promise((resolve, reject) => new MailComposer({ ...message, from: message.from || mailbox.fromEmail }).compile().build((err, buf) => err ? reject(err) : resolve(buf)));
        const messageId = (String(raw).match(/^Message-ID:\s*(<[^>]+>)/im) || [])[1] || '';
        const r = await fetch(`${GMAIL}/messages/send`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify({ raw: b64url(raw) }), timeoutMs: 30000 });
        if (!r.ok) { const e = googleError(r, 'Gmail did not accept the email.'); if (r.status === 429 || /rateLimitExceeded|quota/i.test(r.text)) e.code = 'rate_limited'; throw e; }
        const to = [].concat(message.to || []).map(a => (typeof a === 'string' ? a : a.address)).filter(Boolean);
        log(`gmail sent ${r.json?.id} from ${mailbox.fromEmail}`);
        return { messageId, accepted: to, rejected: [], response: `Gmail id ${r.json?.id || ''} thread ${r.json?.threadId || ''}`, gmailId: r.json?.id || '', threadId: r.json?.threadId || '' };
      },
      close() {}
    };
  }

  // ---- reading replies & bounces (metadata only) — same output as inbound-sync.checkImapInbox ----
  async function checkInbox(mailbox, { since = null, limit = 25 } = {}) {
    const tok = await accessToken(mailbox);
    const sinceEpoch = since ? Math.floor(new Date(since).getTime() / 1000) : Math.floor((now().getTime() - 7 * 86400e3) / 1000);
    const q = `in:inbox after:${sinceEpoch} -from:me`;
    const list = await fetch(`${GMAIL}/messages?${form({ q, maxResults: limit })}`, { headers: { authorization: `Bearer ${tok}` } });
    if (!list.ok) throw googleError(list, 'Gmail did not list the inbox.');
    const ids = (list.json?.messages || []).map(m => m.id);
    const signals = []; const seen = [];
    const want = ['From', 'Subject', 'To', 'X-Failed-Recipients', 'Auto-Submitted', 'Precedence', 'X-Autoreply', 'X-Autorespond', 'X-Auto-Response-Suppress', 'In-Reply-To', 'References', 'Message-ID', 'Date'];
    for (const id of ids) {
      const r = await fetch(`${GMAIL}/messages/${id}?${form({ format: 'metadata' })}&${want.map(h => `metadataHeaders=${h}`).join('&')}`, { headers: { authorization: `Bearer ${tok}` } });
      if (!r.ok) continue;
      const hs = Object.fromEntries((r.json?.payload?.headers || []).map(h => [h.name.toLowerCase(), h.value]));
      const from = hs.from || ''; const subject = hs.subject || ''; const failed = hs['x-failed-recipients'] || '';
      const fromEmail = from.replace(/^.*<([^>]+)>.*$/, '$1').trim().toLowerCase();
      const block = Object.entries(hs).map(([k, v]) => `${k}: ${v}`).join('\n');
      seen.push({ id, threadId: r.json?.threadId || '', internalDate: Number(r.json?.internalDate) || 0 });
      if (/mailer-daemon|postmaster|mail delivery/i.test(from) || /undeliverable|delivery status notification|failure notice/i.test(subject)) {
        if (failed) signals.push({ kind: 'hard_bounce', email: failed.toLowerCase(), subject, reason: subject, gmailId: id });
      } else if (fromEmail && fromEmail !== mailbox.fromEmail) {
        signals.push({ kind: 'reply', email: fromEmail, subject, reason: '', headers: block, text: String(r.json?.snippet || ''), gmailId: id, threadId: r.json?.threadId || '' });
      }
    }
    return { checked: ids.length, signals, seen };
  }

  return { authUrl, verifyState, exchangeCode, redirectUri, loginUrl, loginRedirectUri, exchangeLoginCode, LOGIN_SCOPES, transport, checkInbox, forget, SCOPES, SCOPE_LABELS };
};
module.exports.SCOPES = SCOPES;
