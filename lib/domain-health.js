'use strict';
// Sending-domain health: SPF, DKIM (selector probe), DMARC, MX. Pure DNS, no network beyond the resolver.
// Each check returns { ok, value, note }. Status: pass | needs-work | fail. Issues carry plain-English fixes.
const dns = require('node:dns').promises;

const COMMON_DKIM_SELECTORS = ['google', 'selector1', 'selector2', 'default', 'k1', 'k2', 'k3', 'dkim', 'mail', 'smtp', 's1', 's2', 'zoho', 'mandrill', 'pm', 'mx', 'email', 'fm1', 'fm2', 'fm3'];

function registrableDomain(email) {
  const at = String(email || '').lastIndexOf('@');
  return (at >= 0 ? String(email).slice(at + 1) : String(email || '')).trim().toLowerCase().replace(/\.$/, '');
}

async function txt(resolver, name) {
  try { return (await resolver.resolveTxt(name)).map(parts => parts.join('')); }
  catch (err) { if (['ENODATA', 'ENOTFOUND'].includes(err.code)) return []; throw err; }
}

function parseSpf(records) {
  const spf = records.filter(r => /^v=spf1\b/i.test(r.trim()));
  if (!spf.length) return { ok: false, value: '', note: 'No SPF record found.' };
  if (spf.length > 1) return { ok: false, value: spf.join(' | '), note: 'Multiple SPF records found – receivers treat this as a permanent error. Merge them into one.' };
  const record = spf[0];
  const lookups = (record.match(/\b(include|a|mx|ptr|exists|redirect)[:=]?/gi) || []).length;
  const all = (record.match(/[~\-?+]?all\b/i) || [''])[0].toLowerCase();
  const notes = [];
  if (!all || all === '?all' || all === '+all') notes.push(`SPF ends with "${all || 'nothing'}"; use "~all" or "-all".`);
  if (lookups > 10) notes.push(`${lookups} DNS lookups (limit is 10) – SPF will permerror.`);
  return { ok: notes.length === 0, value: record, note: notes.join(' ') || `SPF present (${lookups} lookups, ${all}).`, lookups, all };
}

function parseDmarc(records) {
  const dmarc = records.filter(r => /^v=DMARC1\b/i.test(r.trim()));
  if (!dmarc.length) return { ok: false, value: '', note: 'No DMARC record at _dmarc.<domain>. Gmail/Yahoo/Microsoft now require one (p=none is enough to start).', policy: '' };
  const record = dmarc[0];
  const policy = (record.match(/\bp=(none|quarantine|reject)/i) || [, ''])[1].toLowerCase();
  const rua = /\brua=/i.test(record);
  const notes = [];
  if (!policy) notes.push('DMARC record has no p= policy.');
  if (!rua) notes.push('No rua= reporting address – you will not see who is spoofing you.');
  return { ok: Boolean(policy), value: record, note: notes.join(' ') || `DMARC p=${policy}${rua ? ' with aggregate reporting' : ''}.`, policy, rua };
}

async function probeDkim(resolver, domain, selectors) {
  for (const selector of selectors) {
    const records = await txt(resolver, `${selector}._domainkey.${domain}`);
    const hit = records.find(r => /v=DKIM1|\bp=/i.test(r));
    if (hit) {
      const keyB64 = (hit.match(/\bp=([A-Za-z0-9+/=]+)/) || [, ''])[1];
      const approxBits = keyB64 ? Math.max(0, (Buffer.from(keyB64, 'base64').length - 38) * 8) : 0; // RSA SPKI DER overhead ≈ 38 bytes → 2048-bit key ≈ 294 bytes
      const weak = approxBits > 0 && approxBits < 1000;
      return { ok: !weak && Boolean(keyB64), selector, value: `${selector}._domainkey (${approxBits >= 1000 ? '≈2048' : approxBits ? '≈1024' : '?'} bit)`, note: weak ? 'DKIM key looks shorter than 1024 bits; rotate to 2048.' : `DKIM key published at selector "${selector}".`, bits: approxBits };
    }
  }
  return { ok: false, selector: '', value: '', note: `No DKIM key found at ${selectors.length} common selectors. Enable DKIM signing in your mail provider (Google Workspace: Apps → Gmail → Authenticate email; Microsoft 365: Defender → DKIM) or add the selector in Settings.` };
}

async function checkMx(resolver, domain) {
  try {
    const mx = await resolver.resolveMx(domain);
    if (!mx.length) return { ok: false, value: '', note: 'No MX records – replies and bounces to this domain cannot be delivered.' };
    const hosts = mx.sort((a, b) => a.priority - b.priority).map(r => r.exchange);
    return { ok: true, value: hosts.slice(0, 3).join(', '), note: `${mx.length} MX host(s).`, hosts };
  } catch (err) {
    if (['ENODATA', 'ENOTFOUND'].includes(err.code)) return { ok: false, value: '', note: 'Domain does not resolve MX.' };
    return { ok: false, value: '', note: `MX lookup failed (${err.code || err.message}).`, transient: true };
  }
}

function issuesFor(checks) {
  const issues = [];
  if (!checks.spf.ok) issues.push({ code: 'spf', severity: checks.spf.value ? 'warn' : 'fail', title: 'SPF', detail: checks.spf.note, fix: 'Publish one TXT record on the root domain, e.g. "v=spf1 include:_spf.google.com ~all" (Google Workspace) or "v=spf1 include:spf.protection.outlook.com -all" (Microsoft 365).' });
  if (!checks.dkim.ok) issues.push({ code: 'dkim', severity: 'fail', title: 'DKIM', detail: checks.dkim.note, fix: 'Turn on DKIM signing at your mail provider and publish the TXT record it gives you; then set the selector here if it is not a common one.' });
  if (!checks.dmarc.ok) issues.push({ code: 'dmarc', severity: checks.dmarc.value ? 'warn' : 'fail', title: 'DMARC', detail: checks.dmarc.note, fix: 'Add TXT at _dmarc.<domain>: "v=DMARC1; p=none; rua=mailto:dmarc@<domain>". Move to p=quarantine once reports look clean.' });
  if (!checks.mx.ok) issues.push({ code: 'mx', severity: checks.mx.transient ? 'warn' : 'fail', title: 'MX', detail: checks.mx.note, fix: 'Make sure the sending domain can receive mail – replies, bounces and DMARC reports depend on it.' });
  return issues;
}

function statusFor(issues) {
  if (issues.some(i => i.severity === 'fail')) return issues.filter(i => i.severity === 'fail').length >= 2 ? 'fail' : 'needs-work';
  if (issues.length) return 'needs-work';
  return 'pass';
}

function createDomainHealth({ resolver = dns, ttlMs = 6 * 60 * 60 * 1000, now = () => Date.now() } = {}) {
  const cache = new Map();
  async function check(domainOrEmail, { selectors = [], force = false } = {}) {
    const domain = registrableDomain(domainOrEmail);
    if (!domain || !domain.includes('.')) return { domain, status: 'fail', checks: {}, issues: [{ code: 'domain', severity: 'fail', title: 'Domain', detail: 'No valid sending domain.', fix: 'Set a From address on a domain you control.' }], checkedAt: new Date(now()).toISOString() };
    const cached = cache.get(domain);
    if (cached && !force && now() - cached.ts < ttlMs) return { ...cached.result, cached: true };
    const selectorList = [...new Set([...selectors.filter(Boolean), ...COMMON_DKIM_SELECTORS])];
    const [spfTxt, dmarcTxt, mx, dkim] = await Promise.all([txt(resolver, domain), txt(resolver, `_dmarc.${domain}`), checkMx(resolver, domain), probeDkim(resolver, domain, selectorList)]);
    const checks = { spf: parseSpf(spfTxt), dkim, dmarc: parseDmarc(dmarcTxt), mx };
    const issues = issuesFor(checks);
    const result = { domain, status: statusFor(issues), checks, issues, checkedAt: new Date(now()).toISOString(), cached: false };
    cache.set(domain, { ts: now(), result });
    return result;
  }
  return { check, registrableDomain, _cache: cache };
}

module.exports = createDomainHealth;
module.exports.registrableDomain = registrableDomain;
module.exports.parseSpf = parseSpf;
module.exports.parseDmarc = parseDmarc;
module.exports.COMMON_DKIM_SELECTORS = COMMON_DKIM_SELECTORS;
