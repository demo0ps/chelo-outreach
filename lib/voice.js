'use strict';
// v57 — one Chelo voice, many ways in.
// Every email (and the PDF cover) opens with one of five strategies, rotated per funder so no two emails to the
// same person start the same way, and no two funders written on the same day read like carbon copies.
// Works for both the AI path (as a writing brief) and the template fallback (as actual sentences).

const OPENINGS = ['figure', 'question', 'priority', 'story', 'ask'];
const OPENING_LABEL = { figure: 'Start with a number', question: 'Start with a question', priority: 'Start with their stated priority', story: 'Start with one beneficiary', ask: 'Start with the ask' };

// Word targets before links and signature. Step 1 explains; later steps get shorter on purpose.
const LENGTH = { 1: [95, 140], 2: [55, 90], 3: [30, 55], 4: [40, 65] };
const SIGN_OFFS = ['Kind regards', 'Warm regards', 'With thanks', 'Best wishes', 'Regards', 'Thank you'];

function hash(str) { let h = 2166136261; for (const ch of String(str || '')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; }
function firstName(name) { const n = String(name || '').trim().split(/\s+/)[0]; return n || 'there'; }
function cleanCompany(name) { return String(name || '').replace(/\s·\sDemo$/, '').trim() || 'your organisation'; }
function trimDot(t) { return String(t || '').trim().replace(/[.\s]+$/, ''); }
const VERB_START = /^(invests?|spends?|spent|reach(es|ed)?|funds?|funded|supports?|supported|commits?|committed|runs?|ran|operates?|focus(es|ed)?|prioritis(es|ed)|allocat(es|ed)|donat(es|ed)|partners?|partnered|backs?|backed|targets?|aims?|gives?|gave|awards?|awarded|sponsors?|sponsored|builds?|built|trains?|trained|places?|placed)\b/i;
/** Research facts are often fragments ("Invests 1% of NPAT…"); give them a subject so they read as sentences. */
function asSentence(fact, company) {
  const f = trimDot(fact); if (!f) return '';
  if (VERB_START.test(f) && !new RegExp(company.split(' ')[0], 'i').test(f)) return `${company} ${f.charAt(0).toLowerCase()}${f.slice(1)}`;
  return f.charAt(0).toUpperCase() + f.slice(1);
}
function fmtZar(n) { const v = Number(n || 0); return v >= 1e6 ? `R${(v / 1e6).toFixed(v % 1e6 ? 1 : 0)} million` : v >= 1e3 ? `R${Math.round(v / 1e3)} 000`.replace(/(\d)(?=(\d{3})+ 000$)/g, '$1 ') : `R${v}`; }

/** Pick the opening for this funder + step, skipping anything already used on them. Rewrite → next unused. */
function pickOpening(lead, step = 1, { exclude = [] } = {}) {
  const used = new Set([...(lead?.voice?.used || []), ...exclude].map(String));
  const start = hash(`${lead?.id || lead?.company || ''}:${step}`) % OPENINGS.length;
  for (let i = 0; i < OPENINGS.length; i += 1) { const s = OPENINGS[(start + i) % OPENINGS.length]; if (!used.has(s)) return s; }
  return OPENINGS[(start + step) % OPENINGS.length]; // all five used (long sequences): rotate anyway
}
function remember(lead, strategy) {
  const used = [...(lead?.voice?.used || []).filter(s => s !== strategy), strategy].slice(-OPENINGS.length);
  return { ...(lead?.voice || {}), used, last: strategy, lastAt: new Date().toISOString() };
}

/** Choose the research fact that suits the strategy: numbers for 'figure', priority words for 'priority', else the first. */
function angleFrom(facts = [], strategy = 'priority') {
  const list = facts.map(f => (typeof f === 'string' ? f : f?.text || f?.fact || f?.point || '')).filter(Boolean);
  if (!list.length) return '';
  const byNumber = list.find(f => /\b\d[\d\s,.]*(%|\s?(million|billion|learners|schools|people|youth|bursaries|rand)|\b)/i.test(f) && /\d/.test(f));
  const byPriority = list.find(f => /(priorit|focus|commit|invest|strateg|pillar|theme|aim|goal)/i.test(f));
  if (strategy === 'figure') return byNumber || list[0];
  if (strategy === 'priority') return byPriority || list[0];
  if (strategy === 'story') return list.find(f => /(learner|school|communit|youth|student|children)/i.test(f)) || list[0];
  return list[hash(list.join('|') + strategy) % list.length];
}

function lengthFor(step) { return LENGTH[Math.min(Math.max(Number(step) || 1, 1), 4)]; }
function signOffFor(lead, step) { return SIGN_OFFS[hash(`${lead?.id || ''}:${step}:signoff`) % SIGN_OFFS.length]; }

/** Opening paragraph for the template fallback (no AI). Short, plain, in Chelo's voice. */
function openingLine({ strategy, lead, project, fact = '', amount = 0 }) {
  const company = cleanCompany(lead?.company);
  const projectName = project?.name || lead?.project || 'a verified school project';
  const place = project?.recipientName ? ` at ${project.recipientName}` : '';
  const focus = lead?.sector ? `${/education/i.test(lead.sector) ? lead.sector : `${lead.sector} CSI`}` : 'community investment';
  const learners = Number(project?.beneficiaries || project?.learners || 0);
  switch (strategy) {
    case 'figure': {
      if (fact && /\d/.test(fact)) return `${asSentence(fact, company)}. That number is why I'm writing.`;
      return amount ? `${fmtZar(amount)} is what it takes to deliver ${projectName}${place}. That number is why I'm writing to ${company}.` : `${learners || 'Hundreds of'} learners${place} are waiting on ${projectName}. They are why I'm writing to ${company}.`;
    }
    case 'question':
      return `What would it take for ${company}'s next ${focus} report to name the school every rand reached?${fact ? ` ${asSentence(fact, company)} — so this is not a cold ask.` : ` That is the question behind ${projectName}.`}`;
    case 'priority':
      return fact ? `${asSentence(fact, company)} — ${projectName}${place} sits squarely inside that.` : `${company}'s commitment to ${focus} is the reason ${projectName}${place} belongs on your desk.`;
    case 'story':
      return `${project?.recipientName ? `At ${project.recipientName}, ` : 'At the school behind this, '}the need is concrete: ${projectName.toLowerCase().replace(/^the /, '')}. ${fact ? `${asSentence(fact, company)}. ` : ''}It is the kind of change ${company} can put its name to.`;
    case 'ask':
    default:
      return `I'd like ${company} to consider backing ${projectName}${place}${amount ? ` — ${fmtZar(amount)}, fully traceable` : ''}. ${fact ? `${asSentence(fact, company)}, so the fit looks real.` : 'Here is why it fits.'}`;
  }
}

/** Instruction block appended to the AI system prompt. */
function aiBrief({ strategy, step = 1, lead, fact = '', signOff }) {
  const [min, max] = lengthFor(step);
  const how = {
    figure: 'Open with one concrete number (from the supplied research fact, the contribution amount, or the project) and say in one sentence why it matters to this funder.',
    question: 'Open with one genuine, specific question about the funder’s own CSI/community-investment goals; then answer it with the project.',
    priority: 'Open by naming the funder’s own stated priority (quote or paraphrase the supplied fact) and show the project sits inside it.',
    story: 'Open with one specific beneficiary or place (the verified recipient) and what changes for them; one or two sentences, no sentimentality.',
    ask: 'Open with the ask itself in the first sentence — plain, respectful, no preamble — then give the one reason it fits.'
  }[strategy] || '';
  return [
    `WRITING BRIEF (step ${step}). ${how}`,
    fact ? `Anchor the angle on this approved research fact: "${trimDot(fact)}".` : 'No approved research fact: anchor on the project and sector instead; do not invent facts about the funder.',
    `Length: ${min}–${max} words before URLs and signature. Vary sentence length; no bullet lists; no "I hope this finds you well"; no "I am reaching out".`,
    `Sign off with "${signOff}".`,
    'Do not reuse the structure of a generic funding email; the opening sentence must follow the brief above.'
  ].join(' ');
}

// --- Anti-sameness: compare against recently sent emails ------------------------------------------------------
function normalise(text) { return String(text || '').toLowerCase().replace(/https?:\/\/\S+/g, ' ').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim(); }
function shingles(text, n = 3) { const w = normalise(text).split(' ').filter(Boolean); const out = new Set(); for (let i = 0; i + n <= w.length; i += 1) out.add(w.slice(i, i + n).join(' ')); return out; }
function similarity(a, b) {
  const A = shingles(a), B = shingles(b); if (!A.size || !B.size) return 0;
  let inter = 0; for (const s of A) if (B.has(s)) inter += 1;
  return inter / Math.min(A.size, B.size);
}
/** Strip boilerplate every email legitimately shares (links, opt-out, meeting lines) before comparing. */
function stripBoilerplate(body) {
  return String(body || '').split(/\r?\n/).filter(line => !/https?:\/\//.test(line) && !/opt out|no preparation|introductory video|confirm it personally|cheloapp\.com/i.test(line)).slice(0, 6).join('\n');
}
function tooSimilar(body, recentBodies = [], threshold = 0.5) {
  const mine = stripBoilerplate(body);
  let worst = 0;
  for (const other of recentBodies) worst = Math.max(worst, similarity(mine, stripBoilerplate(other)));
  return { tooSimilar: worst >= threshold, score: Math.round(worst * 100) / 100 };
}

module.exports = { asSentence, OPENINGS, OPENING_LABEL, pickOpening, remember, angleFrom, lengthFor, signOffFor, openingLine, aiBrief, similarity, tooSimilar, stripBoilerplate };
