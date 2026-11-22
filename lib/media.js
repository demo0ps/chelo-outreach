'use strict';
// Four Desks — Release 2 (v61): the Marketing desk. Media targets (kind = 'media') ride the same engine as funders:
// discovery → "what you covered" homework (a research brief in the funder-brief shape) → pitch draft → send → follow-ups.
// Two pitch tracks: 'pr' (cover a story) and 'partnership' (a media partnership). Every pitch is built from the APPROVED
// media kit only. Pure logic except discoverOutlets/coverageBrief, which take the search + fetch helpers as arguments.
const crypto = require('node:crypto');
const news = require('./news-intel');
const { OPT_OUT_FOOTER } = require('./conversion');

const TRACKS = {
  pr: { id: 'pr', label: 'PR pitch', title: 'Story pitch', goal: 'Get a story about a verified Chelo project covered.', outcome: 'published' },
  partnership: { id: 'partnership', label: 'Partnership pitch', title: 'Media partnership', goal: 'Agree an ongoing partnership: a column, a series, co-branded coverage of verified projects.', outcome: 'signed' }
};
const OUTCOMES = ['booked', 'published', 'signed']; // booked = call/interview booked; published = story ran; signed = partnership agreed
const FOLLOW_UP_OFFSETS = [0, 4, 6]; // journalists get two short follow-ups, not three

/** v67: a starter kit written from Chelo's own positioning, so the Marketing desk is one "Save & approve" from pitching. Every fact is from the product or the public site; edit anything that is out of date. */
function starterKit({ spokesperson = '', spokespersonTitle = 'Founder', pressEmail = '' } = {}) {
  return {
    ...EMPTY_KIT,
    boilerplate: 'Chelo is a South African platform that turns corporate social investment into verified school projects. A school tells Chelo what it needs — toilets, water, classrooms, electricity, computers. Chelo confirms the need, gets quotes from vetted suppliers and matches the project with a company that funds it. The company pays the supplier directly against milestones the school confirms, and every project carries its own proof: verified recipient, traceable transactions, impact report. The school gets the thing, not a promise.',
    facts: [
      'Three guarantees on every Chelo project: Verified Recipients, Traceable Transactions, Impact Reports.',
      'No money passes through the school or through Chelo: the funder pays the vetted supplier directly, in stages, after the principal confirms each stage is done.',
      'Chelo works from the Department of Basic Education master list of about 25 500 open public schools (Q2 2025), district by district, starting with a 15-minute call with the principal.',
      'Suppliers register by trade and province, are vetted by Chelo, and quote on each need through a hosted quote form; the school and the funder see the shortlist.',
      'Proof point: e-learning screens at Motse School, delivered in partnership with Chelo and Bolt.',
      'Funders receive a project page per school with the picture, the numbers and the sign-off — usable for CSI board reporting and B-BBEE socio-economic development verification.'
    ],
    spokesperson, spokespersonTitle, pressEmail,
    assetsUrl: 'https://cheloapp.com',
    status: 'draft', starter: true
  };
}
const EMPTY_KIT = { boilerplate: '', facts: [], spokesperson: '', spokespersonTitle: '', pressEmail: '', assetsUrl: '', status: 'draft', updatedAt: '', updatedBy: '', approvedAt: '', approvedBy: '' };

function clamp(text, max) { const t = String(text || '').replace(/\s+/g, ' ').trim(); return t.length > max ? `${t.slice(0, max - 1).trim()}…` : t; }
function firstName(name) { const n = String(name || '').trim().split(/\s+/)[0]; return n && !/desk|team|editor|news/i.test(n) ? n : 'there'; }
function trackOf(lead) { return TRACKS[lead?.pitchTrack] ? lead.pitchTrack : 'pr'; }

// ---------- media kit ----------
function cleanKit(input = {}, previous = EMPTY_KIT) {
  const facts = [].concat(input.facts ?? previous.facts ?? []).map(f => clamp(f, 200)).filter(Boolean).slice(0, 8);
  return {
    ...previous,
    boilerplate: clamp(input.boilerplate ?? previous.boilerplate, 600),
    facts,
    spokesperson: clamp(input.spokesperson ?? previous.spokesperson, 80),
    spokespersonTitle: clamp(input.spokespersonTitle ?? previous.spokespersonTitle, 80),
    pressEmail: String(input.pressEmail ?? previous.pressEmail ?? '').trim().toLowerCase().slice(0, 120),
    assetsUrl: String(input.assetsUrl ?? previous.assetsUrl ?? '').trim().slice(0, 300)
  };
}
function kitIsApproved(kit) { return Boolean(kit && kit.status === 'approved' && kit.boilerplate); }
/** Only an approved kit reaches a pitch. A draft kit → pitches are blocked with a clear reason. */
function kitBlockReason(kit) {
  if (!kit || !kit.boilerplate) return 'Write the media kit first (Settings → Media kit): one paragraph about Chelo plus the facts journalists may quote.';
  if (kit.status !== 'approved') return 'The media kit is waiting for approval. An administrator approves it under Settings → Media kit.';
  return '';
}

// ---------- "what you covered" homework ----------
function coverageQueries(outlet, domain, projects = []) {
  const name = `"${outlet}"`;
  const site = domain ? ` site:${domain}` : '';
  const themes = ['school', 'education learners', 'corporate social investment CSI', 'community project'];
  const qs = themes.map(t => `${t}${site || ` ${name}`}`);
  const prov = [...new Set(projects.map(p => p.province).filter(Boolean))].slice(0, 2);
  for (const p of prov) qs.push(`${p} school${site || ` ${name}`}`);
  return qs.slice(0, 6);
}
/**
 * Build the Marketing-desk brief: recent (≤12 months) pieces this outlet ran on schools / education / CSI.
 * Same shape as a funder brief so the review tick-boxes, approval and drafting all reuse the existing path.
 */
async function coverageBrief({ outlet, website, domain, knownArticles = [] }, { runSearch, fetchPublicText, searchConfig, aiConfig, fetchImpl, projects = [], maxArticles = 8 } = {}) {
  const name = clamp(outlet, 120);
  if (!name) throw new Error('An outlet name is required.');
  const dom = domain || news.registrable(news.hostOf(website || ''));
  const warnings = [];
  let hits = [];
  if (runSearch && searchConfig?.apiKey) {
    const tasks = coverageQueries(name, dom, projects).map(q => runSearch(searchConfig, q).catch(err => { warnings.push(`Search skipped: ${err.message}`); return []; }));
    hits = (await Promise.all(tasks)).flat();
  } else warnings.push('No web-search provider configured: only the articles found at discovery were used.');
  hits = [...knownArticles.filter(a => a && a.url).map(a => ({ url: a.url, title: a.title || '', snippet: '' })), ...hits];
  const seen = new Set();
  hits = hits.filter(h => { const host = news.hostOf(h.url); if (!host || (dom && news.registrable(host) !== dom)) return false; const k = h.url.replace(/[#?].*$/, ''); if (seen.has(k)) return false; seen.add(k); return true; });

  const articles = [];
  for (const hit of hits.slice(0, maxArticles * 2)) {
    if (articles.length >= maxArticles) break;
    let publishedAt = news.articleDate({ url: hit.url }); let title = hit.title; let text = hit.snippet || '';
    if (fetchPublicText) {
      try { const page = await fetchPublicText(hit.url, { includeHtml: true, timeoutMs: 8000 }); title = page.title || title; text = page.text || text; publishedAt = news.articleDate({ url: hit.url, html: page.html, text: page.text }) || publishedAt; }
      catch { /* snippet only */ }
    }
    if (!title) continue;
    articles.push({ url: hit.url, title: clamp(title, 160), outlet: news.outletName(hit.url) || name, publishedAt: publishedAt || '', fresh: news.isFresh(publishedAt), summary: clamp(text, 220) });
  }
  const fresh = articles.filter(a => a.fresh);
  const stamp = id => `${id}-${crypto.randomBytes(3).toString('hex')}`;
  const findings = fresh.slice(0, 6).map((a, i) => ({ id: stamp(`f${i + 1}`), kind: 'coverage', text: `${name} ran "${a.title}"${a.publishedAt ? ` (${a.publishedAt.slice(0, 7)})` : ''}.`, when: news.whenPhrase ? news.whenPhrase(a.publishedAt) : '', sourceUrl: a.url, sourceTitle: a.title, publishedAt: a.publishedAt, fresh: true, confidence: 'high', themes: ['coverage'] }));
  const beats = [...new Set(fresh.flatMap(a => /school|learner|teacher|classroom/i.test(`${a.title} ${a.summary}`) ? ['schools'] : []).concat(fresh.flatMap(a => /csi|social investment|foundation|donat/i.test(`${a.title} ${a.summary}`) ? ['CSI'] : [])))];
  const alignmentPoints = fresh.length ? [{ id: stamp('a1'), text: `${name} has covered ${beats.length ? beats.join(' and ') : 'education'} stories in the last 12 months, so a verified-project story fits their beat.`, sourceUrl: fresh[0].url }] : [];
  if (!fresh.length) warnings.push(articles.length ? 'Every piece found is older than 12 months — not used in pitches.' : 'No recent education or CSI pieces found on this outlet. Pitch without "what you covered" or add an article under Edit details.');
  const generatedAt = new Date().toISOString();
  return {
    id: `brief-${crypto.randomBytes(6).toString('hex')}`, company: name, website: website || (dom ? `https://${dom}` : ''), sector: 'Media', kind: 'coverage',
    generatedAt, expiresAt: new Date(Date.now() + 45 * 86400000).toISOString(), provider: searchConfig?.provider || 'known-articles', mode: 'local', status: 'pending-review',
    missionSummary: fresh.length ? `${name}: ${fresh.length} recent piece${fresh.length === 1 ? '' : 's'} on ${beats.length ? beats.join(' / ') : 'education'}.` : '',
    focusAreas: beats, suggestedProjectId: null,
    findings, articles, contacts: [], alignmentPoints,
    sources: articles.slice(0, 5).map(a => ({ url: a.url, title: a.title, official: true })),
    attempted: articles.map(a => ({ url: a.url, status: 'read' })), redactions: { emails: 0, phones: 0, saIds: 0, total: 0 }, warnings,
    approvedFindingIds: [], approvedAlignmentIds: [], approvedContactIds: []
  };
}
/** Approved "what you covered" lines for the pitch (ticked, fresh only). */
function approvedCoverage(brief) {
  if (!brief || brief.status !== 'approved') return [];
  return (brief.findings || []).filter(f => f.kind === 'coverage' && f.fresh && (brief.approvedFindingIds || []).includes(f.id)).map(f => ({ title: f.sourceTitle || f.text, url: f.sourceUrl, when: f.when || (f.publishedAt ? f.publishedAt.slice(0, 7) : '') })).slice(0, 2);
}

// ---------- outlet discovery (Marketing desk) ----------
async function discoverOutlets(searchConfig, query, { runSearch, aiConfig, fetchImpl, limit = 12 } = {}) {
  const q = clamp(query, 200);
  if (!q) return { organisations: [], warnings: ['Enter a search such as "education news South Africa" or "Gauteng community newspapers".'] };
  const warnings = [];
  const variants = [`${q} South Africa news`, `${q} South Africa education news site`, `${q} newspaper magazine South Africa`, `${q} school story South Africa`];
  let results = [];
  for (const v of variants) { try { results = results.concat(await runSearch(searchConfig, v)); } catch (err) { warnings.push(err.message); } }
  const classified = await news.classifyHits(results, { aiConfig, fetchImpl });
  const outlets = new Map();
  for (const r of classified) {
    if (!r.domain) continue;
    const isMedia = r.kind === 'publisher' && (r.listKind === 'media' || (r.aiClassified && r.listKind === 'company')); // never directories, social, job boards or a company's own news page
    if (!isMedia) continue;
    const e = outlets.get(r.domain) || { name: news.outletName(r.url) || r.name || r.domain, domain: r.domain, website: `https://${r.host}`, summary: '', sources: [], articles: [], score: 0, via: 'media' };
    const date = news.articleDate({ url: r.url });
    e.articles.push({ url: r.url, title: clamp(r.title, 160), outlet: e.name, publishedAt: date || '' });
    e.sources.push(r.url);
    e.score += 1 + (/school|learner|education|csi/i.test(`${r.title} ${r.snippet}`) ? 1 : 0) + (news.isFresh(date) ? 1 : 0);
    if (!e.summary) e.summary = clamp(r.snippet, 200);
    outlets.set(r.domain, e);
  }
  const organisations = [...outlets.values()].sort((a, b) => b.score - a.score).slice(0, limit)
    .map(o => ({ name: o.name, domain: o.domain, website: o.website, summary: o.summary, sources: o.sources.slice(0, 3), articles: o.articles.slice(0, 4), score: o.score, via: 'media', unresolved: false, kind: 'media' }));
  if (!organisations.length) warnings.push('No outlets found. Try a beat ("education news"), a region ("Limpopo community newspaper") or a format ("radio station").');
  return { organisations, warnings };
}

// ---------- pitch drafting ----------
/**
 * Deterministic pitch for step n (1 = first email, 2–3 = follow-ups in thread). Uses ONLY the approved kit + approved coverage.
 * links: { booking, optOut }. staff: { name, phone }. project: the Verified Project that is the story (optional for partnership).
 */
function pitchStep({ step = 1, lead, project, kit, coverage = [], links = {}, staff = {}, slots = [] }) {
  const track = trackOf(lead);
  const name = firstName(lead?.contactName);
  const outlet = clamp(lead?.company, 80).replace(/\s·\sDemo$/, '');
  const signature = `Kind regards,\n${staff.name || 'Chelo Communications'}\nChelo · cheloapp.com${staff.phone ? ` · ${staff.phone}` : ''}`;
  const optOut = links.optOut ? `\n\n${OPT_OUT_FOOTER}${links.optOut}` : '';
  const covered = coverage[0] ? `I read your piece "${coverage[0].title}"${coverage[0].when ? ` ${coverage[0].when}` : ''}, so I know this is a beat you take seriously. ` : '';
  const fact = (kit?.facts || [])[0] || '';
  const spokes = kit?.spokesperson ? `${kit.spokesperson}${kit.spokespersonTitle ? `, ${kit.spokespersonTitle}` : ''}` : 'a Chelo spokesperson';
  const assets = kit?.assetsUrl ? `Photos, logos and a one-page backgrounder are here: ${kit.assetsUrl}` : '';
  const call = links.booking ? `If it helps, pick a 15-minute call: ${links.booking}` : '';
  const story = project ? `${project.name}${project.province ? ` in ${project.province}` : ''}${project.recipientName ? ` (${project.recipientName})` : ''}` : 'a verified school project';
  const outcome = project?.outcomes?.[0] || project?.summary || '';
  if (step === 1) {
    if (track === 'partnership') {
      return {
        subject: `${outlet} × Chelo — a media partnership on verified school projects`,
        body: `Hi ${name},\n\n${covered}I would like to propose a partnership between ${outlet} and Chelo.\n\n${kit?.boilerplate || ''}\n\nThe idea: ${outlet} follows real school projects from need to hand-over — one story per milestone, with the quotes, photos and sign-offs behind each step. Your readers see where the money goes; the schools get a voice; the funders get credit.${fact ? ` ${fact}` : ''}\n\nWe can start small: one project, three pieces, then decide together.\n\nWould a 15-minute call to shape this be useful? ${call}\n\n${signature}${optOut}`.replace(/\n{3,}/g, '\n\n')
      };
    }
    return {
      subject: `Story idea: ${story}`,
      body: `Hi ${name},\n\n${covered}A story you might want: ${story}.${outcome ? ` ${outcome}` : ''}\n\nWhy it holds up: Chelo verified the school's need, checked the supplier quotes and signs off every milestone, so every number in the piece is traceable to a document.${fact ? ` ${fact}` : ''}\n\n${spokes} is available for an interview, and the school is happy to host a visit.${assets ? ` ${assets}` : ''}\n\n${kit?.boilerplate || ''}\n\nWould this work for you? ${call}\n\n${signature}${optOut}`.replace(/\n{3,}/g, '\n\n')
    };
  }
  if (step === 2) {
    return { subject: 'Re: {subject}', body: `Hi ${name},\n\nA quick follow-up in case the earlier note slipped by.${track === 'partnership' ? ` Happy to send a one-page outline of how the partnership would run for ${outlet}.` : ` ${spokes} can speak this week and there are photos ready to go${project?.province ? ` from ${project.province}` : ''}.`}\n\nIf it is not for you, a one-line "no" is completely fine and I will not write again.\n\n${signature}${optOut}` };
  }
  return { subject: 'Re: {subject}', body: `Hi ${name},\n\nI will close this thread here so it does not clutter your inbox. If a ${track === 'partnership' ? 'partnership' : 'verified-project story'} becomes useful later, I am one email away${call ? ` — ${call.replace(/^If it helps, /, '')}` : ''}.\n\n${signature}${optOut}` };
}

// ---------- outcomes ----------
function applyOutcome(lead, outcome, { on = true, at = new Date().toISOString(), actor = 'staff' } = {}) {
  if (!OUTCOMES.includes(outcome)) throw new Error(`Outcome must be one of ${OUTCOMES.join(', ')}.`);
  lead.outcomes = { ...(lead.outcomes || {}) };
  if (on) lead.outcomes[outcome] = { at, by: actor }; else delete lead.outcomes[outcome];
  const won = TRACKS[trackOf(lead)].outcome;
  if (on && outcome === won) lead.stage = 'Won', lead.wonAt = lead.wonAt || at;
  else if (on && outcome === 'booked' && ['New', 'Researched', 'Contacted'].includes(lead.stage)) lead.stage = 'Interested';
  return lead.outcomes;
}

module.exports = { TRACKS, OUTCOMES, FOLLOW_UP_OFFSETS, EMPTY_KIT, starterKit, trackOf, cleanKit, kitIsApproved, kitBlockReason, coverageQueries, coverageBrief, approvedCoverage, discoverOutlets, pitchStep, applyOutcome };
