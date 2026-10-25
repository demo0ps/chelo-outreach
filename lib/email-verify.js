'use strict';
// Built-in mailbox verification: syntax → MX → SMTP handshake (RCPT TO, never DATA).
// No message is ever sent. Catch-all domains are detected with a random probe address.
// Designed to degrade gracefully: hosts that block outbound port 25 (most PaaS) return 'unknown', never 'undeliverable'.

const net = require('node:net');
const dns = require('node:dns/promises');
const crypto = require('node:crypto');

const DEFAULTS = { connectTimeoutMs: 6000, commandTimeoutMs: 8000, heloHost: 'verify.chelo.local', fromAddress: 'verify@chelo.local', port: 25, cacheTtlMs: 6 * 60 * 60 * 1000 };

function nowIso() { return new Date().toISOString(); }

function parseEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) return null;
  const local = email.slice(0, at); const domain = email.slice(at + 1);
  if (local.length > 64 || domain.length > 253 || /\.\./.test(email) || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return null;
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) return null;
  return { email, local, domain };
}

const ROLE_LOCALS = new Set(['info', 'admin', 'administrator', 'webmaster', 'postmaster', 'hostmaster', 'abuse', 'noreply', 'no-reply', 'donotreply', 'support', 'sales', 'marketing', 'hr', 'jobs', 'careers', 'contact', 'hello', 'office', 'enquiries', 'inquiries', 'csi', 'foundation', 'sponsorship', 'sponsorships']);
const DISPOSABLE = new Set(['mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com', 'temp-mail.org', 'yopmail.com', 'trashmail.com', 'getnada.com', 'dispostable.com', 'sharklasers.com', 'maildrop.cc']);

/** Minimal SMTP conversation. Resolves with { code, message } for the RCPT TO of `rcpt`, plus catch-all probe result. */
function smtpProbe(host, rcpt, probeRcpt, opts) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host, port: opts.port });
    let buffer = ''; let step = 0; let done = false; const transcript = [];
    const result = { rcpt: null, probe: null, error: null };
    const finish = (error) => { if (done) return; done = true; if (error) result.error = error; try { socket.destroy(); } catch { /* ignore */ } resolve({ ...result, transcript }); };
    const timer = setTimeout(() => finish('timeout'), opts.connectTimeoutMs + opts.commandTimeoutMs * 4);
    socket.setTimeout(opts.commandTimeoutMs, () => finish('timeout'));
    socket.once('error', err => finish(err.code || err.message));
    socket.once('close', () => { clearTimeout(timer); finish(result.rcpt ? null : (result.error || 'closed')); });
    const send = line => { transcript.push('C: ' + line); socket.write(line + '\r\n'); };
    const commands = [`EHLO ${opts.heloHost}`, `MAIL FROM:<${opts.fromAddress}>`, `RCPT TO:<${rcpt}>`, `RCPT TO:<${probeRcpt}>`, 'QUIT'];
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      let idx;
      while ((idx = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, idx); buffer = buffer.slice(idx + 2);
        transcript.push('S: ' + line.slice(0, 160));
        if (/^\d{3}-/.test(line)) continue; // multi-line continuation
        const code = Number(line.slice(0, 3));
        if (step === 0) { // banner
          if (code !== 220) return finish(`banner ${code}`);
          send(commands[0]); step = 1; continue;
        }
        if (step === 1) { if (code !== 250) { send('HELO ' + opts.heloHost); step = 11; continue; } send(commands[1]); step = 2; continue; }
        if (step === 11) { if (code !== 250) return finish(`helo ${code}`); send(commands[1]); step = 2; continue; }
        if (step === 2) { if (code !== 250) return finish(`mail-from ${code}`); send(commands[2]); step = 3; continue; }
        if (step === 3) { result.rcpt = { code, message: line.slice(4, 200) }; send(commands[3]); step = 4; continue; }
        if (step === 4) { result.probe = { code, message: line.slice(4, 200) }; send(commands[4]); step = 5; continue; }
        if (step === 5) { clearTimeout(timer); return finish(null); }
      }
    });
  });
}

function classify(rcpt, probe) {
  if (!rcpt) return { status: 'unknown', reason: 'Mail server did not answer the mailbox check.' };
  const accepted = rcpt.code >= 200 && rcpt.code < 300;
  const probeAccepted = probe && probe.code >= 200 && probe.code < 300;
  if (accepted && probeAccepted) return { status: 'catch-all', reason: 'Domain accepts every address (catch-all); the mailbox cannot be confirmed individually.' };
  if (accepted) return { status: 'deliverable', reason: 'Mail server accepted the mailbox.' };
  if (rcpt.code >= 500 && rcpt.code < 600) {
    if (/5\.1\.1|user unknown|no such user|does not exist|unknown user|recipient rejected|mailbox unavailable|invalid recipient|not found/i.test(rcpt.message)) return { status: 'undeliverable', reason: `Mail server rejected the mailbox (${rcpt.code}: ${rcpt.message}).` };
    if (/blocked|spam|policy|blacklist|denied|not permitted|reputation/i.test(rcpt.message)) return { status: 'unknown', reason: `Mail server refused the check for policy reasons (${rcpt.code}); mailbox status not determined.` };
    return { status: 'undeliverable', reason: `Mail server rejected the mailbox (${rcpt.code}: ${rcpt.message}).` };
  }
  if (rcpt.code >= 400 && rcpt.code < 500) return { status: 'unknown', reason: `Mail server deferred the check (${rcpt.code}); greylisting or rate limiting. Retry later.` };
  return { status: 'unknown', reason: `Unexpected mail-server response (${rcpt.code}).` };
}

module.exports = function createEmailVerifier(options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const resolver = options.resolver || dns;
  const probe = options.probe || smtpProbe;
  const cache = new Map();
  let port25Blocked = null; // learned at runtime: if every connection fails with ECONNREFUSED/ETIMEDOUT/ENETUNREACH we stop trying for a while
  let blockedUntil = 0;

  async function verify(value, { skipSmtp = false } = {}) {
    const checkedAt = nowIso();
    const parsed = parseEmail(value);
    if (!parsed) return { status: 'invalid', email: String(value || '').trim().toLowerCase(), reason: 'Email address is not syntactically valid.', checks: { syntax: false }, checkedAt };
    const checks = { syntax: true, role: ROLE_LOCALS.has(parsed.local), disposable: DISPOSABLE.has(parsed.domain) };
    if (checks.disposable) return { status: 'invalid', email: parsed.email, reason: 'Disposable email provider.', checks, checkedAt };
    const cached = cache.get(parsed.email);
    if (cached && cached.expiresAt > Date.now()) return { ...cached.result, cached: true, checkedAt };

    let mx = [];
    try { mx = (await resolver.resolveMx(parsed.domain)).filter(r => r && r.exchange).sort((a, b) => a.priority - b.priority); } catch (err) {
      const code = String(err.code || '');
      if (!['ENOTFOUND', 'ENODATA', 'NODATA', 'NOTFOUND'].includes(code)) return { status: 'unknown', email: parsed.email, reason: `Temporary DNS failure (${code || 'lookup'}); retry.`, checks: { ...checks, mx: null }, checkedAt };
    }
    if (mx.length === 1 && Number(mx[0].priority) === 0 && ['', '.'].includes(String(mx[0].exchange).trim())) return remember(parsed.email, { status: 'invalid', email: parsed.email, reason: 'Domain publishes a null MX and does not accept email.', checks: { ...checks, mx: false }, checkedAt });
    if (!mx.length) {
      let hasAddress = false;
      for (const method of ['resolve4', 'resolve6']) { try { hasAddress = (await resolver[method](parsed.domain)).length > 0; if (hasAddress) break; } catch { /* ignore */ } }
      if (!hasAddress) return remember(parsed.email, { status: 'invalid', email: parsed.email, reason: 'Domain has no mail-server or address records.', checks: { ...checks, mx: false }, checkedAt });
      mx = [{ exchange: parsed.domain, priority: 0 }];
    }
    checks.mx = true;
    if (skipSmtp || (blockedUntil > Date.now())) return remember(parsed.email, { status: 'unknown', email: parsed.email, reason: port25Blocked ? 'Outbound SMTP (port 25) is blocked on this host; mailbox could not be probed. Domain accepts mail.' : 'Mailbox probe skipped; domain accepts mail.', checks: { ...checks, smtp: null }, checkedAt, mxHost: mx[0].exchange });

    const probeRcpt = `${crypto.randomBytes(9).toString('hex')}@${parsed.domain}`;
    let last = null; let connectionFailures = 0;
    for (const record of mx.slice(0, 3)) {
      const res = await probe(record.exchange, parsed.email, probeRcpt, opts);
      last = res;
      if (res.rcpt) {
        const verdict = classify(res.rcpt, res.probe);
        port25Blocked = false;
        return remember(parsed.email, { ...verdict, email: parsed.email, checks: { ...checks, smtp: true }, smtp: { code: res.rcpt.code, message: res.rcpt.message, probeCode: res.probe?.code ?? null }, mxHost: record.exchange, checkedAt });
      }
      if (['ECONNREFUSED', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'timeout', 'closed'].includes(String(res.error))) connectionFailures += 1;
    }
    if (connectionFailures && connectionFailures === Math.min(mx.length, 3)) { port25Blocked = port25Blocked !== false; if (port25Blocked) blockedUntil = Date.now() + 15 * 60 * 1000; }
    return remember(parsed.email, { status: 'unknown', email: parsed.email, reason: `Could not complete the mailbox probe (${last?.error || 'no response'}). Domain accepts mail; treat as unverified.`, checks: { ...checks, smtp: false }, mxHost: mx[0].exchange, checkedAt }, 10 * 60 * 1000);
  }

  function remember(email, result, ttl = opts.cacheTtlMs) { cache.set(email, { result, expiresAt: Date.now() + ttl }); return result; }

  return { verify, parseEmail, classify, _cache: cache };
};
module.exports.parseEmail = parseEmail;
module.exports.classify = classify;
