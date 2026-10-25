'use strict';
/**
 * Signals v1 (Batch 4): financial-year-end → deterministic approach window, and the fit score that orders the workbench.
 *
 * Everything here is pure and explainable. No AI, no external data: the only "signal" we trust in v1 is a company's
 * financial year-end, because SA CSI budgets (typically ~1% NPAT, tied to B-BBEE SED) are planned in the months before
 * FYE and allocated in the first quarter of the new year. Staff can always override the month.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LOOKUP = { january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12 };

/** Pull a financial year-end month out of public text ("year ended 30 June 2025", "financial year end: February", "FY ending 31 March"). */
function inferFinancialYearEnd(text) {
  const t = String(text || '').replace(/\s+/g, ' ');
  const patterns = [
    /(?:financial |fiscal )?year[- ]?(?:end(?:ed|ing)?|to)\s*(?:on\s*)?(?:the\s*)?(?:\d{1,2}(?:st|nd|rd|th)?\s*)?(january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
    /(?:financial |fiscal )?year[- ]?end\s*(?:is|:|of|falls on)?\s*(?:\d{1,2}\s*)?(january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
    /\bFY\s?(?:end(?:ed|ing)?)?\s*(?:\d{1,2}\s*)?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i,
    /\b(?:results|report) for the (?:twelve|12) months (?:ended|ending|to) (?:\d{1,2}\s*)?(january|february|march|april|may|june|july|august|september|october|november|december)\b/i
  ];
  for (const re of patterns) { const m = t.match(re); if (m) { const month = MONTH_LOOKUP[m[1].toLowerCase()]; if (month) return { month, evidence: m[0].slice(0, 80) }; } }
  return null;
}

function monthsUntil(targetMonth, now) {
  const cur = now.getUTCMonth() + 1; const dayFrac = (now.getUTCDate() - 1) / 30;
  let diff = targetMonth - cur - dayFrac;
  while (diff < -6) diff += 12; while (diff > 6) diff -= 12;
  return diff; // -6..6 months (negative = FYE recently passed)
}
function monthStart(year, month) { return new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10); }
function addMonths(year, month, delta) { const d = new Date(Date.UTC(year, month - 1 + delta, 1)); return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 }; }

/**
 * Deterministic approach window around FYE (month 1–12):
 *   budgeting   FYE−5 … FYE−2 months  → score 1.0 (CSI budgets for next year are being set)
 *   closing     FYE−1 … FYE           → 0.55 (books closing, committees busy; still possible for next FY)
 *   allocation  FYE+1 … FYE+3         → 0.85 (new budget live, unallocated funds)
 *   mid-year    otherwise             → 0.35 (budget largely committed)
 */
function approachWindow(fyeMonth, now = new Date()) {
  const month = Number(fyeMonth);
  if (!Number.isInteger(month) || month < 1 || month > 12) return { known: false, phase: 'unknown', score: 0.5, label: 'FYE unknown', detail: 'Add the financial year-end to time the approach.' };
  const delta = monthsUntil(month, now); // months until FYE
  const year = now.getUTCFullYear();
  // Next FYE calendar position
  let fyeYear = year; if (month < now.getUTCMonth() + 1) fyeYear = year + 1;
  const b0 = addMonths(fyeYear, month, -5), b1 = addMonths(fyeYear, month, -1); // budgeting opens / closes (exclusive)
  const a0 = addMonths(fyeYear, month, 1), a1 = addMonths(fyeYear, month, 4);
  let phase, score, label, detail;
  if (delta >= 2 && delta <= 5) { phase = 'budgeting'; score = 1; label = 'Budgeting window'; detail = `Next CSI budget is being set ahead of the ${MONTHS[month - 1]} year-end.`; }
  else if (delta > -0.5 && delta < 2) { phase = 'closing'; score = 0.55; label = 'Year-end closing'; detail = `Books close in ${MONTHS[month - 1]}; pitch for the new financial year.`; }
  else if (delta <= -0.5 && delta >= -3.5) { phase = 'allocation'; score = 0.85; label = 'Allocation window'; detail = `New budget live since ${MONTHS[month % 12]}; unallocated funds are decided now.`; }
  else { phase = 'mid-year'; score = 0.35; label = 'Mid-year'; detail = 'Budget largely committed; build the relationship for the next cycle.'; }
  // the next time a budgeting window opens (for "opens in N days" nudges)
  let opensYear = fyeYear; let opens = addMonths(opensYear, month, -5);
  if (Date.UTC(opens.year, opens.month - 1, 1) <= now.getTime() && phase !== 'budgeting') { opens = addMonths(fyeYear + 1, month, -5); }
  const opensOn = monthStart(opens.year, opens.month);
  const daysToOpen = Math.ceil((Date.parse(opensOn) - now.getTime()) / 86400e3);
  return { known: true, month, monthLabel: MONTHS[month - 1], phase, score, label, detail, monthsToFye: Math.round(delta * 10) / 10, budgeting: { from: monthStart(b0.year, b0.month), to: monthStart(b1.year, b1.month) }, allocation: { from: monthStart(a0.year, a0.month), to: monthStart(a1.year, a1.month) }, nextBudgetingOpens: opensOn, daysToNextBudgeting: phase === 'budgeting' ? 0 : daysToOpen };
}

// ---------- Fit score ----------
const SECTOR_AFFINITY = [
  // [project sector pattern, funder sector / focus pattern, score]
  [/literacy|education|school|learner|ecd|early childhood|stem|maths|science|tvet|bursar/i, /education|school|learner|literacy|stem|bursar|skills|youth|ecd/i, 1],
  [/youth|skills|employab|entrepreneur/i, /youth|skills|employab|enterprise|entrepreneur|job/i, 1],
  [/solar|energy|digital|connectivity|ict/i, /energy|mining|digital|telecom|ict|technology|infrastructure|utilit/i, 0.95],
  [/wash|water|sanitation|infrastructure/i, /water|sanitation|infrastructure|mining|construction|engineering|community/i, 0.9],
  [/health|nutrition|feeding/i, /health|nutrition|pharma|medical|wellbeing|insur/i, 0.9],
  [/community|rural|township/i, /community|rural|township|social investment|csi|retail|bank|financial/i, 0.8]
];
function sectorFit(project, funder) {
  if (!project) return { score: 0.5, reason: 'no project matched yet' };
  const projectText = `${project.sector || ''} ${project.name || ''} ${(project.outcomes || []).join(' ')}`;
  const funderText = `${funder.sector || ''} ${(funder.research?.focusAreas || []).join(' ')} ${(funder.research?.missionSummary || '')} ${funder.partnerPriorities || ''}`;
  if (!funderText.trim()) return { score: 0.6, reason: 'funder sector / focus unknown' };
  let best = 0.45, reason = 'no explicit overlap between funder focus and project';
  for (const [pp, fp, s] of SECTOR_AFFINITY) if (pp.test(projectText) && fp.test(funderText) && s > best) { best = s; reason = `funder focus matches ${project.sector || project.name}`; }
  if (/education/i.test(funderText) && /education|school|learner|literacy|stem|ecd/i.test(projectText)) { best = 1; reason = 'education is a stated CSI focus (91% of SA CSI funders support it)'; }
  return { score: best, reason };
}
const NATIONAL = /national|all provinces|countrywide|south africa|across the country/i;
function provinceFit(project, funder) {
  const pp = String(project?.province || '').trim(); if (!pp) return { score: 0.6, reason: 'project province not set' };
  const text = `${funder.province || ''} ${funder.footprint || ''} ${funder.research?.missionSummary || ''} ${(funder.research?.findings || []).map(f => f.text).join(' ')}`;
  if (new RegExp(pp.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i').test(text)) return { score: 1, reason: `operates in ${pp}` };
  if (/national|all provinces|countrywide/i.test(text)) return { score: 0.8, reason: 'national footprint' };
  if (!funder.province && !funder.footprint) return { score: 0.65, reason: 'footprint unknown' };
  return { score: 0.4, reason: `no stated presence in ${pp}` };
}
const FOUNDATION = /foundation|trust|fund\b|npc|npo|philanthrop/i;
function sedFit(project, funder) {
  const isFoundation = FOUNDATION.test(`${funder.company || ''} ${funder.sector || ''}`);
  const projectEligible = project ? project.sedEligible !== false : true;
  if (!projectEligible) return { score: 0.5, reason: 'project not flagged SED-eligible' };
  if (isFoundation) return { score: 0.8, reason: 'grant-making entity (SED points less decisive)' };
  return { score: 1, reason: 'for-profit funder: verified project counts towards B-BBEE SED (1% NPAT)' };
}
function warmthFit(funder, { events = [], bookings = [] } = {}) {
  if (funder.stage === 'Won' || funder.partnerId) return { score: 1, reason: 'existing partner' };
  if (funder.introducer) return { score: 1, reason: `introduced by ${funder.introducer}` };
  if (funder.relationshipContext) return { score: 1, reason: 'warm introduction on file' };
  if (bookings.some(b => b.leadId === funder.id)) return { score: 0.95, reason: 'briefing booked' };
  if (funder.repliedAt || funder.triage) return { score: 0.9, reason: 'has replied' };
  if (funder.contactSource?.kind === 'waterfall' && funder.contactSource.hops?.includes('graph')) return { score: 0.75, reason: 'contact known via partner graph' };
  if (events.some(e => e.leadId === funder.id && e.type === 'open')) return { score: 0.65, reason: 'opened an email' };
  if (funder.research?.status === 'approved') return { score: 0.55, reason: 'research approved, cold contact' };
  return { score: 0.45, reason: 'cold' };
}
const WEIGHTS = { sector: 0.3, province: 0.15, sed: 0.1, window: 0.25, warmth: 0.2 };
/** Weighted geometric mean → a weak factor drags the score down multiplicatively (the "×" in sector × province × SED × window × warmth). */
function fitScore(funder, { project = null, events = [], bookings = [], now = new Date() } = {}) {
  const components = {
    sector: sectorFit(project, funder),
    province: provinceFit(project, funder),
    sed: sedFit(project, funder),
    window: (() => {
      if (funder.grantWindowOpenMonth && funder.grantWindowCloseMonth) {
        const cur = now.getUTCMonth() + 1; const o = Number(funder.grantWindowOpenMonth), c = Number(funder.grantWindowCloseMonth);
        const inside = o <= c ? cur >= o && cur <= c : cur >= o || cur <= c;
        return { score: inside ? 1 : 0.4, reason: inside ? 'inside the stated grant window' : 'outside the stated grant window', window: { known: true, phase: inside ? 'grant-window' : 'outside', label: inside ? 'Grant window open' : 'Grant window closed', score: inside ? 1 : 0.4, source: 'staff' } };
      }
      const w = approachWindow(funder.financialYearEnd, now);
      return { score: w.score, reason: w.known ? `${w.label} (FYE ${w.monthLabel})` : 'FYE unknown — add it to time the approach', window: w };
    })(),
    warmth: warmthFit(funder, { events, bookings })
  };
  let logSum = 0; for (const [k, wgt] of Object.entries(WEIGHTS)) logSum += wgt * Math.log(Math.max(0.05, components[k].score));
  const score = Math.round(Math.exp(logSum) * 100);
  const drivers = Object.entries(components).map(([k, c]) => ({ key: k, score: Math.round(c.score * 100), weight: WEIGHTS[k], reason: c.reason })).sort((a, b) => a.score - b.score);
  return { score, band: score >= 75 ? 'strong' : score >= 55 ? 'good' : score >= 40 ? 'fair' : 'weak', components: Object.fromEntries(Object.entries(components).map(([k, c]) => [k, { score: Math.round(c.score * 100), reason: c.reason }])), window: components.window.window, weakest: drivers[0], strongest: drivers[drivers.length - 1], computedAt: now.toISOString() };
}

module.exports = { MONTHS, inferFinancialYearEnd, approachWindow, fitScore, sectorFit, provinceFit, sedFit, warmthFit, WEIGHTS };
