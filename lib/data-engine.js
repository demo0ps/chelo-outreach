'use strict';
/**
 * Data engine (Batch 3): identity resolution, freshness and the public-contact waterfall.
 *
 * Pure functions + a small factory for the waterfall runner so every rule is unit-testable
 * without network access. POPIA stance: the waterfall only ever surfaces organisation facts and
 * the names/titles of people a company itself publishes as CSI / foundation / transformation
 * leadership. It never extracts or guesses email addresses or phone numbers; staff add those.
 */

const REVERIFY_AFTER_DAYS = 90;
const RESEARCH_STALE_DAYS = 30;
const SECOND_LEVEL = new Set(['co.za', 'org.za', 'net.za', 'gov.za', 'ac.za', 'web.za', 'co.uk', 'org.uk', 'com.au', 'co.nz', 'co.bw', 'co.zw', 'co.mz', 'com.na']);
const ORG_NOISE = /\b(pty|ltd|limited|proprietary|inc|incorporated|holdings?|group|sa|south africa|africa|foundation|trust|npc|npo|the|company|co|corp|corporation|plc|international|investments?|services?)\b/g;

function registrableDomain(input) {
  let host = String(input || '').trim().toLowerCase();
  if (!host) return '';
  if (host.includes('@')) host = host.split('@').pop();
  host = host.replace(/^[a-z]+:\/\//, '').split(/[/?#:]/)[0].replace(/^www\./, '');
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const last2 = parts.slice(-2).join('.');
  return SECOND_LEVEL.has(last2) ? parts.slice(-3).join('.') : last2;
}
const FREEMAIL = new Set(['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'live.com', 'webmail.co.za', 'mweb.co.za', 'telkomsa.net', 'vodamail.co.za', 'protonmail.com', 'me.com']);
function isFreemail(domain) { return FREEMAIL.has(String(domain || '').toLowerCase()); }

function normaliseOrgName(name) {
  return String(name || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(ORG_NOISE, ' ').replace(/\s+/g, ' ').trim();
}
function bigrams(str) { const s = ` ${str} `; const out = []; for (let i = 0; i < s.length - 1; i += 1) out.push(s.slice(i, i + 2)); return out; }
/** Sørensen–Dice on character bigrams blended with token Jaccard — robust to word order and small typos. */
function nameSimilarity(a, b) {
  const na = normaliseOrgName(a), nb = normaliseOrgName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ba = bigrams(na), bb = bigrams(nb);
  const counts = new Map(); for (const g of ba) counts.set(g, (counts.get(g) || 0) + 1);
  let hits = 0; for (const g of bb) { const c = counts.get(g); if (c) { hits += 1; counts.set(g, c - 1); } }
  const dice = (2 * hits) / (ba.length + bb.length);
  const ta = new Set(na.split(' ')), tb = new Set(nb.split(' '));
  const inter = [...ta].filter(t => tb.has(t)).length; const union = new Set([...ta, ...tb]).size;
  const jaccard = union ? inter / union : 0;
  const shorter = na.length <= nb.length ? na : nb;
  const containment = (na.includes(nb) || nb.includes(na)) && (shorter.split(' ').length >= 2 || shorter.length >= 10) ? 0.9 : 0;
  const lev = levenshtein(na, nb); const levRatio = 1 - lev / Math.max(na.length, nb.length);
  return Math.max(Math.round(((dice * 0.6) + (jaccard * 0.4)) * 1000) / 1000, containment, Math.round(levRatio * 0.95 * 1000) / 1000);
}
function levenshtein(a, b) {
  if (a === b) return 0; if (!a.length) return b.length; if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) { const cur = [i]; for (let j = 1; j <= b.length; j += 1) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[b.length];
}

function recordDomain(record) {
  const fromEmail = registrableDomain(record.email || '');
  if (fromEmail && !isFreemail(fromEmail)) return fromEmail;
  return registrableDomain(record.website || record.domain || '');
}

/**
 * Compare one incoming record against the existing workspace.
 * Returns matches sorted by score with human-readable reasons. Levels:
 *   'exact' (≥0.92) — same email, or same registrable domain + similar name → block at ingest
 *   'likely' (≥0.62) — fuzzy name or shared domain with a different name → create + merge-review
 */
function findDuplicates(incoming, pools, { threshold = 0.62 } = {}) {
  const inEmail = String(incoming.email || '').trim().toLowerCase();
  const inDomain = recordDomain(incoming);
  const out = [];
  for (const [type, list] of Object.entries(pools)) {
    for (const rec of list || []) {
      if (!rec || rec.id === incoming.id || rec.promotedLeadId) continue;
      const reasons = []; let score = 0;
      const recEmail = String(rec.email || '').trim().toLowerCase();
      if (inEmail && recEmail && inEmail === recEmail) { score = Math.max(score, 1); reasons.push('same email address'); }
      const sim = nameSimilarity(incoming.company, rec.company);
      const recDomain = recordDomain(rec);
      if (inDomain && recDomain && inDomain === recDomain) {
        if (sim >= 0.5) { score = Math.max(score, 0.95); reasons.push(`same domain ${inDomain} + similar name`); }
        else { score = Math.max(score, 0.7); reasons.push(`same domain ${inDomain}`); }
      }
      if (sim >= 0.97) { const distinctDomains = inDomain && recDomain && inDomain !== recDomain; score = Math.max(score, distinctDomains ? 0.85 : 0.93); reasons.push(distinctDomains ? `organisation name matches but domains differ (${inDomain} vs ${recDomain})` : 'organisation name matches'); }
      else if (sim >= 0.8) { score = Math.max(score, 0.75 + (sim - 0.8) * 0.5); reasons.push(`organisation name ${Math.round(sim * 100)}% similar`); }
      else if (sim >= 0.7) { score = Math.max(score, 0.63); reasons.push(`organisation name ${Math.round(sim * 100)}% similar${inDomain && recDomain ? ` (domains differ: ${inDomain} vs ${recDomain})` : ' (no domain to confirm)'}`); }
      if (score >= threshold) out.push({ id: rec.id, type, company: rec.company, email: rec.email || '', score: Math.round(score * 100) / 100, level: score >= 0.92 ? 'exact' : 'likely', reasons });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Field-level merge: primary keeps its values; empty fields are filled from the duplicate; history/notes are appended. */
function mergeRecords(primary, duplicate, { fields = ['contactName', 'title', 'email', 'phone', 'website', 'sector', 'province', 'project', 'projectId', 'amount', 'sourceName', 'sourceUrl', 'notes', 'relationshipContext', 'partnerPriorities', 'owner', 'financialYearEnd'] } = {}) {
  const filled = [];
  for (const f of fields) {
    const cur = primary[f]; const other = duplicate[f];
    const empty = cur === undefined || cur === null || cur === '' || cur === 0;
    if (empty && other !== undefined && other !== null && other !== '' && other !== 0) { primary[f] = other; filled.push(f); }
  }
  if (duplicate.notes && primary.notes && !primary.notes.includes(duplicate.notes)) primary.notes = `${primary.notes}\n— merged: ${duplicate.notes}`.slice(0, 4000);
  primary.mergedFrom = [...(primary.mergedFrom || []), { id: duplicate.id, company: duplicate.company, at: new Date().toISOString(), filled }];
  if (!primary.research && duplicate.research) { primary.research = duplicate.research; filled.push('research'); }
  if (!primary.mailboxCheck && duplicate.mailboxCheck && primary.email === duplicate.email) { primary.mailboxCheck = duplicate.mailboxCheck; filled.push('mailboxCheck'); }
  return filled;
}

// ---------- Freshness & quality ----------
function daysSince(iso, now = new Date()) { const t = Date.parse(iso || ''); return Number.isFinite(t) ? Math.floor((now.getTime() - t) / 86400e3) : null; }
function freshness(record, now = new Date()) {
  const verifiedAt = record.mailboxCheck?.checkedAt || record.contactCheck?.checkedAt || record.verifiedAt || null;
  const vDays = daysSince(verifiedAt, now);
  const rDays = daysSince(record.research?.generatedAt || record.research?.createdAt, now);
  const tDays = daysSince(record.lastTouchAt || record.sentAt || record.updatedAt, now);
  const reasons = [];
  let reverifyDue = false;
  if (record.email) {
    if (vDays === null) { reasons.push('mailbox never verified'); reverifyDue = true; }
    else if (vDays > REVERIFY_AFTER_DAYS) { reasons.push(`mailbox verified ${vDays}d ago`); reverifyDue = true; }
  }
  if (record.research && rDays !== null && rDays > RESEARCH_STALE_DAYS) reasons.push(`research ${rDays}d old`);
  if (!record.email) reasons.push('no email on file');
  // 0–100: verification recency dominates, research recency second, last touch third
  const vScore = record.email ? (vDays === null ? 0 : Math.max(0, 1 - vDays / 180)) : 0.4;
  const rScore = record.research ? (rDays === null ? 0.5 : Math.max(0, 1 - rDays / 90)) : 0.5;
  const tScore = tDays === null ? 0.5 : Math.max(0, 1 - tDays / 365);
  const score = Math.round((vScore * 0.55 + rScore * 0.25 + tScore * 0.2) * 100);
  return { score, verifiedDaysAgo: vDays, researchDaysAgo: rDays, lastTouchDaysAgo: tDays, reverifyDue, reasons, label: score >= 70 ? 'fresh' : score >= 40 ? 'ageing' : 'stale' };
}
function completeness(record) {
  const wanted = ['company', 'contactName', 'title', 'email', 'website', 'sector', 'province', 'sourceUrl', 'projectId'];
  const have = wanted.filter(f => record[f]);
  return { score: Math.round((have.length / wanted.length) * 100), missing: wanted.filter(f => !record[f]) };
}
function dataQuality(record, now = new Date()) {
  const f = freshness(record, now); const c = completeness(record);
  const verifyStatus = record.mailboxCheck?.status || record.contactCheck?.emailStatus || 'unknown';
  const verifyScore = { deliverable: 100, 'catch-all': 70, unknown: 50, 'retry-required': 40, undeliverable: 0, invalid: 0 }[verifyStatus] ?? 50;
  const confidence = Math.round(f.score * 0.4 + c.score * 0.3 + verifyScore * 0.3);
  return { score: confidence, grade: confidence >= 80 ? 'A' : confidence >= 60 ? 'B' : confidence >= 40 ? 'C' : 'D', freshness: f, completeness: c, verifyStatus, reverifyDue: f.reverifyDue };
}

// ---------- Contact waterfall (names + titles only) ----------
const HOPS = [
  { id: 'site', label: 'Company website', confidence: 0.8 },
  { id: 'reports', label: 'Integrated / CSI / B-BBEE reports', confidence: 0.7 },
  { id: 'leadership', label: 'Public leadership pages', confidence: 0.55 },
  { id: 'graph', label: 'Partner graph (your own records)', confidence: 0.9 }
];
const SITE_PATHS = ['/csi', '/corporate-social-investment', '/foundation', '/sustainability', '/transformation', '/leadership', '/our-leadership', '/about-us/leadership', '/management', '/about-us', '/about', '/contact-us', '/contact'];
function ci(pattern) { return pattern.replace(/[a-z]/g, ch => `[${ch.toUpperCase()}${ch}]`); }
const ROLE_WORDS_SRC = '(?:head|manager|director|lead|executive|officer|coordinator|co-ordinator|chair|chairperson|trustee|ceo|chief executive|specialist|general manager|gm|vp|vice president|programme manager)';
const ROLE_WORDS = ci(ROLE_WORDS_SRC);
const TOPIC_WORDS_SRC = '(?:csi|corporate social investment|social investment|community|sustainability|foundation|transformation|esg|socio-economic|sed|enterprise development|stakeholder|corporate affairs|public affairs|impact|shared value)';
const TOPIC_WORDS = ci(TOPIC_WORDS_SRC);
const NAME = "([A-Z][a-z'’-]+(?:\\s(?:[A-Z]\\.?\\s)?[A-Z][a-z'’-]+){1,2})";
const TITLE = `((?:[A-Z][A-Za-z&/-]*\\s){0,3}${ROLE_WORDS}(?:\\s(?:of|for|:|–|-)?\\s?[A-Za-z&/ -]{0,40})?)`;
const PATTERNS = [
  new RegExp(`${NAME}\\s*[,–—(-]\\s*${TITLE}`, 'g'),           // Naledi Mokoena, Head of CSI
  new RegExp(`${TITLE}\\s*[,:–—)-]\\s*${NAME}`, 'g'),          // Head of CSI: Naledi Mokoena
  new RegExp(`${NAME}\\s+(?:is|as)\\s+(?:our|the)\\s+${TITLE}`, 'g') // Naledi Mokoena is our Head of CSI
];
const NAME_STOP = /^(South Africa|Western Cape|Eastern Cape|Northern Cape|Free State|North West|Head Office|Annual Report|Integrated Report|Privacy Policy|Terms Conditions|Read More|Learn More|Contact Us|About Us|Our People|Our Team|Board Of|Executive Committee|Social Investment|Corporate Social|Enterprise Development|Supplier Development|Chief Executive|Managing Director)$/i;
function cleanTitle(t) { return String(t || '').replace(/\s+/g, ' ').replace(/[\s,:;–—-]+$/g, '').trim().slice(0, 90); }
function relevantTitle(title) { return new RegExp(TOPIC_WORDS_SRC, 'i').test(title) || /\b(ceo|chief executive|chairperson|trustee)\b/i.test(title); }
function scrubPII(text) { return String(text || '').replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, ' ').replace(/(\+27|0)\s?\d{2}[\s-]?\d{3}[\s-]?\d{4}/g, ' '); }

/** Extract (name, title) pairs from PII-scrubbed public text. Only CSI/foundation/transformation/sustainability roles are kept. */
function extractPeople(text, { max = 10 } = {}) {
  const clean = scrubPII(text).replace(/\s+/g, ' ');
  const found = new Map();
  for (const [idx, re] of PATTERNS.entries()) {
    re.lastIndex = 0; let m;
    while ((m = re.exec(clean)) && found.size < max * 3) {
      const name = idx === 1 ? m[2] : m[1]; const title = cleanTitle(idx === 1 ? m[1] : m[2]);
      if (!name || !title || NAME_STOP.test(name) || name.split(' ').length < 2) continue;
      if (!relevantTitle(title)) continue;
      const key = name.toLowerCase();
      if (!found.has(key) || found.get(key).title.length < title.length) found.set(key, { name: name.trim(), title });
    }
  }
  return [...found.values()].slice(0, max);
}

function combineConfidence(values) { return Math.round((1 - values.reduce((acc, c) => acc * (1 - c), 1)) * 100) / 100; }

/** Rank people seen across hops; evidence from several independent hops compounds. */
function rankContacts(hits) {
  const byName = new Map();
  for (const h of hits) {
    const key = h.name.toLowerCase().replace(/\s+/g, ' ');
    const cur = byName.get(key) || { name: h.name, title: h.title, hops: [], sources: [], confidences: [] };
    if (!cur.hops.includes(h.hop)) { cur.hops.push(h.hop); cur.confidences.push(h.confidence); }
    if (h.sourceUrl && !cur.sources.includes(h.sourceUrl)) cur.sources.push(h.sourceUrl);
    if (h.title && h.title.length > cur.title.length) cur.title = h.title;
    byName.set(key, cur);
  }
  return [...byName.values()].map(c => ({ name: c.name, title: c.title, hops: c.hops, sources: c.sources.slice(0, 4), confidence: combineConfidence(c.confidences), level: combineConfidence(c.confidences) >= 0.85 ? 'high' : combineConfidence(c.confidences) >= 0.6 ? 'medium' : 'low' }))
    .sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));
}

/** Internal graph hop: people already known on other records of the same registrable domain (no fetching). */
function graphHop(org, pools) {
  const domain = recordDomain(org); if (!domain) return [];
  const hits = [];
  for (const [type, list] of Object.entries(pools)) {
    for (const rec of list || []) {
      if (rec.id === org.id || recordDomain(rec) !== domain) continue;
      if (rec.contactName && rec.contactName.split(' ').length >= 2) hits.push({ name: rec.contactName, title: rec.title || 'Known contact on another record', hop: 'graph', confidence: 0.9, sourceUrl: '', via: `${type}:${rec.id}` });
      for (const c of rec.research?.contacts || []) if (c.name) hits.push({ name: c.name, title: c.title || '', hop: 'graph', confidence: 0.6, sourceUrl: c.sourceUrl || '', via: `${type}:${rec.id}` });
    }
  }
  return hits;
}

/**
 * Waterfall runner. `fetchText(url)` must return PII-safe plain text of a public page (the funder-research
 * fetcher already enforces public-IP checks); `search(query)` returns [{title,url,snippet}] or []. Either may be
 * absent — hops that cannot run are reported as skipped so staff can see exactly which rungs were climbed.
 */
function createWaterfall({ fetchText, search, log = () => {}, maxPages = 8 } = {}) {
  async function run(org, pools = {}, { signal } = {}) {
    const started = Date.now();
    const website = String(org.website || '').trim() || (recordDomain(org) && !isFreemail(recordDomain(org)) ? `https://${recordDomain(org)}` : '');
    const hops = []; const hits = [];
    const stopped = () => signal?.aborted;
    // Hop 1: site
    if (website && fetchText) {
      const base = website.replace(/\/+$/, ''); let pages = 0; let people = 0; const tried = [];
      for (const pathSuffix of SITE_PATHS) {
        if (pages >= maxPages || stopped()) break;
        const url = `${base}${pathSuffix}`;
        try { const text = await fetchText(url); if (!text) continue; pages += 1; tried.push(url); const found = extractPeople(text); people += found.length; for (const p of found) hits.push({ ...p, hop: 'site', confidence: 0.8, sourceUrl: url }); }
        catch (err) { log(`site hop ${url}: ${err.message}`); }
      }
      hops.push({ id: 'site', label: HOPS[0].label, status: pages ? 'done' : 'empty', pages, people, urls: tried.slice(0, 6) });
    } else hops.push({ id: 'site', label: HOPS[0].label, status: 'skipped', reason: website ? 'fetcher unavailable' : 'no website / corporate domain on record' });
    // Hop 2: reports (integrated / CSI / B-BBEE) via search
    if (search && org.company) {
      const queries = [`"${org.company}" integrated report corporate social investment`, `"${org.company}" CSI report OR B-BBEE certificate socio-economic development`];
      let results = []; let people = 0; const urls = []; let unavailable = false;
      for (const q of queries) { if (stopped()) break; try { const r = await search(q); if (r === null) { unavailable = true; break; } results = results.concat(r); } catch (err) { log(`reports search: ${err.message}`); } }
      if (unavailable) { hops.push({ id: 'reports', label: HOPS[1].label, status: 'skipped', reason: 'no search provider configured' }); }
      else {
      results = results.filter(r => /report|csi|b-?bbee|bee|sustainab|foundation|social/i.test(`${r.title} ${r.url} ${r.snippet}`)).slice(0, 6);
      for (const r of results) {
        if (stopped()) break;
        let text = r.snippet || '';
        if (fetchText && !/\.pdf(\?|$)/i.test(r.url)) { try { text = `${text} ${await fetchText(r.url)}`; } catch (err) { log(`reports fetch ${r.url}: ${err.message}`); } }
        const found = extractPeople(text); people += found.length; if (found.length) urls.push(r.url);
        for (const p of found) hits.push({ ...p, hop: 'reports', confidence: 0.7, sourceUrl: r.url });
      }
      hops.push({ id: 'reports', label: HOPS[1].label, status: results.length ? 'done' : 'empty', pages: results.length, people, urls: urls.slice(0, 6) });
      }
    } else hops.push({ id: 'reports', label: HOPS[1].label, status: 'skipped', reason: 'no search provider configured' });
    // Hop 3: public leadership pages via search
    if (search && org.company) {
      const q = `"${org.company}" (head OR manager OR director) ("corporate social investment" OR CSI OR foundation OR sustainability OR transformation)`;
      let results = []; let people = 0; const urls = []; let unavailable = false;
      try { const r = await search(q); if (r === null) unavailable = true; else results = r.filter(x => !/linkedin|facebook|twitter|instagram/i.test(x.url)).slice(0, 6); } catch (err) { log(`leadership search: ${err.message}`); }
      if (unavailable) hops.push({ id: 'leadership', label: HOPS[2].label, status: 'skipped', reason: 'no search provider configured' });
      else {
      for (const r of results) {
        if (stopped()) break;
        let text = r.snippet || '';
        if (fetchText) { try { text = `${text} ${await fetchText(r.url)}`; } catch (err) { log(`leadership fetch ${r.url}: ${err.message}`); } }
        const found = extractPeople(text); people += found.length; if (found.length) urls.push(r.url);
        const official = recordDomain(org) && registrableDomain(r.url) === recordDomain(org);
        for (const p of found) hits.push({ ...p, hop: 'leadership', confidence: official ? 0.7 : 0.55, sourceUrl: r.url });
      }
      hops.push({ id: 'leadership', label: HOPS[2].label, status: results.length ? 'done' : 'empty', pages: results.length, people, urls: urls.slice(0, 6) });
      }
    } else hops.push({ id: 'leadership', label: HOPS[2].label, status: 'skipped', reason: 'no search provider configured' });
    // Hop 4: partner graph (always available)
    const graph = graphHop(org, pools); hits.push(...graph);
    hops.push({ id: 'graph', label: HOPS[3].label, status: graph.length ? 'done' : 'empty', people: graph.length });
    const contacts = rankContacts(hits).slice(0, 12).map((c, i) => ({ id: `wf${i + 1}`, ...c, status: 'pending' }));
    return { ranAt: new Date().toISOString(), durationMs: Date.now() - started, website, hops, contacts, status: contacts.length ? 'pending-review' : 'empty' };
  }
  return { run };
}

module.exports = { REVERIFY_AFTER_DAYS, RESEARCH_STALE_DAYS, HOPS, registrableDomain, isFreemail, normaliseOrgName, nameSimilarity, recordDomain, findDuplicates, mergeRecords, freshness, completeness, dataQuality, extractPeople, rankContacts, combineConfidence, graphHop, createWaterfall, scrubPII };
