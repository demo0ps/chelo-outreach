'use strict';
// Conversion layer (Batch 7): CTA ladder copy, end-state picture, hosted partnership page model,
// proposed meeting slots, and the persuasion guardrail (ethics linter). Pure functions — no I/O.
//
// Evidence behind the design (see docs/idea-bank.md §I): interest-based first ask (12% vs 7% reply, 68% vs 41% positive),
// one soft CTA per email, 50–125 words, ask in the last sentence; "identified intervention" — one concrete, place-named,
// dated outcome beats statistics; funder is the grammatical hero.

const CHELO_FACTS = { donatedZar: 'R7m+', donors: '500+', schools: '500+', lives: '500+', trustedBy: ['Bolt', 'SAB Foundation', 'TIA'] }; // cheloapp.com counters + trusted-by, confirmed by user 2026-10-26 (permission to cite partners granted)
const PAGE_TTL_DAYS = 30;
const TEMPLATES = ['classroom', 'construction', 'ict'];

function firstName(name) { const n = String(name || '').trim().split(/\s+/)[0]; return n || 'there'; }
function cleanCompany(name) { return String(name || '').replace(/\s·\sDemo$/, '').trim() || 'your company'; }
function words(text) { return String(text || '').trim().split(/\s+/).filter(Boolean).length; }
function fmtZar(n) { const v = Number(n || 0); return v >= 1e6 ? `R${(v / 1e6).toFixed(v % 1e6 ? 1 : 0)}m` : v >= 1e3 ? `R${Math.round(v / 1e3)}k` : `R${v}`; }

// --- Template selection: 3 generated visuals matched to cheloapp.com project categories -------------------------
function templateFor(project) {
  const text = `${project?.name || ''} ${project?.sector || ''} ${project?.summary || ''}`.toLowerCase();
  if (/\b(solar|digital|ict|computer|lab|stem|e-?learning|tablet|wifi|connectivity|screens?)\b/.test(text)) return 'ict';
  if (/\b(build|construct|sanitation|toilet|water|borehole|roof|renovat|repair|infrastructure|kitchen|fenc|hall|ablution)\b/.test(text)) return 'construction';
  return 'classroom';
}

// --- End-state picture: one concrete, dated, place-named outcome with the funder as hero -------------------------
function termLabel(now = new Date()) {
  const m = now.getMonth();
  const year = now.getFullYear();
  if (m <= 1) return `April ${year}`;
  if (m <= 5) return `the third term of ${year}`;
  if (m <= 8) return `January ${year + 1}`;
  return `the first day of term ${year + 1}`;
}
function pictureFor({ project, lead, now = new Date() }) {
  const company = cleanCompany(lead?.company);
  if (project?.picture) return String(project.picture).replace(/\{\{\s*company\s*\}\}/gi, company).trim();
  if (!project) return `Picture ${termLabel(now)}: a verified school project that ${company} switched on — and every rand traceable on your dashboard.`;
  const place = [project.recipientName, project.province].filter(Boolean).join(', ');
  const metric = (project.verifiedMetrics || [])[0];
  const metricLine = metric && metric.label ? ` — ${String(metric.label).toLowerCase()} from ${metric.baselineValue} to ${metric.currentValue} ${metric.unit || ''}`.replace(/\s+$/, '') : '';
  return `Picture ${termLabel(now)}: ${project.name} at ${place || 'a verified school'}${metricLine}, switched on by ${company} — and a co-branded photo on the wall that shows who made it happen.`;
}

// --- CTA ladder --------------------------------------------------------------------------------------------------
// step 1 interest (no link) → step 2 one-page + meeting (page link) → step 3 two real slots → step 4 graceful close.
function ladderStep({ step, lead, project, links, slots = [], now = new Date(), staff = {}, reason = '' }) {
  const name = firstName(lead?.contactName);
  const company = cleanCompany(lead?.company);
  const focus = lead?.sector ? `${lead.sector.toLowerCase().includes('education') ? lead.sector : `${lead.sector} CSI`}` : 'community investment';
  const projectName = project?.name || lead?.project || 'a verified school project';
  const signature = `${staff.name || 'Chelo Partnerships'}\nChelo · cheloapp.com${staff.phone ? ` · ${staff.phone}` : ''}`;
  const optOut = links?.optOut ? `\n\nTo stop further outreach: ${links.optOut}` : '';
  const picture = pictureFor({ project, lead, now });
  const fy = lead?.financialYearEnd ? ` ${lead.financialYearEnd}` : '';
  if (step === 1) {
    const place = project?.recipientName ? ` at ${project.recipientName}` : '';
    return {
      subject: `${company} + ${projectName}${place}`.slice(0, 78),
      body: `Hi ${name},\n\n${reason ? `${String(reason).trim().replace(/\.$/, '')} — that is why I'm writing.` : `${company}'s work in ${focus} is why I'm writing.`}\n\n${picture}\n\nChelo verified the quotes, pays suppliers directly and signs off each milestone, so your board sees every rand land. You take the credit.\n\nWorth a one-page look?\n\n${signature}${optOut}`
    };
  }
  if (step === 2) {
    return {
      subject: 'Re: {subject}',
      body: `Hi ${name},\n\nHere's the one page: ${links.page}\n\nIt shows ${projectName}, what ${company} would fund, and the impact report you'd receive — the same traceable format partners like ${CHELO_FACTS.trustedBy.join(', ')} get (${CHELO_FACTS.donatedZar} funded this way by ${CHELO_FACTS.donors} donors).\n\nIf it fits your${fy} planning, pick a 15-minute slot on the page, or just reply with a time.\n\n${signature}${optOut}`
    };
  }
  if (step === 3) {
    const s = slots.slice(0, 2).map(x => x.label);
    const offer = s.length === 2 ? `Two slots that work on our side this week: ${s[0]} or ${s[1]}.` : 'A 15-minute slot this week would be easy to arrange.';
    return { subject: 'Re: {subject}', body: `Hi ${name},\n\n${offer} Either useful? ${links.page}\n\n${signature}${optOut}` };
  }
  return {
    subject: 'Re: {subject}',
    body: `Hi ${name},\n\nClosing the loop for now. If ${projectName} comes up in next year's planning, the page stays live for a while: ${links.page}\n\nThank you for the work ${company} already does in ${focus}.\n\n${signature}${optOut}`
  };
}

// --- Proposed slots: two business-hour options, Tue/Thu bias, ≥2 business days out, SAST ---------------------------
function proposedSlots(now = new Date(), count = 2) {
  const out = [];
  const d = new Date(now); d.setHours(0, 0, 0, 0);
  let businessDays = 0;
  for (let i = 0; i < 21 && out.length < count; i += 1) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day === 0 || day === 6) continue;
    businessDays += 1;
    if (businessDays < 2) continue;
    if (day !== 2 && day !== 4) continue; // Tuesday / Thursday
    const time = out.length === 0 ? '10:00' : '14:00';
    const date = d.toISOString().slice(0, 10);
    out.push({ date, time, label: `${d.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })} ${time} SAST` });
  }
  return out;
}

// --- Hosted partnership page model (public, expiring) -----------------------------------------------------------
function pageExpiry({ sequence, approvedAt, now = new Date() }) {
  const base = sequence?.steps?.length ? sequence.steps.filter(s => s.status !== 'skipped').map(s => s.scheduledAt || s.sentAt).filter(Boolean).sort().pop() : null;
  const from = base ? new Date(base) : approvedAt ? new Date(approvedAt) : now;
  return new Date(from.getTime() + PAGE_TTL_DAYS * 86400000).toISOString();
}
function pageModel({ lead, project, funding, slots, now = new Date(), origin = '' }) {
  const company = cleanCompany(lead.company);
  const funded = funding ? funding.gap <= 0 : (project && Number(project.committedAmount || 0) >= Number(project.targetAmount || 0) && Number(project.targetAmount || 0) > 0);
  const expiresAt = lead.pageExpiresAt || pageExpiry({ sequence: lead.sequence, approvedAt: lead.approvedAt, now });
  const expired = Boolean(lead.doNotContact) || new Date(expiresAt) < now || funded;
  const reason = lead.doNotContact ? 'closed' : funded ? 'funded' : new Date(expiresAt) < now ? 'expired' : null;
  const numbers = [];
  if (project) {
    numbers.push({ label: 'Project budget', value: fmtZar(project.targetAmount) });
    const gap = funding ? funding.gap : Math.max(0, Number(project.targetAmount || 0) - Number(project.committedAmount || 0));
    numbers.push({ label: 'Still to fund', value: fmtZar(gap) });
    const metric = (project.verifiedMetrics || [])[0];
    if (metric) numbers.push({ label: metric.label, value: `${metric.baselineValue} → ${metric.currentValue}${metric.unit ? ` ${metric.unit}` : ''}` });
  }
  numbers.push({ label: 'Traceably funded via Chelo', value: CHELO_FACTS.donatedZar }, { label: 'Verified schools', value: CHELO_FACTS.schools }, { label: 'Donors', value: CHELO_FACTS.donors });
  return {
    company, headline: `${company} × ${project?.recipientName || project?.name || 'a verified school'}`,
    project: project ? { name: project.name, recipient: project.recipientName, province: project.province, summary: project.summary, status: project.status, verifiedAt: project.verifiedAt } : null,
    template: templateFor(project), image: `/brand/templates/${templateFor(project)}.jpg`,
    picture: pictureFor({ project, lead, now }), numbers: numbers.slice(0, 5),
    receive: ['Verified recipient and supplier quotes before a rand moves', 'Funds paid directly to suppliers, milestone by milestone', 'An impact report in your name, plus a co-branded photo of the finished work'],
    slots: slots || proposedSlots(now), bookingPath: `/book/${encodeURIComponent(lead.bookingToken)}`, optOutPath: `/opt-out/${encodeURIComponent(lead.bookingToken)}`,
    trustedBy: CHELO_FACTS.trustedBy, expiresAt, expired, reason,
    fallback: expired ? { title: reason === 'funded' ? `${project?.name || 'This project'} is now fully funded` : 'This page has closed', text: `Thank you for looking. See what ${company} could do next — reply to the Chelo team or browse live, verified projects.`, href: 'https://cheloapp.com/projects' } : null,
    origin,
  };
}

// --- Persuasion guardrail (ethics linter) ----------------------------------------------------------------------
// Blocks manipulation and invented numbers; warns on length and multiple asks. Allows vividness, specificity, offer-first.
const MANIPULATION = [
  { re: /\b(last chance|final chance|only today|today only|act now|right now or|don'?t miss (out|this)|limited time|offer expires|expires (today|tonight|soon)|hurry|urgent(ly)?|immediately)\b/i, label: 'false urgency' },
  { re: /\b(only \d+ (spots?|places?|slots?) left|spots? are filling|before it'?s gone|while stocks? last)\b/i, label: 'manufactured scarcity' },
  { re: /\b(you (would|will) be (failing|letting .* down)|if you (really )?care|how can you (ignore|refuse)|shame|guilty|it'?s on you)\b/i, label: 'guilt framing' },
  { re: /\b(guaranteed|risk-?free|100% (certain|guaranteed)|can'?t lose)\b/i, label: 'unfounded guarantee' },
  { re: /\b(as (we|i) discussed|per our (call|conversation)|following our meeting)\b/i, label: 'implied prior relationship', onlyIf: lead => !lead?.lastContactedAt && !lead?.relationshipContext },
];
function allowedNumbers({ project, lead, funding, extra = [] }) {
  const set = new Set();
  const add = v => { if (v === undefined || v === null || v === '') return; const n = String(v).replace(/[^\d.]/g, ''); if (n) set.add(String(Number(n))); };
  for (const m of project?.verifiedMetrics || []) { add(m.baselineValue); add(m.currentValue); }
  add(project?.targetAmount); add(project?.committedAmount); add(lead?.amount); add(funding?.gap); add(funding?.committed);
  for (const v of [project?.targetAmount, project?.committedAmount, lead?.amount, funding?.gap]) { const n = Number(v || 0); if (n >= 1e6) { add((n / 1e6).toFixed(1)); add(Math.round(n / 1e6)); } if (n >= 1e3) add(Math.round(n / 1e3)); }
  add('7'); add('500'); add('15'); add('20'); add('24'); // Chelo facts + meeting lengths; 24 classrooms (live cheloapp project)
  for (const t of [project?.name, project?.summary, project?.recipientName, project?.picture, lead?.project, lead?.notes, ...extra]) for (const m of String(t || '').matchAll(/\d[\d.,]*/g)) add(m[0].replace(/,/g, ''));
  return set;
}
function lint(text, { project, lead, funding, step = 1, extra = [] } = {}) {
  const issues = [];
  const body = String(text || '');
  for (const rule of MANIPULATION) { if (rule.onlyIf && !rule.onlyIf(lead)) continue; const m = body.match(rule.re); if (m) issues.push({ severity: 'block', type: rule.label, text: m[0] }); }
  const allowed = allowedNumbers({ project, lead, funding, extra });
  const stripped = body.replace(/https?:\/\/\S+/g, ' ').replace(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*,?\s+\d{1,2}\b/g, ' ').replace(/\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*/g, ' ').replace(/\b(19|20)\d{2}\b/g, ' ').replace(/\b\d{1,2}:\d{2}\b/g, ' ').replace(/\+?\d[\d\s-]{7,}\d/g, ' ');
  for (const m of stripped.matchAll(/(?<![A-Za-z\d])\d[\d.,]*\+?/g)) {
    const raw = m[0].replace(/[+,]/g, '').replace(/\.$/, '');
    const n = String(Number(raw));
    if (!allowed.has(n) && Number(raw) > 1) issues.push({ severity: 'block', type: 'number not traceable to the project record', text: m[0] });
  }
  const wc = words(body.replace(/https?:\/\/\S+/g, '').replace(/To stop further outreach:.*$/ms, ''));
  if (step === 1 && wc > 125) issues.push({ severity: 'warn', type: 'first touch longer than 125 words', text: `${wc} words` });
  const asks = (body.match(/\?/g) || []).length;
  if (asks > 1) issues.push({ severity: 'warn', type: 'more than one question/ask', text: `${asks} questions` });
  const links = (body.match(/https?:\/\/\S+/g) || []).filter(l => !/opt-out/.test(l)).length;
  if (step === 1 && links > 0) issues.push({ severity: 'warn', type: 'link in first touch (plain-text first is safer)', text: `${links} link(s)` });
  const seen = new Set(); const unique = issues.filter(i => { const k = `${i.type}:${i.text}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { ok: !unique.some(i => i.severity === 'block'), blocks: unique.filter(i => i.severity === 'block').length, warnings: unique.filter(i => i.severity === 'warn').length, issues: unique };
}

module.exports = { CHELO_FACTS, PAGE_TTL_DAYS, TEMPLATES, templateFor, pictureFor, ladderStep, proposedSlots, pageExpiry, pageModel, lint, allowedNumbers, words };
