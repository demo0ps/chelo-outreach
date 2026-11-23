'use strict';
// v58 — News intelligence. Two jobs:
//   1. Discovery: tell publisher pages (news, directories, job boards, government, universities, social) apart from a
//      company's own site, and pull *organisation names that give* out of articles.
//   2. Homework: pull dated giving/CSI facts about one funder out of articles so the email can show we read up on them.
// POPIA: only organisation text reaches the AI; callers scrub PII first. People's names/emails are never extracted here.

const { scrubPiiForAi } = require('./popia-copilot');

const FRESH_MONTHS = 12;
const MEDIA_HOSTS = /(^|\.)(news24|iol|timeslive|sowetanlive|businesslive|bdlive|moneyweb|fin24|dailymaverick|bizcommunity|citizen|mg|engineeringnews|miningweekly|polity|itweb|techcentral|mybroadband|businesstech|thesouthafrican|briefly|iafrica|ewn|sabcnews|enca|702|capetalk|jacarandafm|skillsportal|africa\.com|allafrica|reuters|bloomberg|ft|theguardian|bbc|cnbcafrica|forbesafrica|trialogue|ngopulse|prnewswire|africabusinesscommunities|howwemadeitinafrica|ventureburn|csi-?magazine|mediaupdate|marklives|adlip|thedailyvox|groundup|spotlightnsp|health-e|theconversation|wikipedia|wikidata)\.(com|co\.za|org|org\.za|africa|net|za)$/i;
const DIRECTORY_HOSTS = /(^|\.)(yellowpages|yelp|cylex|hotfrog|brabys|saopen|opencorporates|zoominfo|crunchbase|dnb|glassdoor|indeed|careers24|pnet|careerjunction|linkedin|facebook|twitter|x|instagram|tiktok|youtube|pinterest|prodder|charitysa|givengain|backabuddy|forgood|sacoronavirus|gov|ac|edu)\.(com|co\.za|org|org\.za|za|net)$/i;
const TOOL_HOSTS = /(^|\.)(tavily|serper|bing|google|duckduckgo|openai|anthropic)\.(com|dev|ai|co\.za)$/i;
const PATH_HINTS = /\/(news|article|articles|press|story|stories|magazine|blog|opinion|jobs|vacanc|careers?)(\/|$|-)/i;

function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./i, '').toLowerCase(); } catch { return ''; } }
function registrable(host) { const p = String(host || '').split('.').filter(Boolean); if (p.length <= 2) return p.join('.'); const sld = p[p.length - 2]; return ['co', 'org', 'ac', 'gov', 'net', 'com'].includes(sld) && p.length >= 3 ? p.slice(-3).join('.') : p.slice(-2).join('.'); }
function clamp(v, n) { return String(v || '').replace(/\s+/g, ' ').trim().slice(0, n); }

/** 'media' | 'directory' | 'government' | 'academic' | 'social' | 'company'. Only 'company' hosts may become funders. */
function classifyHost(host) {
  const h = String(host || '').toLowerCase();
  if (!h) return 'company';
  if (/\.(gov|gov\.za|mil)$/.test(h) || /(^|\.)gov\./.test(h)) return 'government';
  if (/\.(ac\.za|edu|edu\.za|ac\.uk)$/.test(h) || /(^|\.)(university|univ|college)\b/.test(h)) return 'academic';
  if (/(^|\.)(linkedin|facebook|twitter|x|instagram|tiktok|youtube|pinterest)\.com$/.test(h)) return 'social';
  if (TOOL_HOSTS.test(h)) return 'directory'; // our own search/AI providers leaking into results are never funders
  if (MEDIA_HOSTS.test(h) || /(news|times|magazine|gazette|tribune|herald|press|journal|weekly|daily|chronicle|bulletin|media|insider|billionaire|knowledgehub|hub|review|report|africa)\b/.test(h.split('.')[0]) || /(^|\.)(businessinsider|billionaires|trialogueknowledgehub|africanbusiness|africareport)\./.test(h)) return 'media';
  if (DIRECTORY_HOSTS.test(h) || /(jobs|careers|directory|listing)/.test(h.split('.')[0])) return 'directory';
  return 'company';
}
function isPublisherUrl(url) { const host = hostOf(url); return classifyHost(host) !== 'company' || PATH_HINTS.test(String(url).replace(/^https?:\/\/[^/]+/, '')); }
function outletName(url) { const host = registrable(hostOf(url)); const core = host.split('.')[0]; return core ? core.charAt(0).toUpperCase() + core.slice(1) : host; }

// --- Dates --------------------------------------------------------------------------------------------------------
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
function parseLoose(s) { const t = Date.parse(s); return Number.isFinite(t) ? new Date(t) : null; }
/** Best-effort publish date: meta tags → JSON-LD → URL (/2026/03/) → "12 March 2026" in the text. Returns ISO date or ''. */
function articleDate({ url = '', html = '', text = '' } = {}) {
  const meta = String(html).match(/<meta[^>]+(?:property|name)=["'](?:article:published_time|datePublished|date|pubdate|publish-date|og:published_time|dc\.date(?:\.issued)?)["'][^>]+content=["']([^"']+)["']/i) || String(html).match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:article:published_time|datePublished|pubdate)["']/i);
  const ld = String(html).match(/"datePublished"\s*:\s*"([^"]+)"/);
  const time = String(html).match(/<time[^>]+datetime=["']([^"']+)["']/i);
  for (const m of [meta, ld, time]) { const d = m && parseLoose(m[1]); if (d) return d.toISOString().slice(0, 10); }
  const u = String(url).match(/\/(20\d{2})[/-](0?[1-9]|1[0-2])(?:[/-](0?[1-9]|[12]\d|3[01]))?(?:\/|$|-)/);
  if (u) return new Date(Date.UTC(Number(u[1]), Number(u[2]) - 1, Number(u[3] || 1))).toISOString().slice(0, 10);
  const t = String(text).slice(0, 1500).match(/\b(0?[1-9]|[12]\d|3[01])\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(20\d{2})\b/i) || String(text).slice(0, 1500).match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(0?[1-9]|[12]\d|3[01]),?\s+(20\d{2})\b/i);
  if (t) { const dayFirst = /^\d/.test(t[0]); const day = Number(dayFirst ? t[1] : t[2]); const mon = MONTHS[(dayFirst ? t[2] : t[1]).slice(0, 4).toLowerCase()] ?? MONTHS[(dayFirst ? t[2] : t[1]).slice(0, 3).toLowerCase()]; return new Date(Date.UTC(Number(t[3]), mon, day)).toISOString().slice(0, 10); }
  return '';
}
function isFresh(dateIso, now = new Date()) { if (!dateIso) return false; const d = Date.parse(dateIso); return Number.isFinite(d) && now.getTime() - d <= FRESH_MONTHS * 30.5 * 86400000 && d <= now.getTime() + 86400000; }
/** "earlier this year" / "last year" / "in 2023" — plain phrasing for the email, never the outlet name. */
function whenPhrase(dateIso, now = new Date()) {
  if (!dateIso) return '';
  const d = new Date(dateIso); const y = d.getUTCFullYear(), ny = now.getUTCFullYear();
  if (y === ny) return now.getUTCMonth() - d.getUTCMonth() <= 2 ? 'recently' : 'earlier this year';
  if (y === ny - 1) return 'last year';
  return `in ${y}`;
}

// --- Giving facts about one funder -----------------------------------------------------------------------------
const GIVING = /\b(donat|handed over|hands over|hand over|bursar|scholarship|fund(?:ed|s|ing)? |invest(?:ed|s)? R|sponsor|built|build(?:s|ing)? |classroom|school|learner|csi|corporate social investment|social investment|foundation|trust|award|pledg|contribut|grant|library|laborator|computer lab|feeding|teacher)/i;
const FIGURE = /\bR\s?\d[\d,.\s]*\s*(?:million|billion|m|bn|k)?\b|\b\d{1,3}(?:[ ,]\d{3})+\b|\b\d+\s+(?:schools?|learners?|students?|bursaries|classrooms?|teachers?|youth|graduates?)\b/i;
function splitSentences(text) { return String(text || '').replace(/\n+/g, '. ').split(/(?<=[.!?])\s+(?=[A-Z0-9“"(])/).map(s => s.trim()).filter(s => s.length >= 40 && s.length <= 300); }
function mentions(sentence, company) { const first = String(company || '').split(/\s+/).filter(w => w.length > 2 && !/^(the|group|limited|ltd|pty|holdings|foundation|trust|sa)$/i.test(w))[0]; return first ? new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(sentence) : false; }

function heuristicGivingFacts(company, articles) {
  const out = []; const seen = new Set();
  for (const a of articles) {
    for (const s of splitSentences(a.text)) {
      if (!mentions(s, company) || !GIVING.test(s.replace(new RegExp(String(company).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' '))) continue; // the company's own name ("…Trust") must not count as giving
      if (/cookie|subscribe|all rights reserved|click here|read more/i.test(s)) continue;
      const key = s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); if (seen.has(key)) continue; seen.add(key);
      out.push({ text: clamp(s, 300), kind: FIGURE.test(s) ? 'public_figure' : 'programme', sourceUrl: a.url, sourceTitle: a.title, publishedAt: a.publishedAt || '', outlet: a.outlet || outletName(a.url), confidence: 'medium' });
      if (out.length >= 8) return out;
    }
  }
  return out;
}

async function aiGivingFacts(company, articles, aiConfig, fetchImpl = globalThis.fetch) {
  const sources = articles.map((a, i) => ({ ref: `N${i + 1}`, url: a.url, title: a.title, publishedAt: a.publishedAt || 'unknown', excerpt: scrubPiiForAi(String(a.text || '').slice(0, 3000)).scrubbedText }));
  const system = `You extract ONLY giving and CSI facts about the organisation "${company}" from South African news excerpts: donations, bursaries, school builds or hand-overs, CSI/social-investment spend, foundation launches, CSI awards. Ignore business news, people, opinions and anything about other organisations. Never include people's names or contact details. Return JSON {"facts":[{"ref":"N1","text":"one plain sentence in third person naming ${company}, with the figure/place/year if stated","kind":"public_figure|programme"}]} with at most 6 facts, each traceable to one ref. If nothing qualifies return {"facts":[]}.`;
  const res = await fetchImpl(aiConfig.endpoint, { method: 'POST', headers: { Authorization: `Bearer ${aiConfig.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: aiConfig.model, temperature: 0.1, max_tokens: 700, messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify({ organisation: company, sources }) }] }), signal: AbortSignal.timeout(40000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message || `AI provider request failed (${res.status}).`);
  const content = String(json.choices?.[0]?.message?.content || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let parsed; try { parsed = JSON.parse(content); } catch { const s = content.indexOf('{'), e = content.lastIndexOf('}'); parsed = s >= 0 && e > s ? JSON.parse(content.slice(s, e + 1)) : { facts: [] }; }
  const byRef = Object.fromEntries(articles.map((a, i) => [`N${i + 1}`, a]));
  return (Array.isArray(parsed.facts) ? parsed.facts : []).map(f => { const a = byRef[String(f.ref || '').trim()]; const text = scrubPiiForAi(clamp(f.text, 300)).scrubbedText; return a && text ? { text, kind: f.kind === 'public_figure' ? 'public_figure' : 'programme', sourceUrl: a.url, sourceTitle: a.title, publishedAt: a.publishedAt || '', outlet: a.outlet || outletName(a.url), confidence: 'medium' } : null; }).filter(Boolean).slice(0, 6);
}

/** Dated giving facts for one funder. `articles` = [{url,title,text,publishedAt}]. Fresh ones are flagged for use in emails. */
async function givingFacts(company, articles, { aiConfig, fetchImpl, now = new Date() } = {}) {
  const list = articles.filter(a => a && a.url && a.text);
  if (!list.length) return [];
  let facts = [];
  if (aiConfig?.apiKey) { try { facts = await aiGivingFacts(company, list, aiConfig, fetchImpl); } catch { facts = []; } }
  if (!facts.length) facts = heuristicGivingFacts(company, list);
  return facts.map(f => ({ ...f, kind: 'news_giving', figure: f.kind === 'public_figure', fresh: isFresh(f.publishedAt, now), when: whenPhrase(f.publishedAt, now) }));
}

// --- Organisation names that give (discovery) -------------------------------------------------------------------
const GIVER_VERBS = /\b(donated|donates|handed over|hands over|funded|funds|invested|invests|sponsored|sponsors|pledged|pledges|contributed|contributes|launched (?:its|a|the) (?:\w+ )?(?:foundation|trust|bursary|programme)|awarded|committed R|spent R|built|opened)\b/i;
const NOT_ORG = /^(the|a|an|south africa|south african|government|department|minister|president|premier|mec|ceo|chief|head|director|learners|schools|students|teachers|community|province|gauteng|limpopo|mpumalanga|kwazulu|natal|eastern cape|western cape|northern cape|free state|north west|johannesburg|pretoria|cape town|durban|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|this|that|these|those|it|he|she|they|we|our|their)$/i;
function heuristicFunderNames(articles) {
  const counts = new Map();
  for (const a of articles) {
    for (const s of splitSentences(a.text)) {
      if (!GIVER_VERBS.test(s)) continue;
      const m = s.match(/((?:[A-Z][\w&'’.-]*\s?){1,5}?(?:\s(?:Group|Holdings|Foundation|Trust|Bank|Mining|Limited|Ltd|Platinum|Gold|Energy|Insurance|Capital|Motors|Africa|SA|Investments|Properties|Fund))?)\s+(?:has\s+|have\s+|recently\s+)?(?:donated|handed over|hands over|funded|invested|sponsored|pledged|contributed|launched|awarded|committed|spent|built|opened)/);
      if (!m) continue;
      const name = m[1].replace(/\s+(has|have|recently|the)$/i, '').trim();
      if (name.length < 3 || name.length > 60 || NOT_ORG.test(name) || name.split(' ').every(w => NOT_ORG.test(w))) continue;
      const e = counts.get(name) || { name, mentions: 0, sources: new Set(), evidence: '' };
      e.mentions += 1; e.sources.add(a.url); e.evidence = e.evidence || clamp(s, 220); counts.set(name, e);
    }
  }
  return [...counts.values()].sort((a, b) => b.mentions - a.mentions).map(e => ({ name: e.name, evidence: e.evidence, sources: [...e.sources] })).slice(0, 12);
}
async function aiFunderNames(articles, aiConfig, fetchImpl = globalThis.fetch) {
  const sources = articles.map((a, i) => ({ ref: `N${i + 1}`, title: a.title, excerpt: scrubPiiForAi(String(a.text || '').slice(0, 2500)).scrubbedText }));
  const system = 'From these South African news excerpts list ORGANISATIONS that GIVE money or resources to schools, NGOs or communities (companies, corporate foundations, trusts). Exclude recipients (schools, NGOs), government, universities, media, and any people. Return JSON {"organisations":[{"name":"official organisation name","ref":"N1","evidence":"one short sentence from the excerpt showing it gave"}]} — at most 10, deduplicated, no people, no contact details.';
  const res = await fetchImpl(aiConfig.endpoint, { method: 'POST', headers: { Authorization: `Bearer ${aiConfig.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: aiConfig.model, temperature: 0.1, max_tokens: 600, messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify({ sources }) }] }), signal: AbortSignal.timeout(40000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message || `AI provider request failed (${res.status}).`);
  const content = String(json.choices?.[0]?.message?.content || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let parsed; try { parsed = JSON.parse(content); } catch { const s = content.indexOf('{'), e = content.lastIndexOf('}'); parsed = s >= 0 && e > s ? JSON.parse(content.slice(s, e + 1)) : { organisations: [] }; }
  const byRef = Object.fromEntries(articles.map((a, i) => [`N${i + 1}`, a]));
  const seen = new Set();
  return (Array.isArray(parsed.organisations) ? parsed.organisations : []).map(o => { const a = byRef[String(o.ref || '').trim()]; const name = clamp(o.name, 80); const k = name.toLowerCase(); if (!a || !name || seen.has(k) || NOT_ORG.test(name)) return null; seen.add(k); return { name, evidence: scrubPiiForAi(clamp(o.evidence, 220)).scrubbedText, sources: [a.url] }; }).filter(Boolean).slice(0, 10);
}
/** Organisation names that give, from article pages. AI when available, heuristic otherwise. */
async function funderNamesFromArticles(articles, { aiConfig, fetchImpl } = {}) {
  const list = articles.filter(a => a && a.text);
  if (!list.length) return [];
  if (aiConfig?.apiKey) { try { const r = await aiFunderNames(list, aiConfig, fetchImpl); if (r.length) return r; } catch { /* fall through */ } }
  return heuristicFunderNames(list);
}

const GENERIC_TITLE = /^(csi|corporate social (investment|responsibility)|social investment|sustainability|foundation|our foundation|community|home|about( us)?|case study|\[case study\].*|news|press release|careers|contact( us)?)\b/i;
const BRAND_CASE = { bp: 'BP', jse: 'JSE', sab: 'SAB', fnb: 'FNB', absa: 'Absa', mtn: 'MTN', sasol: 'Sasol', anglo: 'Anglo American', nedbank: 'Nedbank', standardbank: 'Standard Bank', investec: 'Investec', vodacom: 'Vodacom', telkom: 'Telkom', shoprite: 'Shoprite', woolworths: 'Woolworths', eskom: 'Eskom', transnet: 'Transnet', exxaro: 'Exxaro', sibanye: 'Sibanye-Stillwater', implats: 'Implats', harmony: 'Harmony Gold', goldfields: 'Gold Fields', kumba: 'Kumba Iron Ore', discovery: 'Discovery', sanlam: 'Sanlam', oldmutual: 'Old Mutual', liberty: 'Liberty', momentum: 'Momentum', capitec: 'Capitec', remgro: 'Remgro', naspers: 'Naspers', bidvest: 'Bidvest', imperial: 'Imperial', motus: 'Motus', datatec: 'Datatec', dimensiondata: 'Dimension Data', multichoice: 'MultiChoice', tigerbrands: 'Tiger Brands', pnp: 'Pick n Pay', picknpay: 'Pick n Pay', clicks: 'Clicks', distell: 'Distell', mediclinic: 'Mediclinic', netcare: 'Netcare', aspen: 'Aspen', barloworld: 'Barloworld', murrob: 'Murray & Roberts', wbho: 'WBHO', ppc: 'PPC', afrimat: 'Afrimat', growthpoint: 'Growthpoint', redefine: 'Redefine', omnia: 'Omnia', afgri: 'AFGRI', tongaat: 'Tongaat Hulett', illovo: 'Illovo', rcl: 'RCL Foods', astral: 'Astral Foods', pioneer: 'Pioneer Foods', famousbrands: 'Famous Brands', spur: 'Spur', nandos: "Nando's", mrprice: 'Mr Price', tfg: 'TFG', truworths: 'Truworths', pepkor: 'Pepkor', massmart: 'Massmart', makro: 'Makro', game: 'Game', cashbuild: 'Cashbuild', italtile: 'Italtile', lewis: 'Lewis', hollard: 'Hollard', santam: 'Santam', outsurance: 'OUTsurance', rmb: 'RMB', rmi: 'Rand Merchant Investment', psg: 'PSG', coronation: 'Coronation', allangray: 'Allan Gray', ninetyone: 'Ninety One', sygnia: 'Sygnia', alexforbes: 'Alexforbes', adcorp: 'Adcorp', altron: 'Altron', eoh: 'EOH', adapt: 'Adapt IT', cartrack: 'Cartrack', blueLabel: 'Blue Label', cellc: 'Cell C', rain: 'rain', liquid: 'Liquid Intelligent Technologies', seacom: 'Seacom', tsogo: 'Tsogo Sun', sun: 'Sun International', cityLodge: 'City Lodge', comair: 'Comair', saa: 'SAA', acsa: 'ACSA', sanral: 'SANRAL', prasa: 'PRASA', denel: 'Denel', armscor: 'Armscor', idc: 'IDC', dbsa: 'DBSA', landbank: 'Land Bank', nef: 'NEF', sefa: 'SEFA', nyda: 'NYDA', seda: 'SEDA', tia: 'TIA', bolt: 'Bolt', uber: 'Uber', amazon: 'Amazon', microsoft: 'Microsoft', ibm: 'IBM', oracle: 'Oracle', sap: 'SAP', cisco: 'Cisco', dell: 'Dell', hp: 'HP', lenovo: 'Lenovo', samsung: 'Samsung', huawei: 'Huawei', totalenergies: 'TotalEnergies', engen: 'Engen', shell: 'Shell', caltex: 'Caltex', astron: 'Astron Energy', glencore: 'Glencore', southn32: 'South32', south32: 'South32', arm: 'African Rainbow Minerals', assore: 'Assore', northam: 'Northam Platinum', royalbafokeng: 'Royal Bafokeng', amplats: 'Anglo American Platinum', angloplat: 'Anglo American Platinum', debeers: 'De Beers', petra: 'Petra Diamonds', seriti: 'Seriti', thungela: 'Thungela', coal: 'Coal' };
/** A card needs the organisation's proper name, never the page title ("CSI", "Corporate Social Investment"). */
function orgNameFor(title, domain) {
  const core = String(domain || '').split('.')[0].toLowerCase();
  const parts = String(title || '').split(/\s[|–—-]\s|:\s/).map(t => t.replace(/\b(home|official site|welcome to)\b/ig, '').trim()).filter(Boolean);
  const brand = BRAND_CASE[core] || BRAND_CASE[core.replace(/[^a-z0-9]/g, '')];
  const fromTitle = parts.find(t => t.length <= 60 && !GENERIC_TITLE.test(t) && !/^https?:/i.test(t) && (core.length < 4 || t.toLowerCase().replace(/[^a-z0-9]/g, '').includes(core) || core.includes(t.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6))));
  if (brand && (!fromTitle || GENERIC_TITLE.test(fromTitle))) return brand;
  if (fromTitle) return fromTitle;
  if (brand) return brand;
  const first = parts[0] || '';
  if (first && !GENERIC_TITLE.test(first) && first.length <= 60) return first;
  return core.length <= 4 ? core.toUpperCase() : core.charAt(0).toUpperCase() + core.slice(1);
}

/** One AI call classifies a batch of search hits: publisher vs organisation's own site, with the proper organisation name. */
const CLASSIFY_PROMPTS = {
  ngo: 'You classify web search results for a South African tool that finds NGOs, NPOs, trusts and foundations that run or fund programmes in public schools (infrastructure, literacy, feeding, sanitation, ICT). For each item decide: kind = "org" if the page is on such a non-profit\'s OWN website; "publisher" for news, magazines, blogs, directories, job boards, aggregators, search/AI tools, social networks; "public" for government, universities, schools themselves, and for-profit companies. Give the organisation\'s proper name for "org" items. Return JSON {"items":[{"i":0,"kind":"org|publisher|public","name":"..."}]} covering every item.',
  sme: 'You classify web search results for a South African tool that finds small and medium businesses offering building, plumbing, electrical, fencing, furniture, ICT, kitchen and similar trades to schools. For each item decide: kind = "org" if the page is a trade business\'s OWN website (a company that does the work); "publisher" for news, blogs, directories (Yellow Pages, Brabys, Snupit), job boards, marketplaces, social networks, search/AI tools; "public" for government, schools, universities, NGOs, and large listed groups. Give the business\'s proper name for "org" items. Return JSON {"items":[{"i":0,"kind":"org|publisher|public","name":"..."}]} covering every item.'
};
async function aiClassifyHits(hits, aiConfig, fetchImpl = globalThis.fetch, profile = 'funder') {
  const items = hits.map((h, i) => ({ i, url: h.url, title: clamp(h.title, 120), snippet: scrubPiiForAi(clamp(h.snippet, 240)).scrubbedText }));
  const system = CLASSIFY_PROMPTS[profile] || 'You classify web search results for a South African corporate-giving (CSI) prospecting tool. For each item decide: kind = "org" if the page is on a company\'s, corporate foundation\'s or trust\'s OWN website (a potential funder); "publisher" for news, magazines, research hubs, blogs, directories, job boards, aggregators, search/AI tools, social networks; "public" for government, universities, schools, NGOs (recipients, not funders). Give the organisation\'s proper name for "org" items (e.g. bp.com → "BP Southern Africa", jse.co.za → "JSE"), never a page title like "Corporate Social Investment". Return JSON {"items":[{"i":0,"kind":"org|publisher|public","name":"..."}]} covering every item.';
  const res = await fetchImpl(aiConfig.endpoint, { method: 'POST', headers: { Authorization: `Bearer ${aiConfig.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: aiConfig.model, temperature: 0, max_tokens: 900, messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify({ items }) }] }), signal: AbortSignal.timeout(30000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message || `AI provider request failed (${res.status}).`);
  const content = String(json.choices?.[0]?.message?.content || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let parsed; try { parsed = JSON.parse(content); } catch { const s = content.indexOf('{'), e = content.lastIndexOf('}'); parsed = s >= 0 && e > s ? JSON.parse(content.slice(s, e + 1)) : { items: [] }; }
  const out = new Map();
  for (const it of (Array.isArray(parsed.items) ? parsed.items : [])) { const i = Number(it.i); if (!Number.isInteger(i) || !hits[i]) continue; out.set(i, { kind: ['org', 'publisher', 'public'].includes(it.kind) ? it.kind : 'publisher', name: clamp(it.name, 80) }); }
  return out;
}
/** Classify hits → [{...hit, kind, name}]. AI judgement first (lists miss things), list-based fallback; our own tool domains always dropped. */
async function classifyHits(hits, { aiConfig, fetchImpl, profile = 'funder' } = {}) {
  let ai = new Map();
  if (aiConfig?.apiKey && hits.length) { try { ai = await aiClassifyHits(hits, aiConfig, fetchImpl, profile); } catch { ai = new Map(); } }
  return hits.map((h, i) => {
    const host = hostOf(h.url); const domain = registrable(host); const byList = classifyHost(host);
    const a = ai.get(i);
    let kind;
    if (TOOL_HOSTS.test(host) || byList === 'social') kind = 'publisher';
    else if (a) kind = a.kind === 'org' && ['government', 'academic'].includes(byList) ? 'public' : a.kind === 'org' && byList === 'media' ? 'publisher' : a.kind;
    else kind = byList === 'company' ? (PATH_HINTS.test(String(h.url).replace(/^https?:\/\/[^/]+/, '')) ? 'publisher' : 'org') : byList === 'media' ? 'publisher' : byList === 'directory' ? 'publisher' : 'public';
    const name = kind === 'org' ? (a?.name && !GENERIC_TITLE.test(a.name) ? a.name : orgNameFor(h.title, domain)) : '';
    return { ...h, host, domain, kind, listKind: byList, name, aiClassified: Boolean(a) };
  });
}

/** Does this search hit look like the organisation's own site? Name tokens must appear in the domain or title. */
function looksLikeOfficialSite(name, hit) {
  const host = hostOf(hit.url); if (!host || classifyHost(host) !== 'company') return false;
  const tokens = String(name).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !/^(the|group|holdings|limited|ltd|pty|foundation|trust|south|africa|african|sa)$/.test(w));
  if (!tokens.length) return false;
  const core = registrable(host).split('.')[0];
  const title = String(hit.title || '').toLowerCase();
  return tokens.some(t => core.includes(t)) || tokens.every(t => title.includes(t)) || core.includes(tokens.join(''));
}

module.exports = { orgNameFor, classifyHits, aiClassifyHits, FRESH_MONTHS, classifyHost, isPublisherUrl, outletName, articleDate, isFresh, whenPhrase, givingFacts, heuristicGivingFacts, funderNamesFromArticles, heuristicFunderNames, looksLikeOfficialSite, hostOf, registrable };
