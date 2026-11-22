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
// Department mailboxes are skipped entirely (staff decision): hr@, careers@, press@ … and also department *subdomains*
// such as info@hr.example.com or info@careers.example.com — the local part looks generic but the inbox is the wrong team.
const WRONG_DEPARTMENT = /^(hr|humanresources|human-resources|people|talent|careers?|jobs?|recruit(ing|ment)?|vacancies|press|media|pr|news(room)?|investors?|ir|investorrelations|sales|shop|store|orders?|support|helpdesk|service(desk)?|customer(care|service|s)?|clientservice|marketing|webmaster|legal|privacy|popia|complaints|whistle(blow(er|ing))?|ethics|tipoffs?|noreply|no-reply|donotreply)$/i;
// v65: the Marketing desk wants the opposite set — the newsroom / editor / tips mailbox is the right team, HR and advertising are not.
const MEDIA_PRIORITY = [
  [/^(news|newsdesk|newsroom|editor|editors|editorial|tips|tipoffs?|stories|story|content|features|studio|producers?|production|show|talk|programmes?|programs?)$/i, 1.0, 'newsroom / editorial mailbox'],
  [/^(press|media|pr|communications?|comms|publicity)$/i, 0.9, 'press mailbox'],
  [/^(info|enquiries|inquiries|enquiry|inquiry|contact|contactus|hello|general|reception|office|admin|feedback|listeners?|viewers?|readers?)$/i, 0.6, 'general enquiries mailbox'],
  [/^(csi|csr|foundation|trust|sponsorships?|sponsor|investor|investors|ir|careers|jobs|hr|recruitment|vacancies|support|sales|marketing|advertising|adverts?|ads|subscriptions?|subscribe|circulation|classifieds|webmaster|noreply|no-reply|donotreply|privacy|popia|legal|complaints|whistle|ethics)$/i, 0, 'not a newsroom mailbox'],
];
const MEDIA_WRONG_DEPARTMENT = /^(hr|humanresources|people|talent|careers?|jobs?|recruit(ing|ment)?|vacancies|sales|advertising|adverts?|ads|shop|store|orders?|subscriptions?|subscribe|circulation|classifieds|support|helpdesk|billing|accounts|finance|legal|privacy|investors?|ir)$/i;
const MEDIA_PAGES = ['/', '/contact', '/contact-us', '/contactus', '/about', '/about-us', '/newsroom', '/tips', '/send-us-your-story', '/editorial', '/team', '/our-team', '/staff', '/get-in-touch', '/en/contact'];
const PROFILES = {
  funder: { priority: LOCAL_PRIORITY, wrong: null, pages: PAGES, patterns: ['csi', 'foundation', 'info'] },
  media: { priority: MEDIA_PRIORITY, wrong: MEDIA_WRONG_DEPARTMENT, pages: MEDIA_PAGES, patterns: ['news', 'newsdesk', 'editor', 'info'] }
};
function profileOf(name) { return PROFILES[name] || PROFILES.funder; }
function wrongDepartment(local, domain, registrable, profile = PROFILES.funder) {
  const re = profile.wrong || WRONG_DEPARTMENT;
  if (re.test(String(local || ''))) return true;
  const sub = String(domain || '').toLowerCase().replace(new RegExp(`\\.?${String(registrable || '').replace(/\./g, '\\.')}$`), '');
  return sub.split('.').filter(Boolean).some(part => re.test(part));
}
const EMAIL_RE = /(?:mailto:)?([a-z0-9][a-z0-9._%+-]{0,63})(?:@|%40|\s*\[at\]\s*|\s*\(at\)\s*)([a-z0-9.-]+\.[a-z]{2,})/gi;

function looksPersonal(local) {
  const l = String(local || '').toLowerCase();
  const rolePrefix = /^(csi|csr|sed|info|corporate|social|community|foundation|public|stakeholder|investor|customer|client|media|press|no|do|not|general|group|head|office|sponsor)/;
  if (/^[a-z]{2,}[._-][a-z]{2,}$/.test(l) && !rolePrefix.test(l)) return true; // first.last / first_last / first-last
  if (/^[a-z][._-][a-z]{2,}$/.test(l)) return true; // j.smith
  return false;
}
function scoreLocal(local, profile = PROFILES.funder) {
  for (const [re, score, kind] of profile.priority) if (re.test(local)) return { score, kind };
  if (looksPersonal(local)) return { score: -1, kind: 'personal (never captured)' };
  return { score: 0.2, kind: 'unrecognised mailbox (not auto-selected)' };
}
function orgDomains(org) {
  const out = new Set();
  for (const v of [org.website, org.sourceUrl, org.email ? `https://${String(org.email).split('@')[1] || ''}` : '']) { const d = registrableDomain(v || ''); if (d && !isFreemail(d)) out.add(d); }
  return out;
}
function extractMailboxes(content, { domains = new Set(), sourceUrl = '', profile = PROFILES.funder } = {}) {
  const found = new Map();
  const text = String(content || '').replace(/&#64;|&commat;/gi, '@').replace(/&#46;/g, '.');
  let m;
  while ((m = EMAIL_RE.exec(text)) !== null) {
    const local = m[1].toLowerCase(); const domain = m[2].toLowerCase().replace(/\.+$/, '');
    if (/\.(png|jpe?g|gif|svg|webp|css|js)$/i.test(domain)) continue; // image@2x.png artefacts
    const reg = registrableDomain(domain); if (!reg || isFreemail(reg)) continue;
    if (domains.size && !domains.has(reg)) continue; // only the organisation's own domains
    const { score, kind } = scoreLocal(local, profile);
    if (score < 0) continue; // personal — never captured
    if (score === 0 || wrongDepartment(local, domain, reg, profile)) continue; // HR / press / sales / support — wrong team, skipped entirely
    const email = `${local}@${domain}`;
    const prev = found.get(email);
    if (!prev) found.set(email, { email, local, domain, score, kind, sources: sourceUrl ? [sourceUrl] : [], mentions: 1 });
    else { prev.mentions += 1; if (sourceUrl && !prev.sources.includes(sourceUrl)) prev.sources.push(sourceUrl); }
  }
  return [...found.values()].sort((a, b) => b.score - a.score || b.mentions - a.mentions);
}
function patternCandidates(domain, profile = PROFILES.funder) { return profile.patterns.map(local => ({ email: `${local}@${domain}`, local, domain, ...scoreLocal(local, profile), kind: `${scoreLocal(local, profile).kind} (pattern guess)`, sources: [], mentions: 0, pattern: true })); }

function createMailboxFinder({ fetchPage, verify, log = () => {}, maxPages = 8 } = {}) {
  async function find(org, { tryPatterns = true, signal, profile: profileName = 'funder' } = {}) {
    const started = Date.now(); const profile = profileOf(profileName);
    const domains = orgDomains(org);
    const primary = registrableDomain(org.website || '') || [...domains][0] || '';
    const pagesTried = []; const published = new Map();
    if (fetchPage && primary) {
      const base = `https://www.${primary}`; const bases = [base, `https://${primary}`];
      let pages = 0;
      for (const path of profile.pages) {
        if (pages >= maxPages || signal?.aborted) break;
        let got = null;
        for (const b of bases) { if (signal?.aborted) break; const url = `${b}${path}`; try { got = { url, ...(await fetchPage(url, { signal })) }; break; } catch (err) { log(`${url}: ${err.message}`); } }
        if (!got) continue;
        pages += 1; pagesTried.push(got.url);
        for (const hit of extractMailboxes(`${got.html || ''}\n${got.text || ''}`, { domains, sourceUrl: got.url, profile })) {
          const prev = published.get(hit.email);
          if (!prev) published.set(hit.email, hit); else { prev.mentions += hit.mentions; for (const s of hit.sources) if (!prev.sources.includes(s)) prev.sources.push(s); }
        }
        if (published.size && [...published.values()].some(h => h.score >= 0.95) && pages >= 3) break; // good enough, stop crawling
      }
    }
    let candidates = [...published.values()].sort((a, b) => b.score - a.score || b.mentions - a.mentions).slice(0, 6);
    if (!candidates.length && tryPatterns && primary) candidates = patternCandidates(primary, profile);
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
    // If the time budget ran out before the crawl finished and nothing was chosen, the organisation is retried later
    // ('unreachable' is the retry state) rather than being wrongly filed as "no mailbox published".
    const cutShort = Boolean(signal?.aborted) && !chosen;
    return {
      ranAt: new Date().toISOString(), durationMs: Date.now() - started, domain: primary, pages: pagesTried,
      candidates: verified, chosen, cutShort,
      status: chosen ? (chosen.pattern ? 'pattern-verified' : 'published') : cutShort ? 'unreachable' : verified.length ? 'unconfirmed' : pagesTried.length ? 'none-published' : 'unreachable'
    };
  }
  return { find };
}

module.exports = { createMailboxFinder, extractMailboxes, scoreLocal, looksPersonal, wrongDepartment, patternCandidates, PAGES, PROFILES, profileOf };
