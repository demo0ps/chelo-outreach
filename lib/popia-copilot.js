const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL_MONTHS = [
  ['january', 1], ['february', 2], ['march', 3], ['april', 4], ['may', 5], ['june', 6],
  ['july', 7], ['august', 8], ['september', 9], ['october', 10], ['november', 11], ['december', 12],
  ['jan', 1], ['feb', 2], ['mar', 3], ['apr', 4], ['jun', 6], ['jul', 7], ['aug', 8], ['sep', 9], ['sept', 9], ['oct', 10], ['nov', 11], ['dec', 12]
];

// Deterministic POPIA privacy shield: scrubs emails, SA/international phone numbers, and 13-digit SA IDs before external AI calls.
function scrubPiiForAi(rawText) {
  let text = String(rawText || '').slice(0, 12000);
  let emails = 0;
  let phones = 0;
  let saIds = 0;

  text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, () => {
    emails += 1;
    return '[REDACTED_EMAIL]';
  });

  // 13-digit South African ID numbers (YYMMDDSSSSCAZ)
  text = text.replace(/\b\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\s?\d{4}\s?[01]\d{2}\b/g, () => {
    saIds += 1;
    return '[REDACTED_SA_ID]';
  });

  // SA (+27 / 0xx) and international phone numbers while preserving ZAR currency figures (e.g. R 250,000)
  text = text.replace(/(?<![R$\d])(?:\+27|0)[1-8]\d(?:[\s.-]?\d){7,8}\b/g, () => {
    phones += 1;
    return '[REDACTED_PHONE]';
  });
  text = text.replace(/(?<![R$\d])\+[1-9]\d{0,2}(?:[\s().-]?\d){8,12}\b/g, () => {
    phones += 1;
    return '[REDACTED_PHONE]';
  });

  return {
    scrubbedText: text.trim(),
    redactions: { emails, phones, saIds, total: emails + phones + saIds }
  };
}

function heuristicExtractDonorIntel(scrubbedText, projects = []) {
  const low = scrubbedText.toLowerCase();
  let sector = '';
  const sectorMatchers = [
    ['Financial services', /\b(bank|financial|insurance|asset management|fintech|investment)\b/i],
    ['Mining & Resources', /\b(mining|mineral|platinum|gold|coal|resources)\b/i],
    ['Energy', /\b(energy|renewable|solar|power|grid|wind|utility)\b/i],
    ['Retail', /\b(retail|supermarket|grocery|store|consumer|fmcg)\b/i],
    ['Technology', /\b(technology|software|telecom|digital|cloud|broadband|ict)\b/i],
    ['Foundation', /\b(foundation|philanthrop|grantmaking|endowment)\b/i],
    ['Trust', /\b(trust|trustees|bequest)\b/i],
    ['Infrastructure', /\b(infrastructure|construction|engineering|logistics|property)\b/i],
    ['Healthcare', /\b(health|medical|pharma|hospital)\b/i]
  ];
  for (const [label, regex] of sectorMatchers) {
    if (regex.test(scrubbedText)) { sector = label; break; }
  }

  const themes = [];
  if (/\b(solar|off-grid|load-?shedding|renewable|electricity)\b/i.test(low)) themes.push('Off-grid school solar & energy resilience');
  if (/\b(digital|coding|computer|ict|connectivity|e-learning)\b/i.test(low)) themes.push('Digital learning & school connectivity');
  if (/\b(literacy|reading|library|libraries|books|foundation phase)\b/i.test(low)) themes.push('Foundation-phase literacy & bilingual libraries');
  if (/\b(stem|science|maths|mathematics|robotics|teacher)\b/i.test(low)) themes.push('STEM practicals & educator development');
  if (/\b(water|sanitation|wash|ablution|borehole|hygiene)\b/i.test(low)) themes.push('Safe school water & dignified sanitation');
  if (/\b(ecd|early childhood|nutrition|food|garden|creche)\b/i.test(low)) themes.push('Early childhood development & nutrition');
  if (/\b(youth|employability|tvet|skills|artisan|learnership)\b/i.test(low)) themes.push('Youth employability & TVET pathways');

  const employeeVolunteering = /\b(employee volunteering|staff volunteering|payroll giving|mandela day|volunteer)\b/i.test(low);
  const inKindSupport = /\b(in-kind|equipment donation|pro bono|product donation)\b/i.test(low);
  const section18A = /\b(section 18a|18a|pbo|b-bbee|sed|socio-economic development)\b/i.test(low);

  const detectedMonths = [];
  for (const [name, num] of FULL_MONTHS) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(low) && !detectedMonths.includes(num)) detectedMonths.push(num);
  }
  const grantWindowOpenMonth = detectedMonths[0] || 0;
  const grantWindowCloseMonth = detectedMonths[1] || detectedMonths[0] || 0;

  let nextGrantDeadline = '';
  const isoMatch = scrubbedText.match(/\b(202[6-9]-\d{2}-\d{2})\b/);
  if (isoMatch) nextGrantDeadline = isoMatch[1];

  const timingBits = [];
  if (grantWindowOpenMonth && grantWindowCloseMonth && grantWindowOpenMonth !== grantWindowCloseMonth) {
    timingBits.push(`Funding/review window mentioned around ${MONTH_NAMES[grantWindowOpenMonth]}–${MONTH_NAMES[grantWindowCloseMonth]}`);
  } else if (grantWindowOpenMonth) {
    timingBits.push(`Cycle or deadline references ${MONTH_NAMES[grantWindowOpenMonth]}`);
  }
  if (/\b(q1|first quarter)\b/i.test(low)) timingBits.push('Q1 review noted');
  if (/\b(q2|second quarter)\b/i.test(low)) timingBits.push('Q2 review noted');
  if (/\b(q3|third quarter)\b/i.test(low)) timingBits.push('Q3 review noted');
  if (/\b(q4|fourth quarter)\b/i.test(low)) timingBits.push('Q4 review noted');
  if (employeeVolunteering) timingBits.push('Employee volunteering interest noted');
  if (inKindSupport) timingBits.push('In-kind contribution pathway noted');
  if (section18A) timingBits.push('Section 18A / B-BBEE SED alignment mentioned');

  const priorityParts = [
    themes.length ? `Observed priorities: ${themes.join('; ')}.` : 'Confirm specific education or community-investment focus areas from the public source.',
    timingBits.length ? `${timingBits.join(' · ')}.` : ''
  ].filter(Boolean);

  // Suggest best-matching verified project purely for human review (never auto-locks the ask).
  let suggestedProjectId = '';
  let bestScore = 0;
  for (const proj of projects) {
    const hay = `${proj.name} ${proj.sector} ${proj.summary} ${proj.province}`.toLowerCase();
    let score = 0;
    for (const word of hay.split(/[^a-z0-9]+/).filter(w => w.length >= 5)) {
      if (low.includes(word)) score += 1;
    }
    if (score > bestScore) { bestScore = score; suggestedProjectId = proj.id; }
  }

  return {
    sector,
    focusAreas: themes,
    partnerPriorities: priorityParts.join(' ').slice(0, 1100),
    grantWindowOpenMonth,
    grantWindowCloseMonth,
    nextGrantDeadline,
    employeeVolunteering,
    inKindSupport,
    suggestedProjectId: bestScore >= 2 ? suggestedProjectId : '',
    summaryNotes: `Extracted from staff-supplied public excerpt (POPIA-scrubbed). Verify all priorities, eligibility and dates before outreach.`
  };
}

async function extractDonorIntelligence(rawText, aiConfig, projects = []) {
  const text = String(rawText || '').trim();
  if (text.length < 20) throw new Error('Paste at least a short paragraph from a public CSI report, sustainability page or grant guideline.');
  const { scrubbedText, redactions } = scrubPiiForAi(text);
  const fallback = heuristicExtractDonorIntel(scrubbedText, projects);

  if (!aiConfig || !aiConfig.apiKey) {
    return {
      mode: 'local-heuristic',
      redactions,
      extracted: fallback,
      message: `Structured locally with POPIA PII shield (${redactions.total} personal identifier${redactions.total === 1 ? '' : 's'} scrubbed). Confirm every field before saving.`
    };
  }

  const catalogDigest = projects.map(p => ({ id: p.id, name: p.name, sector: p.sector, province: p.province }));
  const response = await fetch(aiConfig.endpoint, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${aiConfig.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: aiConfig.model,
      temperature: 0.2,
      max_tokens: 550,
      messages: [
        {
          role: 'system',
          content: 'Extract structured, factual donor research notes from a POPIA-scrubbed public CSI or foundation excerpt for Chelo staff review. Never invent facts, dates, eligibility or contacts. Return ONLY valid JSON with fields: sector (string), focusAreas (array of short strings), partnerPriorities (concise string summarizing priorities, grant cycles, B-BBEE SED/Section 18A, employee volunteering or in-kind notes, max 900 chars), grantWindowOpenMonth (integer 0-12, 0 if unknown), grantWindowCloseMonth (integer 0-12, 0 if unknown), nextGrantDeadline (YYYY-MM-DD or empty string if not explicitly stated), employeeVolunteering (boolean), inKindSupport (boolean), suggestedProjectId (id from catalogDigest only if clearly aligned, else empty string; staff still decide fit and ask), summaryNotes (concise provenance summary, max 400 chars).'
        },
        {
          role: 'user',
          content: JSON.stringify({ scrubbedExcerpt: scrubbedText, catalogDigest })
        }
      ]
    }),
    signal: AbortSignal.timeout(25000)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || `AI extraction failed (${response.status}).`);
  const content = String(payload.choices?.[0]?.message?.content || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    const s = content.indexOf('{');
    const e = content.lastIndexOf('}');
    if (s < 0 || e <= s) return { mode: 'local-heuristic', redactions, extracted: fallback, message: 'AI returned non-JSON; used local POPIA-safe extractor.' };
    parsed = JSON.parse(content.slice(s, e + 1));
  }

  const validProjectIds = new Set(projects.map(p => p.id));
  const openMonth = Number(parsed.grantWindowOpenMonth) >= 1 && Number(parsed.grantWindowOpenMonth) <= 12 ? Number(parsed.grantWindowOpenMonth) : fallback.grantWindowOpenMonth;
  const closeMonth = Number(parsed.grantWindowCloseMonth) >= 1 && Number(parsed.grantWindowCloseMonth) <= 12 ? Number(parsed.grantWindowCloseMonth) : fallback.grantWindowCloseMonth;
  const deadline = /^\d{4}-\d{2}-\d{2}$/.test(String(parsed.nextGrantDeadline || '').trim()) ? String(parsed.nextGrantDeadline).trim() : fallback.nextGrantDeadline;

  return {
    mode: 'openai',
    redactions,
    extracted: {
      sector: String(parsed.sector || fallback.sector || '').trim().slice(0, 100),
      focusAreas: Array.isArray(parsed.focusAreas) ? parsed.focusAreas.map(x => String(x || '').trim()).filter(Boolean).slice(0, 6) : fallback.focusAreas,
      partnerPriorities: String(parsed.partnerPriorities || fallback.partnerPriorities || '').trim().slice(0, 1100),
      grantWindowOpenMonth: openMonth,
      grantWindowCloseMonth: closeMonth,
      nextGrantDeadline: deadline,
      employeeVolunteering: Boolean(parsed.employeeVolunteering ?? fallback.employeeVolunteering),
      inKindSupport: Boolean(parsed.inKindSupport ?? fallback.inKindSupport),
      suggestedProjectId: validProjectIds.has(parsed.suggestedProjectId) ? parsed.suggestedProjectId : fallback.suggestedProjectId,
      summaryNotes: String(parsed.summaryNotes || fallback.summaryNotes || '').trim().slice(0, 500)
    },
    message: `Extracted with ${aiConfig.model} after POPIA PII scrubbing (${redactions.total} identifier${redactions.total === 1 ? '' : 's'} removed locally). Staff must review and confirm fit.`
  };
}

function computeGrantCycleStatus(record, referenceDate = new Date()) {
  const deadline = String(record?.nextGrantDeadline || '').trim();
  const openM = Number(record?.grantWindowOpenMonth || 0);
  const closeM = Number(record?.grantWindowCloseMonth || 0);

  // Align reference date to SAST (UTC+02:00)
  const sastNow = new Date(referenceDate.getTime() + 2 * 3600000);
  const currentMonth = sastNow.getUTCMonth() + 1;
  const todayIso = sastNow.toISOString().slice(0, 10);

  if (/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
    const daysLeft = Math.round((Date.parse(`${deadline}T12:00:00Z`) - Date.parse(`${todayIso}T12:00:00Z`)) / 86400000);
    if (Number.isFinite(daysLeft)) {
      if (daysLeft < 0) return { code: 'passed', label: `Deadline passed (${deadline})`, urgent: false };
      if (daysLeft <= 30) return { code: 'closing-soon', label: `Grant deadline in ${daysLeft}d (${deadline})`, urgent: true };
      if (daysLeft <= 60) return { code: 'upcoming', label: `Deadline in ${daysLeft}d (${deadline})`, urgent: false };
      return { code: 'scheduled', label: `Next deadline ${deadline}`, urgent: false };
    }
  }

  if (openM >= 1 && openM <= 12) {
    const endM = closeM >= 1 && closeM <= 12 ? closeM : openM;
    const inWindow = openM <= endM
      ? (currentMonth >= openM && currentMonth <= endM)
      : (currentMonth >= openM || currentMonth <= endM);
    const windowText = openM === endM ? MONTH_NAMES[openM] : `${MONTH_NAMES[openM]}–${MONTH_NAMES[endM]}`;
    if (inWindow) {
      const closingThisMonth = currentMonth === endM;
      return {
        code: closingThisMonth ? 'closing-soon' : 'open',
        label: closingThisMonth ? `Window closing (${windowText})` : `Grant window open (${windowText})`,
        urgent: closingThisMonth
      };
    }
    const monthsUntilOpen = (openM - currentMonth + 12) % 12;
    if (monthsUntilOpen <= 2) {
      return { code: 'upcoming', label: `Opens soon (${windowText})`, urgent: false };
    }
    return { code: 'scheduled', label: `Cycle: ${windowText}`, urgent: false };
  }

  return { code: 'none', label: 'Grant cycle unrecorded', urgent: false };
}

module.exports = {
  MONTH_NAMES,
  scrubPiiForAi,
  heuristicExtractDonorIntel,
  extractDonorIntelligence,
  computeGrantCycleStatus
};
