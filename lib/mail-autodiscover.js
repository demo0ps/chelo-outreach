'use strict';
// Mail autodiscover: from an email address + password, work out where to SEND (SMTP) and where to READ replies (IMAP),
// then prove both with a real login. Zero dependencies beyond nodemailer (already used by the send engine).
//
// Order of evidence:
//   1. The domain's MX record decides who *receives* mail — replies always land there. Google / Microsoft are recognised
//      and mapped to their fixed hosts; anything else is treated as a self-hosted (cPanel-style) server.
//   2. For self-hosted domains the cPanel convention is tried first (mail.<domain>, SSL 465 / STARTTLS 587 / IMAP 993),
//      then the MX hostname itself (Afrihost/Xneelo publish it as e.g. resurgence.aserv.co.za), then the bare domain.
//   3. Every candidate is tried with the full email address as username (cPanel rule; also right for Google/Microsoft).
// The caller decides what to save; nothing here persists anything.

const dns = require('node:dns').promises;
const tls = require('node:tls');

const PROVIDERS = {
  google: {
    label: 'Google Workspace / Gmail',
    smtp: [{ host: 'smtp.gmail.com', port: 465, secure: true }, { host: 'smtp.gmail.com', port: 587, secure: false }],
    imap: [{ host: 'imap.gmail.com', port: 993 }],
    dkimSelector: 'google',
    spfInclude: 'include:_spf.google.com',
    passwordHint: 'Google needs an App Password, not the normal login password: Google Account → Security → 2-Step Verification → App passwords. Paste the 16-character code here.'
  },
  microsoft: {
    label: 'Microsoft 365 / Outlook',
    smtp: [{ host: 'smtp.office365.com', port: 587, secure: false }],
    imap: [{ host: 'outlook.office365.com', port: 993 }],
    dkimSelector: 'selector1',
    spfInclude: 'include:spf.protection.outlook.com',
    passwordHint: 'Microsoft 365 needs "Authenticated SMTP" enabled for the mailbox (admin centre → user → Mail → Manage email apps) and, if MFA is on, an app password.'
  },
  zoho: {
    label: 'Zoho Mail',
    smtp: [{ host: 'smtp.zoho.com', port: 465, secure: true }],
    imap: [{ host: 'imap.zoho.com', port: 993 }],
    dkimSelector: 'zoho',
    spfInclude: 'include:zoho.com',
    passwordHint: 'Zoho needs IMAP access switched on for the mailbox and an app-specific password if 2FA is enabled.'
  }
};

function providerFromMx(exchanges) {
  const hosts = exchanges.map(e => String(e.exchange || '').toLowerCase());
  if (hosts.some(h => /google\.com$|googlemail\.com$/.test(h))) return 'google';
  if (hosts.some(h => /outlook\.com$|protection\.outlook\.com$/.test(h))) return 'microsoft';
  if (hosts.some(h => /zoho\.(com|eu)$/.test(h))) return 'zoho';
  return 'self-hosted';
}

async function lookupMx(domain, resolver = dns) {
  try { const rows = await resolver.resolveMx(domain); return rows.sort((a, b) => a.priority - b.priority); } catch { return []; }
}

/** Candidate servers for a domain, most likely first. */
function candidatesFor(domain, provider, mx) {
  if (PROVIDERS[provider]) return { smtp: PROVIDERS[provider].smtp, imap: PROVIDERS[provider].imap };
  const hosts = [`mail.${domain}`, ...mx.map(m => String(m.exchange || '').replace(/\.$/, '')).filter(Boolean), domain];
  const uniq = [...new Set(hosts)];
  return {
    smtp: uniq.flatMap(host => [{ host, port: 465, secure: true }, { host, port: 587, secure: false }]),
    imap: uniq.map(host => ({ host, port: 993 }))
  };
}

/** IMAP: connect over TLS, LOGIN, LOGOUT. Resolves { ok, host, port } or { ok:false, error }. */
function imapLogin({ host, port = 993, username, password }, { timeoutMs = 8000 } = {}) {
  return new Promise(resolve => {
    const q = v => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    let buffer = '', step = 0, done = false;
    const finish = result => { if (done) return; done = true; try { socket.destroy(); } catch {} resolve(result); };
    const socket = tls.connect({ host, port, servername: host, minVersion: 'TLSv1.2' });
    const timer = setTimeout(() => finish({ ok: false, host, port, error: 'timed out' }), timeoutMs);
    socket.on('error', err => { clearTimeout(timer); finish({ ok: false, host, port, error: err.code || err.message }); });
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      if (step === 0 && /^\* (OK|PREAUTH)/im.test(buffer)) { step = 1; buffer = ''; socket.write(`A1 LOGIN ${q(username)} ${q(password)}\r\n`); }
      else if (step === 1 && /^A1 (OK|NO|BAD)/im.test(buffer)) {
        clearTimeout(timer);
        if (/^A1 OK/im.test(buffer)) { socket.write('A2 LOGOUT\r\n'); finish({ ok: true, host, port }); }
        else finish({ ok: false, host, port, error: 'login refused', auth: true });
      }
    });
  });
}

/**
 * discover({ email, password, smtpVerify, imapCheck, resolver, log })
 *  smtpVerify(candidate) → Promise<void> (throws on failure) — injected so tests can fake it (server passes nodemailer verify).
 *  imapCheck(candidate)  → Promise<{ok, error}>          — defaults to the TLS IMAP login above.
 */
async function discover({ email, password, smtpVerify, imapCheck = imapLogin, resolver = dns, log = () => {}, timeoutMs = 8000 }) {
  const address = String(email || '').trim().toLowerCase();
  const domain = address.split('@')[1] || '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error('Enter the full email address, e.g. partnerships@cheloapp.com.');
  if (!password) throw new Error('Enter the mailbox password.');
  const mx = await lookupMx(domain, resolver);
  const provider = providerFromMx(mx);
  const info = PROVIDERS[provider] || { label: 'Self-hosted (cPanel-style) mail server', dkimSelector: 'default', spfInclude: '', passwordHint: 'Use the mailbox password set in cPanel → Email Accounts.' };
  const cands = candidatesFor(domain, provider, mx);
  const tried = { smtp: [], imap: [] };

  // SMTP: sequential — the first success wins; auth refusals stop early (the password is wrong everywhere).
  let smtp = null;
  for (const c of cands.smtp) {
    const attempt = { ...c, username: address, password };
    try { await withTimeout(smtpVerify(attempt), timeoutMs); smtp = { host: c.host, port: c.port, secure: c.secure }; tried.smtp.push({ host: c.host, port: c.port, ok: true }); log(`smtp ok ${c.host}:${c.port}`); break; }
    catch (err) {
      const msg = String(err?.response || err?.message || err).slice(0, 160);
      const auth = /535|534|auth|credential|password|username/i.test(msg);
      tried.smtp.push({ host: c.host, port: c.port, ok: false, error: msg, auth });
      log(`smtp fail ${c.host}:${c.port} ${msg}`);
      if (auth) break;
    }
  }
  // IMAP: same approach.
  let imap = null;
  for (const c of cands.imap) {
    const r = await imapCheck({ ...c, username: address, password }, { timeoutMs });
    tried.imap.push({ host: c.host, port: c.port, ok: r.ok, error: r.error, auth: r.auth });
    if (r.ok) { imap = { host: c.host, port: c.port }; break; }
    if (r.auth) break;
  }
  const authRefused = tried.smtp.some(t => t.auth) || tried.imap.some(t => t.auth);
  return {
    email: address, domain, provider, providerLabel: info.label, mx: mx.map(m => m.exchange),
    smtp, imap, tried, authRefused,
    dkimSelector: info.dkimSelector, spfInclude: info.spfInclude, passwordHint: info.passwordHint,
    summary: summarise({ smtp, imap, authRefused, provider, info, domain, mx })
  };
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timed out')), ms); })]).finally(() => clearTimeout(timer));
}

function summarise({ smtp, imap, authRefused, provider, info, domain, mx }) {
  const lines = [];
  lines.push(`Mail for ${domain} is received by ${info.label}${mx.length ? ` (${mx[0]})` : ' (no MX record found)'}.`);
  if (smtp) lines.push(`Sending works via ${smtp.host}:${smtp.port}.`); else lines.push('Sending: no server accepted the login.');
  if (imap) lines.push(`Replies will be read from ${imap.host}:${imap.port}.`); else lines.push('Replies: could not log in to read them.');
  if (!smtp || !imap) {
    if (authRefused) lines.push(`The password was refused. ${info.passwordHint}`);
    else if (provider === 'self-hosted') lines.push('No server answered on the usual names. Ask your hosting company for the "Outgoing server" and "Incoming server" names shown in cPanel → Email Accounts → Connect Devices, then open "Show server details" and type them in.');
    else lines.push(`${info.label} did not answer in time. Try again in a minute.`);
  }
  return lines.join(' ');
}

/** DNS records the domain needs so that mail from this provider passes SPF/DKIM/DMARC alignment. */
function dnsAdvice(domain, provider) {
  const info = PROVIDERS[provider];
  const spf = info?.spfInclude ? `v=spf1 ${info.spfInclude} ~all` : `v=spf1 mx a:mail.${domain} ~all`;
  const dkim = provider === 'google'
    ? 'Google Admin → Apps → Google Workspace → Gmail → Authenticate email → Generate new record (selector "google", 2048-bit) → add the TXT it shows at google._domainkey, then press "Start authentication".'
    : provider === 'microsoft'
      ? 'Microsoft 365 Defender → Email authentication → DKIM → enable for the domain; add the two CNAMEs it shows (selector1._domainkey, selector2._domainkey).'
      : 'cPanel → Email Deliverability → Manage → copy the DKIM TXT (selector "default") into DNS.';
  return {
    records: [
      { type: 'TXT', name: domain, value: spf, why: 'SPF — lists who may send as this domain' },
      { type: 'TXT', name: `${info?.dkimSelector || 'default'}._domainkey.${domain}`, value: '(generated by the provider — see steps)', why: 'DKIM — signs every email so receivers can prove it is really from you' },
      { type: 'TXT', name: `_dmarc.${domain}`, value: `v=DMARC1; p=quarantine; rua=mailto:admin@${domain}; adkim=r; aspf=r; pct=100`, why: 'DMARC — tells receivers what to do when SPF/DKIM fail (keep quarantine once SPF+DKIM pass)' }
    ],
    dkimSteps: dkim
  };
}

module.exports = { discover, dnsAdvice, providerFromMx, candidatesFor, imapLogin, PROVIDERS };
