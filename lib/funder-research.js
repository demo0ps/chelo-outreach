'use strict';
/**
 * Funder Research — gathers *public, organisational* information about a prospective
 * funder from the internet so emails and proposal PDFs can speak to the funder's own
 * mission in Chelo's terms.
 *
 * POPIA boundary (deliberate):
 *  - Only runs when staff explicitly click "Research funder"; nothing is crawled in bulk.
 *  - Sources: a configured search API (Tavily / Serper / Bing) plus the funder's official
 *    website. Fetched pages are reduced to text and PII-scrubbed (emails, phones, SA IDs)
 *    *before* any AI call. Names of publicly listed CSI / foundation leads may be captured
 *    with job title and source only — never with contact details.
 *  - Lead contact details, relationship notes and partner-priority notes are never sent.
 *  - Output is a cited "Funder Brief" that staff must review and approve before any finding
 *    reaches an email or PDF.
 */
const dns = require('node:dns').promises;
const net = require('node:net');
const crypto = require('node:crypto');
const { scrubPiiForAi } = require('./popia-copilot');

const BRIEF_TTL_DAYS = 30;
const MAX_SOURCES = 10;
const MAX_FETCH_PAGES = 6;
const MAX_PAGE_BYTES = 1_500_000;
const MAX_PAGE_TEXT = 9000;
const FETCH_TIMEOUT_MS = 12000;

const PROVIDERS = {
  tavily: { label: 'Tavily', endpoint: 'https://api.tavily.com/search' },
  serper: { label: 'Serper (Google)', endpoint: 'https://google.serper.dev/search' },
  bing: { label: 'Bing Web Search', endpoint: 'https://api.bing.microsoft.com/v7.0/search' }
};

const signals = require('./signals');
const CHELO_THEMES = [
  { key: 'education', label: 'Education & schools', pattern: /\b(education|school|learner|teacher|literacy|numeracy|stem|maths|science|classroom|bursar|scholarship|tvet|early childhood|ecd)\b/i },
  { key: 'youth', label: 'Youth & skills development', pattern: /\b(youth|skills|employab|apprentice|work-?readiness|entrepreneur|graduate programme)\b/i },
  { key: 'community', label: 'Community development', pattern: /\b(community|township|rural|village|local economic|social investment|csi|socio-?economic)\b/i },
  { key: 'wash', label: 'Water, sanitation & infrastructure', pattern: /\b(water|sanitation|wash|borehole|infrastructure|solar|energy access|electrif)\b/i },
  { key: 'accountability', label: 'Impact measurement & accountability', pattern: /\b(impact (?:measurement|report)|monitoring and evaluation|m&e|outcomes?|accountab|transparen|traceab|theory of change)\b/i },
  { key: 'volunteering', label: 'Employee volunteering', pattern: /\b(employee volunteer|volunteering|staff volunteer|payroll giving)\b/i },
  { key: 'health', label: 'Health & nutrition', pattern: /\b(health|nutrition|feeding scheme|clinic|wellbeing)\b/i }
];

const CSI_TITLE_PATTERN = /\b(?:(?:head|director|manager|lead|executive|chair(?:person|man|woman)?|trustee|ceo|chief executive|general manager)\s+(?:of\s+)?(?:csi|corporate social investment|social impact|sustainability|foundation|community (?:investment|affairs|development)|esg|corporate affairs|transformation|shared value)|(?:csi|corporate social investment|social impact|sustainability|foundation|community investment|esg|corporate affairs|transformation|shared value)\s+(?:head|director|manager|lead|executive|officer|trustee|chair(?:person)?))\b/i;

function nowIso() { return new Date().toISOString(); }
function clamp(value, max) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max); }
function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./i, '').toLowerCase(); } catch { return ''; } }
function registrableDomain(host) {
  const parts = String(host || '').split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const sld = parts[parts.length - 2];
  if (['co', 'org', 'ac', 'gov', 'net', 'com'].includes(sld) && parts.length >= 3) return parts.slice(-3).join('.');
  return parts.slice(-2).join('.');
}

function normaliseWebsite(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    return url.origin;
  } catch { return ''; }
}

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    return lower === '::1' || lower === '::' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80') || lower.startsWith('::ffff:');
  }
  return true;
}

async function assertPublicUrl(url, resolver = dns, allowLoopback = false) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('Invalid source URL.'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only http(s) sources are fetched.');
  if (parsed.username || parsed.password) throw new Error('Source URLs with embedded credentials are rejected.');
  const host = parsed.hostname.toLowerCase();
  if (allowLoopback && (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]')) return parsed;
  if (['localhost', 'metadata.google.internal'].includes(host) || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('Private hosts are never fetched.');
  if (net.isIP(host)) { if (isPrivateAddress(host)) throw new Error('Private IP addresses are never fetched.'); return parsed; }
  const records = await resolver.lookup(host, { all: true }).catch(() => []);
  if (!records.length) throw new Error(`Could not resolve ${host}.`);
  if (records.some(r => isPrivateAddress(r.address))) throw new Error('Hosts resolving to private networks are never fetched.');
  return parsed;
}

function htmlToText(html) {
  let text = String(html || '');
  text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  text = text.replace(/<(?:nav|footer|header|aside)[\s\S]*?<\/(?:nav|footer|header|aside)>/gi, ' ');
  text = text.replace(/<\/(?:p|div|li|h[1-6]|tr|br|section|article)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
  return text.split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(line => line.length > 2).join('\n');
}

function titleFromHtml(html) {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? clamp(htmlToText(match[1]), 140) : '';
}

function splitSentences(text) {
  return String(text || '').replace(/\n+/g, '. ').split(/(?<=[.!?])\s+(?=[A-Z0-9“"(])/).map(s => s.trim()).filter(s => s.length >= 40 && s.length <= 320);
}

module.exports = function createFunderResearch(options = {}) {
  // Resolved lazily so tests and hardened deployments can swap the transport without re-creating the researcher.
  const fetchImpl = (...args) => (options.fetch || globalThis.fetch)(...args);
  const resolver = options.resolver || dns;
  // Loopback fetches are only ever permitted for automated tests / local fixtures, never in production.
  const allowLoopback = Boolean(options.allowLoopback) && process.env.NODE_ENV !== 'production';
  const log = options.log || (() => {});

  // ---------- Search providers ----------
  async function runSearch(searchConfig, query, { domain } = {}) {
    const provider = PROVIDERS[searchConfig.provider];
    if (!provider || !searchConfig.apiKey) return [];
    const endpoint = searchConfig.endpoint || provider.endpoint;
    const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    let results = [];
    try {
      if (searchConfig.provider === 'tavily') {
        const res = await fetchImpl(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal, body: JSON.stringify({ api_key: searchConfig.apiKey, query, max_results: 6, search_depth: 'basic', include_answer: false, ...(domain ? { include_domains: [domain] } : {}) }) });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.detail?.error || json.error || `Tavily returned HTTP ${res.status}.`);
        results = (json.results || []).map(r => ({ title: r.title, url: r.url, snippet: r.content }));
      } else if (searchConfig.provider === 'serper') {
        const res = await fetchImpl(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-KEY': searchConfig.apiKey }, signal, body: JSON.stringify({ q: domain ? `site:${domain} ${query}` : query, num: 6, gl: 'za' }) });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.message || `Serper returned HTTP ${res.status}.`);
        results = (json.organic || []).map(r => ({ title: r.title, url: r.link, snippet: r.snippet }));
      } else if (searchConfig.provider === 'bing') {
        const url = new URL(endpoint);
        url.searchParams.set('q', domain ? `site:${domain} ${query}` : query);
        url.searchParams.set('count', '6');
        url.searchParams.set('mkt', 'en-ZA');
        const res = await fetchImpl(url.href, { headers: { 'Ocp-Apim-Subscription-Key': searchConfig.apiKey }, signal });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error?.message || `Bing returned HTTP ${res.status}.`);
        results = (json.webPages?.value || []).map(r => ({ title: r.name, url: r.url, snippet: r.snippet }));
      }
    } catch (err) {
      log(`search failed for "${query}": ${err.message}`);
      throw err;
    }
    return results.filter(r => r.url && /^https?:\/\//i.test(r.url)).map(r => ({ title: clamp(r.title, 160), url: String(r.url).trim(), snippet: clamp(r.snippet, 400) }));
  }


  // ---------- Organisation discovery (find NEW funders on the web) ----------
  const DISCOVERY_SKIP_HOSTS = /(^|\.)(linkedin|facebook|twitter|x|instagram|youtube|wikipedia|glassdoor|indeed|bizcommunity|news24|iol|timeslive|businesslive|moneyweb|fin24|dailymaverick|gov|ac)\.(com|co\.za|org|za)$/i;
  async function discoverOrganisations(searchConfig, query, { limit = 12 } = {}) {
    const q = clamp(query, 200);
    if (!q) return { organisations: [], warnings: ['Enter a search such as "mining companies with education CSI in South Africa".'] };
    const warnings = [];
    const variants = [`${q} South Africa corporate social investment education`, `${q} CSI foundation South Africa`];
    let results = [];
    for (const v of variants) {
      try { results = results.concat(await runSearch(searchConfig, v)); } catch (err) { warnings.push(err.message); }
    }
    const byDomain = new Map();
    for (const r of results) {
      const host = hostOf(r.url); const domain = registrableDomain(host);
      if (!domain || DISCOVERY_SKIP_HOSTS.test(host) || DISCOVERY_SKIP_HOSTS.test(domain)) continue;
      const scrub = popiaScrub(`${r.title} ${r.snippet}`);
      const entry = byDomain.get(domain) || { domain, website: `https://${host}`, name: guessOrgName(r.title, domain), snippets: [], urls: [], score: 0 };
      entry.snippets.push(clamp(scrub, 240)); entry.urls.push(r.url);
      entry.score += 1 + (/csi|social investment|foundation|education|bursar|school|learner/i.test(r.title + ' ' + r.snippet) ? 1 : 0);
      byDomain.set(domain, entry);
    }
    const organisations = [...byDomain.values()].sort((a, b) => b.score - a.score).slice(0, limit)
      .map(o => ({ domain: o.domain, website: o.website, name: o.name, summary: o.snippets[0] || '', sources: o.urls.slice(0, 3), score: o.score }));
    return { organisations, warnings, query: q };
  }
  function guessOrgName(title, domain) {
    const t = String(title || '').split(/\s[|–—-]\s|:\s/)[0].replace(/\b(home|official site|welcome to)\b/ig, '').trim();
    if (t && t.length <= 60 && !/^https?:/i.test(t)) return t;
    const core = domain.split('.')[0];
    return core.charAt(0).toUpperCase() + core.slice(1);
  }
  function popiaScrub(text) { return String(text || '').replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email removed]').replace(/(\+27|0)\s?\d{2}[\s-]?\d{3}[\s-]?\d{4}/g, '[phone removed]'); }

  function buildQueries(company, website) {
    const name = `"${company}"`;
    const queries = [
      `${name} corporate social investment`,
      `${name} CSI education community programmes South Africa`,
      `${name} foundation annual report social impact`,
      `${name} sustainability report community investment`
    ];
    return { queries, siteQuery: website ? `CSI foundation sustainability community` : null };
  }

  function rankSources(results, website) {
    const officialDomain = registrableDomain(hostOf(website));
    const seen = new Set();
    const ranked = [];
    for (const r of results) {
      const key = r.url.replace(/[#?].*$/, '').replace(/\/$/, '').toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const host = hostOf(r.url);
      const isOfficial = officialDomain && registrableDomain(host) === officialDomain;
      const isPdf = /\.pdf(?:$|[?#])/i.test(r.url);
      const topical = /csi|social|sustainab|foundation|community|impact|esg|annual|report|education/i.test(`${r.url} ${r.title} ${r.snippet}`);
      const blocked = /facebook\.com|twitter\.com|x\.com|instagram\.com|tiktok\.com|youtube\.com|linkedin\.com\/in\//i.test(r.url);
      if (blocked) continue;
      // Search hits on the official domain rank first; guessed official paths rank below topical third-party hits
      // so a long list of guesses never crowds out a real annual-report or press source.
      const score = (isOfficial ? (r.guess ? 12 : 50) : 0) + (topical ? 20 : 0) + (isPdf ? -10 : 0) + (/wikipedia|news24|businesslive|moneyweb|trialogue|bizcommunity/i.test(host) ? 8 : 0);
      ranked.push({ ...r, host, isOfficial: Boolean(isOfficial), isPdf, score });
    }
    return ranked.sort((a, b) => b.score - a.score).slice(0, MAX_SOURCES);
  }

  // ---------- Fetching ----------
  async function fetchPublicText(url, { includeHtml = false } = {}) {
    await assertPublicUrl(url, resolver, allowLoopback);
    const res = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { 'User-Agent': 'CheloPartnershipsResearch/1.0 (+staff-initiated public-page review)', 'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = String(res.headers.get('content-type') || '').toLowerCase();
    if (type.includes('application/pdf')) throw new Error('PDF source — open it and use Paste-to-Extract for the relevant pages.');
    if (!/text\/html|application\/xhtml|text\/plain/.test(type) && type) throw new Error(`Unsupported content type (${type.split(';')[0]}).`);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_PAGE_BYTES) throw new Error('Page too large to review safely.');
    const html = buffer.toString('utf8');
    const text = type.includes('text/plain') ? html : htmlToText(html);
    return { title: titleFromHtml(html), text: text.slice(0, MAX_PAGE_TEXT), html: includeHtml ? html : undefined };
  }

  // ---------- Local (no-AI) extraction ----------
  function heuristicBrief(company, pages, projects) {
    const findings = [];
    const contacts = [];
    const themeHits = new Map();
    const seenText = new Set();
    for (const page of pages) {
      const sentences = splitSentences(page.text);
      for (const sentence of sentences) {
        const lower = sentence.toLowerCase();
        const normalised = lower.replace(/[^a-z0-9]+/g, ' ').trim();
        if (seenText.has(normalised)) continue;
        if (/cookie|privacy policy|terms of use|subscribe|all rights reserved|click here/i.test(sentence)) continue;
        const mentionsOrg = lower.includes(company.toLowerCase().split(/\s+/)[0]) || /\b(we|our|the group|the foundation|the trust)\b/i.test(sentence);
        const missionLike = /\b(mission|vision|purpose|committed to|commitment|we believe|our approach|focus(?:es|ed)? on|invest(?:s|ed|ing)? in|support(?:s|ed|ing)? |aims? to|strateg)/i.test(sentence);
        const themes = CHELO_THEMES.filter(t => t.pattern.test(sentence)).map(t => t.key);
        if (!themes.length || !(missionLike || mentionsOrg)) continue;
        seenText.add(normalised);
        for (const theme of themes) themeHits.set(theme, (themeHits.get(theme) || 0) + 1);
        const figures = /\bR\s?\d[\d,.]*\s*(?:million|billion|m|bn)?\b|\b\d{2,}(?:,\d{3})*\s+(?:learners|schools|students|beneficiaries|youth|teachers|bursaries)\b/i.test(sentence);
        findings.push({
          kind: figures ? 'public_figure' : (missionLike ? 'mission' : 'programme'),
          text: clamp(sentence, 320),
          themes,
          sourceUrl: page.url,
          sourceTitle: page.title,
          confidence: page.isOfficial ? 'high' : 'medium'
        });
        if (findings.length >= 24) break;
      }
      // Publicly listed CSI / foundation leads: "Name, Head of CSI" or "Head of CSI: Name"
      const contactRegex = /([A-Z][a-z]+(?:\s[A-Z][a-z'’-]+){1,3})\s*[,–—-]\s*((?:[A-Z][\w&'’/ -]{2,60}))|((?:Head|Director|Manager|Lead|Executive|Trustee|Chair(?:person)?)[\w &'’/-]{0,50})[:–—-]\s*([A-Z][a-z]+(?:\s[A-Z][a-z'’-]+){1,3})/g;
      let match;
      while ((match = contactRegex.exec(page.text)) && contacts.length < 8) {
        const name = match[1] || match[4];
        const title = clamp(match[2] || match[3], 90);
        if (!name || !title || !CSI_TITLE_PATTERN.test(title)) continue;
        if (contacts.some(c => c.name === name)) continue;
        contacts.push({ name: clamp(name, 80), title, sourceUrl: page.url, sourceTitle: page.title, confidence: page.isOfficial ? 'medium' : 'low' });
      }
    }
    const sortedThemes = [...themeHits.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => CHELO_THEMES.find(t => t.key === key));
    const focusAreas = sortedThemes.slice(0, 4).map(t => t.label);
    const suggestedProject = suggestProject(focusAreas, projects);
    const missionSummary = findings.find(f => f.kind === 'mission')?.text || '';
    return { findings: findings.slice(0, 16), contacts, focusAreas, missionSummary, suggestedProjectId: suggestedProject?.id || '', alignmentPoints: buildAlignmentPoints(company, sortedThemes, findings) };
  }

  function suggestProject(focusAreas, projects = []) {
    const joined = focusAreas.join(' ').toLowerCase();
    return projects.find(p => {
      const hay = `${p.sector || ''} ${p.name || ''}`.toLowerCase();
      return (/water|sanitation|infrastructure/.test(joined) && /water|wash|sanitation|solar|infrastructure/.test(hay))
        || (/youth|skills/.test(joined) && /youth|skills|employ/.test(hay))
        || (/education/.test(joined) && /education|literacy|stem|school|ecd/.test(hay));
    }) || null;
  }

  function buildAlignmentPoints(company, themes, findings) {
    const map = {
      education: `${company} publicly prioritises education; Chelo channels funding to verified schools and education NGOs with progress reporting.`,
      youth: `${company} invests in youth and skills; Chelo's youth-focused projects report participation and progression, not just spend.`,
      community: `${company} frames its investment around community development; Chelo's recipients are community-based and verified before listing.`,
      wash: `${company} supports water, sanitation and infrastructure; Chelo's infrastructure projects publish baseline and latest metrics with cited sources.`,
      accountability: `${company} emphasises measurable impact; Chelo's traceable funding and milestone reporting are built for exactly that expectation.`,
      volunteering: `${company} runs employee volunteering; Chelo projects can accommodate staff involvement alongside funding.`,
      health: `${company} supports health and nutrition; several Chelo school projects include feeding and wellbeing components.`
    };
    return themes.slice(0, 3).map(theme => {
      const evidence = findings.find(f => f.themes.includes(theme.key));
      return { theme: theme.key, text: map[theme.key], evidence: evidence?.text || '', sourceUrl: evidence?.sourceUrl || '', sourceTitle: evidence?.sourceTitle || '' };
    });
  }

  // ---------- AI extraction (optional) ----------
  async function aiBrief(company, pages, projects, aiConfig, baseline) {
    const sources = pages.map((p, i) => ({ ref: `S${i + 1}`, url: p.url, title: p.title, official: p.isOfficial, excerpt: p.text.slice(0, 3500) }));
    const projectList = projects.map(p => ({ id: p.id, name: p.name, sector: p.sector, province: p.province }));
    const system = `You are a research analyst for Chelo, a South African platform connecting corporate CSI/ESG teams and foundations with verified schools, NGOs and community projects (traceable funding, milestone and impact reporting). You receive PII-scrubbed excerpts of PUBLIC web pages about a funder. Extract only organisational facts that are explicitly supported by the excerpts and cite the source ref for each. Never infer, never invent figures, never include emails, phone numbers or private individuals. Publicly listed CSI/foundation leaders may be listed by name and job title only. Return ONLY valid JSON: {"missionSummary": string (<=240 chars), "focusAreas": string[] (<=5), "findings": [{"kind": "mission"|"programme"|"public_figure"|"grant_window", "text": string (<=300 chars, factual, no marketing adjectives), "ref": "S1", "confidence": "high"|"medium"|"low"}] (<=12), "contacts": [{"name": string, "title": string, "ref": "S1"}] (<=5), "alignmentPoints": [{"text": string (<=260 chars, one sentence linking a cited funder priority to a concrete Chelo strength), "ref": "S1"}] (<=3), "suggestedProjectId": string|"" (choose from projects only when the fit is clear)}. If the excerpts do not support a field, return it empty.`;
    const response = await fetchImpl(aiConfig.endpoint, {
      method: 'POST', headers: { 'Authorization': `Bearer ${aiConfig.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: aiConfig.model, temperature: 0.1, max_tokens: 1400, messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify({ funder: company, projects: projectList, sources }) }] }),
      signal: AbortSignal.timeout(45000)
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json.error?.message || `AI provider request failed (${response.status}).`);
    const content = String(json.choices?.[0]?.message?.content || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    let parsed;
    try { parsed = JSON.parse(content); } catch { const s = content.indexOf('{'); const e = content.lastIndexOf('}'); if (s < 0 || e <= s) throw new Error('AI provider returned an unreadable brief.'); parsed = JSON.parse(content.slice(s, e + 1)); }
    const byRef = Object.fromEntries(sources.map(s => [s.ref, s]));
    const resolve = ref => byRef[String(ref || '').trim()] || null;
    const scrubText = value => scrubPiiForAi(clamp(value, 320)).scrubbedText;
    const findings = (Array.isArray(parsed.findings) ? parsed.findings : []).map(f => { const src = resolve(f.ref); return src ? { kind: ['mission', 'programme', 'public_figure', 'grant_window'].includes(f.kind) ? f.kind : 'programme', text: scrubText(f.text), themes: CHELO_THEMES.filter(t => t.pattern.test(String(f.text || ''))).map(t => t.key), sourceUrl: src.url, sourceTitle: src.title, confidence: ['high', 'medium', 'low'].includes(f.confidence) ? f.confidence : 'medium' } : null; }).filter(f => f && f.text.length >= 20).slice(0, 12);
    const contacts = (Array.isArray(parsed.contacts) ? parsed.contacts : []).map(c => { const src = resolve(c.ref); return src && c.name && c.title ? { name: clamp(c.name, 80), title: clamp(c.title, 90), sourceUrl: src.url, sourceTitle: src.title, confidence: src.official ? 'medium' : 'low' } : null; }).filter(Boolean).slice(0, 5);
    const alignmentPoints = (Array.isArray(parsed.alignmentPoints) ? parsed.alignmentPoints : []).map(a => { const src = resolve(a.ref); return a.text ? { theme: (CHELO_THEMES.find(t => t.pattern.test(String(a.text))) || {}).key || 'community', text: scrubText(a.text), evidence: '', sourceUrl: src?.url || '', sourceTitle: src?.title || '' } : null; }).filter(Boolean).slice(0, 3);
    const suggestedProjectId = projects.some(p => p.id === parsed.suggestedProjectId) ? parsed.suggestedProjectId : baseline.suggestedProjectId;
    return {
      missionSummary: scrubText(parsed.missionSummary) || baseline.missionSummary,
      focusAreas: (Array.isArray(parsed.focusAreas) ? parsed.focusAreas : []).map(v => clamp(v, 60)).filter(Boolean).slice(0, 5).concat(baseline.focusAreas).filter((v, i, arr) => arr.indexOf(v) === i).slice(0, 5),
      findings: findings.length ? findings : baseline.findings,
      contacts: contacts.length ? contacts : baseline.contacts,
      alignmentPoints: alignmentPoints.length ? alignmentPoints : baseline.alignmentPoints,
      suggestedProjectId
    };
  }

  // ---------- Orchestration ----------
  async function researchFunder({ company, website, sector }, { searchConfig, aiConfig, projects = [] } = {}) {
    const name = clamp(company, 150).replace(/\s·\sDemo$/, '');
    if (!name) throw new Error('A funder/organisation name is required for research.');
    const site = normaliseWebsite(website);
    const searchReady = Boolean(PROVIDERS[searchConfig?.provider] && searchConfig?.apiKey);
    if (!searchReady && !site) throw new Error('Configure a web-search provider in Settings or add the funder\'s official website (Source URL) before researching.');

    const warnings = [];
    let results = [];
    if (searchReady) {
      const { queries, siteQuery } = buildQueries(name, site);
      const tasks = queries.map(q => runSearch(searchConfig, q).catch(err => { warnings.push(`Search skipped: ${err.message}`); return []; }));
      if (siteQuery) tasks.push(runSearch(searchConfig, `${name} ${siteQuery}`, { domain: registrableDomain(hostOf(site)) }).catch(() => []));
      results = (await Promise.all(tasks)).flat();
    }
    if (site) {
      for (const pathSuffix of ['', '/sustainability', '/csi', '/foundation', '/corporate-social-investment', '/community', '/about-us', '/about']) {
        results.push({ title: `${name} official site${pathSuffix || ''}`, url: `${site}${pathSuffix}`, snippet: '', guess: true });
      }
    }
    const sources = rankSources(results, site);
    if (!sources.length) throw new Error('No public sources were found for this organisation. Check the spelling or add the official website.');

    const pages = [];
    const attempted = [];
    const queue = sources.filter(s => !s.isPdf).slice(0, MAX_FETCH_PAGES + 4);
    let index = 0;
    async function worker() {
      while (index < queue.length && pages.length < MAX_FETCH_PAGES) {
        const source = queue[index++];
        try {
          const page = await fetchPublicText(source.url);
          if (page.text.length < 200) { attempted.push({ url: source.url, status: 'skipped', reason: 'Little readable text.' }); continue; }
          const scrubbed = scrubPiiForAi(page.text);
          pages.push({ url: source.url, title: page.title || source.title, isOfficial: source.isOfficial, text: scrubbed.scrubbedText, redactions: scrubbed.redactions });
          attempted.push({ url: source.url, status: 'read' });
        } catch (err) {
          attempted.push({ url: source.url, status: 'skipped', reason: clamp(err.message, 160) });
        }
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    for (const pdf of sources.filter(s => s.isPdf)) attempted.push({ url: pdf.url, status: 'skipped', reason: 'PDF source — open it and use Paste-to-Extract for the relevant pages.' });

    const redactions = pages.reduce((acc, p) => ({ emails: acc.emails + p.redactions.emails, phones: acc.phones + p.redactions.phones, saIds: acc.saIds + p.redactions.saIds }), { emails: 0, phones: 0, saIds: 0 });
    redactions.total = redactions.emails + redactions.phones + redactions.saIds;

    let mode = 'local';
    let extracted = heuristicBrief(name, pages, projects);
    if (pages.length && aiConfig?.apiKey) {
      try { extracted = await aiBrief(name, pages, projects, aiConfig, extracted); mode = 'openai'; }
      catch (err) { warnings.push(`AI synthesis unavailable (${clamp(err.message, 120)}); local extraction shown instead.`); }
    }
    if (!pages.length) warnings.push('No pages could be read. Search snippets only; consider adding the official website or using Paste-to-Extract.');
    if (!pages.length) {
      // Fall back to search snippets as low-confidence findings so staff still see something citable.
      extracted = heuristicBrief(name, sources.filter(s => s.snippet).map(s => ({ url: s.url, title: s.title, isOfficial: s.isOfficial, text: s.snippet })), projects);
      extracted.findings = extracted.findings.map(f => ({ ...f, confidence: 'low' }));
    }

    const stamp = id => `${id}-${crypto.randomBytes(3).toString('hex')}`;
    const generatedAt = nowIso();
    return {
      id: `brief-${crypto.randomBytes(6).toString('hex')}`,
      company: name,
      website: site,
      sector: clamp(sector, 100),
      generatedAt,
      expiresAt: new Date(Date.now() + BRIEF_TTL_DAYS * 86400000).toISOString(),
      provider: searchReady ? searchConfig.provider : 'official-site',
      mode,
      status: 'pending-review',
      missionSummary: extracted.missionSummary,
      focusAreas: extracted.focusAreas,
      suggestedProjectId: extracted.suggestedProjectId,
      findings: extracted.findings.map((f, i) => ({ id: stamp(`f${i + 1}`), ...f })),
      contacts: extracted.contacts.map((c, i) => ({ id: stamp(`c${i + 1}`), ...c })),
      alignmentPoints: extracted.alignmentPoints.map((a, i) => ({ id: stamp(`a${i + 1}`), ...a })),
      sources: pages.map(p => ({ url: p.url, title: p.title, official: p.isOfficial })),
      signals: (() => { for (const p of [...pages].sort((a, b) => Number(b.isOfficial) - Number(a.isOfficial))) { const fye = signals.inferFinancialYearEnd(p.text); if (fye) return { financialYearEnd: { ...fye, sourceUrl: p.url, sourceTitle: p.title } }; } return {}; })(),
      attempted,
      redactions,
      warnings,
      approvedFindingIds: [],
      approvedAlignmentIds: [],
      approvedContactIds: []
    };
  }

  function isStale(brief, referenceDate = new Date()) {
    if (!brief?.expiresAt) return true;
    return new Date(brief.expiresAt).getTime() < referenceDate.getTime();
  }

  /** Context safe to hand to drafting (AI or local): only staff-approved, cited, organisational findings. */
  function approvedContext(brief) {
    if (!brief || brief.status !== 'approved') return null;
    const findings = brief.findings.filter(f => brief.approvedFindingIds.includes(f.id));
    const alignment = brief.alignmentPoints.filter(a => brief.approvedAlignmentIds.includes(a.id));
    if (!findings.length && !alignment.length && !brief.missionSummary) return null;
    return {
      funderMissionSummary: brief.missionSummary || '',
      funderFocusAreas: brief.focusAreas || [],
      citedFunderFacts: findings.map(f => ({ fact: f.text, source: f.sourceUrl })),
      alignmentWithChelo: alignment.map(a => ({ point: a.text, source: a.sourceUrl })),
      researchedAt: brief.generatedAt,
      stale: isStale(brief)
    };
  }

  return { researchFunder, discoverOrganisations, approvedContext, isStale, fetchPublicText, runSearch, htmlToText, assertPublicUrl, rankSources, heuristicBrief, PROVIDERS, BRIEF_TTL_DAYS };
};
module.exports.PROVIDERS = PROVIDERS;
module.exports.BRIEF_TTL_DAYS = BRIEF_TTL_DAYS;
