'use strict';
// Published generic-mailbox finder (Batch 5.6).
// Finds the organisation's *published, role-based* CSI / foundation / enquiries mailbox on its own website,
// then verifies it. Deliberately never captures personal addresses (first.last@…) — POPIA: generic org
// mailboxes only. Pure module: fetch + verify are injected so it is testable offline.
const { registrableDomain, isFreemail } = require('./data-engine');

const PAGES = ['/', '/contact', '/contact-us', '/contactus', '/csi', '/corporate-social-investment', '/foundation', '/sustainability', '/sustainability/csi', '/community', '/about-us/contact', '/about-us', '/about', '/get-in-touch', '/en/contact'];
// Local-part priority: the more CSI-specific, the better.
const LOCAL_PRIORITY = [
  [/^(csi|csr|sed|socialinvestment|social-investment|corporatesocialinvestment|communityinvestment|community|communities|socialimpact|impact)$/i, 1.0, 'CSI mailbox'],
  [/^(foundation|trust|thefoundation|fund|bursaries|bursary|grants?|funding|donations?|giving|partnerships?|partner|sponsorships?|sponsorship|sponsor)$/i, 0.95, 'foundation / funding mailbox'],
  [/^(sustainability|esg|transformation|stakeholder|stakeholders|corporateaffairs|corporate\.affairs|corporate-affairs|publicaffairs|communications?|comms)$/i, 0.8, 'corporate affairs mailbox'],
  [/^(info|enquiries|inquiries|enquiry|inquiry|contact|contactus|hello|general|reception|office|admin|customercare|clientservice)$/i, 0.6, 'general enquiries mailbox'],
  [/^(media|press|pr|news|investor|investors|ir|investorrelations|careers|jobs|hr|recruitment|vacancies|support|sales|marketing|webmaster|noreply|no-reply|donotreply|privacy|popia|legal|complaints|whistle|ethics|tipoffs?)$/i, 0, 'not an outreach mailbox']
];
const EMAIL_RE = /(?:mailto:)?([a-z0-9][a-z0-9._%+-]{0,63})(?:@|%40|\s*\[at\]\s*|\s*\(at\)\s*)([a-z0-9.-]+\.[a-z]{2,})/gi;

function looksPersonal(local) {
  const l = String(local || '').toLowerCase();
  const rolePrefix = /^(csi|csr|sed|info|corporate|social|community|foundation|public|stakeholder|investor|customer|client|media|press|no|do|not|general|group|head|office|sponsor)/;
  if (/^[a-z]{2,}[._-][a-z]{2,}$/.test(l) && !rolePrefix.test(l)) return true; // first.last / first_last / first-last
  if (/^[a-z][._-][a-z]{2,}$/.test(l)) return true; // j.smith
  return false;
}
function scoreLocal(local) {
  for (const [re, score, kind] of LOCAL_PRIORITY) if (re.test(local)) return { score, kind };
  if (looksPersonal(local)) return { score: -1, kind: 'personal (never captured)' };
  return { score: 0.2, kind: 'unrecognised mailbox (not auto-selected)' };
}
function orgDomains(org) {
  const out = new Set();
  for (const v of [org.website, org.sourceUrl, org.email ? `https://${String(org.email).split('@')[1] || ''}` : '']) { const d = registrableDomain(v || ''); if (d && !isFreemail(d)) out.add(d); }
  return out;
}
function extractMailboxes(content, { domains = new Set(), sourceUrl = '' } = {}) {
  const found = new Map();
  const text = String(content || '').replace(/&#64;|&commat;/gi, '@').replace(/&#46;/g, '.');
  let m;
  while ((m = EMAIL_RE.exec(text)) !== null) {
    const local = m[1].toLowerCase(); const domain = m[2].toLowerCase().replace(/\.+$/, '');
    if (/\.(png|jpe?g|gif|svg|webp|css|js)$/i.test(domain)) continue; // image@2x.png artefacts
    const reg = registrableDomain(domain); if (!reg || isFreemail(reg)) continue;
    if (domains.size && !domains.has(reg)) continue; // only the organisation's own domains
    const { score, kind } = scoreLocal(local);
    if (score < 0) continue; // personal — never captured
    const email = `${local}@${domain}`;
    const prev = found.get(email);
    if (!prev) found.set(email, { email, local, domain, score, kind, sources: sourceUrl ? [sourceUrl] : [], mentions: 1 });
    else { prev.mentions += 1; if (sourceUrl && !prev.sources.includes(sourceUrl)) prev.sources.push(sourceUrl); }
  }
  return [...found.values()].sort((a, b) => b.score - a.score || b.mentions - a.mentions);
}
function patternCandidates(domain) { return ['csi', 'foundation', 'info'].map(local => ({ email: `${local}@${domain}`, local, domain, ...scoreLocal(local), kind: `${scoreLocal(local).kind} (pattern guess)`, sources: [], mentions: 0, pattern: true })); }

function createMailboxFinder({ fetchPage, verify, log = () => {}, maxPages = 8 } = {}) {
  async function find(org, { tryPatterns = true, signal } = {}) {
    const started = Date.now();
    const domains = orgDomains(org);
    const primary = registrableDomain(org.website || '') || [...domains][0] || '';
    const pagesTried = []; const published = new Map();
    if (fetchPage && primary) {
      const base = `https://www.${primary}`; const bases = [base, `https://${primary}`];
      let pages = 0;
      for (const path of PAGES) {
        if (pages >= maxPages || signal?.aborted) break;
        let got = null;
        for (const b of bases) { const url = `${b}${path}`; try { got = { url, ...(await fetchPage(url)) }; break; } catch (err) { log(`${url}: ${err.message}`); } }
        if (!got) continue;
        pages += 1; pagesTried.push(got.url);
        for (const hit of extractMailboxes(`${got.html || ''}\n${got.text || ''}`, { domains, sourceUrl: got.url })) {
          const prev = published.get(hit.email);
          if (!prev) published.set(hit.email, hit); else { prev.mentions += hit.mentions; for (const s of hit.sources) if (!prev.sources.includes(s)) prev.sources.push(s); }
        }
        if (published.size && [...published.values()].some(h => h.score >= 0.95) && pages >= 3) break; // good enough, stop crawling
      }
    }
    let candidates = [...published.values()].sort((a, b) => b.score - a.score || b.mentions - a.mentions).slice(0, 6);
    if (!candidates.length && tryPatterns && primary) candidates = patternCandidates(primary);
    // Verify (MX + SMTP where the host allows it).
    const verified = [];
    for (const c of candidates) {
      if (signal?.aborted) break;
      let v = { status: 'unknown', reason: 'verifier unavailable' };
      if (verify) { try { v = await verify(c.email); } catch (err) { v = { status: 'unknown', reason: err.message }; } }
      verified.push({ ...c, verification: { status: v.status, reason: v.reason || '', checkedAt: new Date().toISOString() } });
    }
    const usable = verified.filter(c => !['invalid', 'undeliverable'].includes(c.verification.status));
    // Choose: published + not invalid wins; pattern guess only when SMTP positively confirmed it.
    const chosen = usable.find(c => !c.pattern && c.score >= 0.6) || usable.find(c => c.pattern && ['deliverable'].includes(c.verification.status)) || null;
    return {
      ranAt: new Date().toISOString(), durationMs: Date.now() - started, domain: primary, pages: pagesTried,
      candidates: verified, chosen,
      status: chosen ? (chosen.pattern ? 'pattern-verified' : 'published') : verified.length ? 'unconfirmed' : pagesTried.length ? 'none-published' : 'unreachable'
    };
  }
  return { find };
}

module.exports = { createMailboxFinder, extractMailboxes, scoreLocal, looksPersonal, patternCandidates, PAGES };
