'use strict';
// v65: one PDF engine, four documents. The CSI desk keeps the funder proposal; the other desks get a document that
// fits the person reading it. Same Chelo look everywhere — only the words, labels and sections change.
//   media    → Press backgrounder (story, why now, facts, spokesperson & assets, next step)
//   school   → Project brief for the principal / SGB (plain language, no funder talk, no money through the school)
//   supplier → Scope of works / quote request (site, scope, how to quote, how payment works)
// Pure: no I/O. `layoutFor` returns what pdf-engine needs; `fieldLabels` is what the editor shows.

const TRADE_LABELS = { building: 'Building & classrooms', sanitation: 'Toilets & plumbing', water: 'Water tanks & boreholes', electrical: 'Electrical & solar', ict: 'Computers & ICT', furniture: 'Furniture & fittings', fencing: 'Fencing & security', roofing: 'Roofing & paint', kitchen: 'Kitchens & feeding', landscaping: 'Grounds & sports', other: 'Other' };
const clamp = (t, n) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1).trim()}…` : s; };
const rand = n => Number(n) ? `R ${Number(n).toLocaleString('en-ZA')}` : '';
const dateZA = iso => { const d = new Date(iso || ''); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); };

/** Labels for the four editable paragraphs and the modal copy, per kind. The funder set is the original wording. */
const FIELD_LABELS = {
  funder: { doc: 'Partnership proposal', modalTitle: 'Personalise the proposal', modalIntro: company => `Create a guided, donor-specific proposal for ${company}.`, button: 'Generate proposal PDF', opening: 'Partnership summary', impact: 'The opportunity', rationale: 'Why Chelo', nextStep: 'Recommended next step', notes: 'Chelo project and campaign notes', amount: 'Staff-selected contribution (ZAR)', project: 'Staff-selected project / impact focus' },
  media: { doc: 'Press backgrounder', modalTitle: 'Press backgrounder', modalIntro: company => `A one-page backgrounder ${company} can file the story from: what Chelo is, why now, facts, spokesperson and assets. Built from the approved media kit; edit any paragraph.`, button: 'Generate backgrounder PDF', opening: 'The story (what Chelo is, in two sentences)', impact: 'Why now (the hook for this outlet)', rationale: 'Extra facts for this story (optional)', nextStep: 'What we offer (interview, site visit, pictures)', notes: 'Notes for this outlet (not printed)', amount: '', project: 'Project or story focus' },
  district: { doc: 'Partnership request', modalTitle: 'Partnership request for the district office', modalIntro: company => `A one-page partnership note for ${company}: what Chelo does, the district as the DBE list shows it, how we would work with the office, and the ask.`, button: 'Generate partnership PDF', opening: 'What Chelo does', impact: 'The district as the DBE list shows it', rationale: 'How we would work with the office', nextStep: 'What we are asking for', notes: 'Notes', amount: 'Indicative first-phase budget (ZAR, optional)', project: 'First schools / focus (optional)' },
  school: { doc: 'Project brief for the school', modalTitle: 'Brief for the principal', modalIntro: company => `A plain-language page for ${company}: the need as Chelo understood it, what happens next, and what the school does. No funder language; no money passes through the school.`, button: 'Generate school brief PDF', opening: 'What Chelo does (plain words)', impact: 'The need as we understood it', rationale: 'What happens next', nextStep: 'What the school does', notes: 'Notes from the call (not printed)', amount: 'Estimate from the call (ZAR)', project: 'Need / project name' },
  supplier: { doc: 'Scope of works · quote request', modalTitle: 'Scope of works', modalIntro: company => `The quote request ${company} receives: site, scope, how to quote and how payment works. Pre-filled from the open quote request on the linked project.`, button: 'Generate scope of works PDF', opening: 'Site and context', impact: 'Scope of works', rationale: 'How to quote', nextStep: 'How payment and sign-off work', notes: 'Internal notes (not printed)', amount: 'Budget guide (ZAR, optional)', project: 'Project' }
};
function fieldLabels(kind, lead = null) { if (lead?.school?.level === 'district') return FIELD_LABELS.district; return FIELD_LABELS[kind] || FIELD_LABELS.funder; }
function filenameFor(kind, lead) {
  const slug = clamp(lead?.company || 'chelo', 40).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'chelo';
  if (lead?.school?.level === 'district') return `Chelo-Partnership-Request-${slug}.pdf`;
  return { media: `Chelo-Press-Backgrounder-${slug}.pdf`, school: `Chelo-Project-Brief-${slug}.pdf`, supplier: `Chelo-Scope-of-Works-${slug}.pdf` }[kind] || 'Chelo-Partnership-Proposal.pdf';
}

/** Default paragraph text per kind — what the editor pre-fills and the PDF prints when a field is left empty. */
function defaults(kind, lead, ctx = {}) {
  const { project = null, kit = null, tender = null, staff = {} } = ctx;
  const company = clamp(lead?.company, 80);
  if (kind === 'media') {
    const facts = (kit?.facts || []).filter(Boolean).slice(0, 4);
    const focus = project ? `${project.name}${project.recipientName ? ` at ${project.recipientName}` : ''}${project.province ? `, ${project.province}` : ''}` : '';
    return {
      opening: kit?.boilerplate || 'Chelo verifies what a school actually needs, finds a company to fund it, gets quotes from vetted suppliers and pays the supplier directly against milestones the school confirms. The school gets the thing, not a promise.',
      impact: focus ? `${focus}: ${clamp(project.summary, 220) || 'a verified need with a funder and a supplier lined up'}. It is a story with a school, a company and a tradesperson in it — and a before and after your audience can see.` : 'Most school donations in South Africa are a photo and a handover. Chelo publishes the need, the quote, the supplier and the sign-off for every project, so your audience can see where the money went.',
      rationale: facts.length ? facts.join(' ') : '',
      nextStep: `${kit?.spokesperson ? `${kit.spokesperson}${kit.spokespersonTitle ? `, ${kit.spokespersonTitle}` : ''} is available for interview` : 'A Chelo spokesperson is available for interview'} (phone, studio or on site). We can arrange a visit to the school with the principal's permission, and supply photos and a backgrounder.${kit?.pressEmail ? ` Press: ${kit.pressEmail}.` : ''}${kit?.assetsUrl ? ` Assets: ${kit.assetsUrl}.` : ''}`
    };
  }
  if (kind === 'school' && lead?.school?.level === 'district') return require('./districts').pdfDefaults(lead); // v72
  if (kind === 'school') {
    const needs = (lead?.needs || []).slice(0, 4);
    const needText = needs.length ? needs.map(n => `${n.text}${n.estimate ? ` (estimate ${rand(n.estimate)})` : ''}`).join('; ') : (project?.summary || 'To be confirmed on the 15-minute call with the principal.');
    return {
      opening: `Chelo connects schools with companies that fund real needs. We confirm the need with the school, get quotes from suppliers we have vetted, find a company to pay for it, and the company pays the supplier directly. The school confirms when the work is done. There is no cost to the school and no money passes through the school.`,
      impact: needText,
      rationale: 'Next, Chelo asks vetted suppliers in your province to quote. When a company agrees to fund the work, Chelo tells the school the dates. The supplier does the work; the principal confirms it is done; the company pays the supplier. Chelo keeps the school and the company informed at each step.',
      nextStep: 'Confirm the need and give Chelo one contact person (name and phone). Allow the supplier access to the site on the agreed days. Tell Chelo when the work is done, and if anything is wrong. Chelo never asks the school for a payment or banking details.'
    };
  }
  if (kind === 'supplier') {
    const sp = lead?.supplier || {};
    const trade = tender ? (TRADE_LABELS[tender.trade] || tender.trade) : (sp.trades || []).map(t => TRADE_LABELS[t] || t).join(', ');
    const site = project ? `${project.recipientName || project.name}${project.province ? `, ${project.province}` : ''}` : 'a verified school';
    return {
      opening: tender ? `Site: ${site}. Trade: ${trade}. ${clamp(project?.summary, 240)}` : `Chelo sends verified school needs to approved suppliers by trade and province. Your trades: ${trade || 'as registered'}; provinces: ${(sp.provinces || []).join(', ') || 'as registered'}.`,
      impact: tender?.brief || project?.summary || 'The scope is confirmed with the school before the request goes out and is written in the quote request email.',
      rationale: `Quote the total in rand including VAT, itemised, with days to complete and how long the quote is valid.${tender ? ` Submit on the quote link in the email by ${dateZA(tender.closesAt)}.` : ' Each request comes with its own quote link.'} Site visits can be arranged through Chelo; do not approach the school directly for payment or variations.`,
      nextStep: `Chelo shortlists with the school and the funder. The signed supplier is confirmed in writing. The funder pays the supplier directly against milestones the school confirms — Chelo handles no money.${tender?.feePct ? ` A Chelo fee of ${tender.feePct}% applies to the signed quote.` : ''} Vetting status: ${sp.vetting?.status === 'approved' ? `approved${sp.vetting.at ? ` on ${String(sp.vetting.at).slice(0, 10)}` : ''}` : sp.vetting?.status || 'pending'}.`
    };
  }
  return {};
}

/** Everything pdf-engine needs to render a non-funder document. Returns null for funder (engine keeps its own layout). */
function layoutFor(kind, lead, proposal = {}, ctx = {}) {
  if (!['media', 'school', 'supplier'].includes(kind)) return null;
  const d = defaults(kind, lead, ctx);
  const f = key => String(proposal[key] || d[key] || '').trim();
  const { project = null, kit = null, tender = null } = ctx;
  const labels = fieldLabels(kind);
  if (kind === 'media') {
    return {
      kicker: 'PRESS BACKGROUNDER', continuedKicker: 'PRESS BACKGROUNDER (CONTINUED)', title: 'Verified school projects, funded and delivered',
      preparedLabel: 'PREPARED FOR', attentionLabel: 'Attention', attention: lead.contactName || 'News desk',
      boxLabel: 'STORY', boxValue: clamp(proposal.project || project?.name || 'Chelo: the school gets the thing, not a promise', 46),
      boxRight: [kit?.spokesperson ? clamp(`Spokesperson: ${kit.spokesperson}`, 44) : 'Spokesperson available', kit?.pressEmail ? clamp(kit.pressEmail, 50) : ''],
      sections: [['The story', f('opening')], ['Why now', f('impact')], f('rationale') ? ['Facts you can use', f('rationale')] : null, ['Interview, visit, pictures', f('nextStep')]].filter(Boolean),
      footerNote: 'Facts are from Chelo records and public sources; figures are checked before release. Not under embargo.', filename: filenameFor(kind, lead), doc: labels.doc
    };
  }
  if (kind === 'school' && lead.school?.level === 'district') return require('./districts').pdfLayout(lead, proposal); // v72
  if (kind === 'school') {
    const s = lead.school || {}; const top = (lead.needs || [])[0];
    return {
      kicker: 'PROJECT BRIEF FOR THE SCHOOL', continuedKicker: 'PROJECT BRIEF (CONTINUED)', title: 'What happens next, in plain words',
      preparedLabel: 'FOR', attentionLabel: 'Attention', attention: lead.contactName || 'The Principal and the School Governing Body',
      boxLabel: 'THE NEED', boxValue: clamp(proposal.project || top?.text || project?.name || 'To be confirmed on the call', 46),
      boxRight: [clamp([s.district ? `${s.district} district` : '', lead.province].filter(Boolean).join(' · '), 44), (Number(proposal.amount) || top?.estimate || project?.targetAmount) ? `Estimate ${rand(Number(proposal.amount) || top?.estimate || project?.targetAmount)} (indicative)` : 'No cost to the school'],
      sections: [['What Chelo does', f('opening')], ['The need as we understood it', f('impact')], ['What happens next', f('rationale')], ['What the school does', f('nextStep')]],
      footerNote: 'No money passes through the school. Chelo never asks a school for a payment or banking details.', filename: filenameFor(kind, lead), doc: labels.doc
    };
  }
  const trade = tender ? (TRADE_LABELS[tender.trade] || tender.trade) : '';
  return {
    kicker: 'SCOPE OF WORKS · QUOTE REQUEST', continuedKicker: 'SCOPE OF WORKS (CONTINUED)', title: tender ? clamp(`${trade} — ${project?.recipientName || project?.name || 'school'}`, 44) : 'How quoting with Chelo works',
    preparedLabel: 'PREPARED FOR', attentionLabel: 'Attention', attention: lead.contactName || 'The owner',
    boxLabel: tender ? 'QUOTE BY' : 'STATUS', boxValue: tender ? clamp(dateZA(tender.closesAt), 40) : (lead.supplier?.vetting?.status === 'approved' ? 'Approved supplier' : 'Vetting pending'),
    boxRight: [clamp([trade, tender?.province || lead.province].filter(Boolean).join(' · '), 44), project ? clamp(project.name, 50) : ''],
    sections: [['Site and context', f('opening')], ['Scope of works', f('impact')], ['How to quote', f('rationale')], ['Payment and sign-off', f('nextStep')]],
    footerNote: 'The funder pays the supplier directly against milestones the school confirms. Chelo handles no money.', filename: filenameFor(kind, lead), doc: labels.doc
  };
}

module.exports = { FIELD_LABELS, TRADE_LABELS, fieldLabels, filenameFor, defaults, layoutFor };
