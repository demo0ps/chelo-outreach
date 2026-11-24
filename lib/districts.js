'use strict';
// v72: partnership requests to education district offices (Schools desk).
// A district office is a Schools-desk lead with school.level = 'district'. Chelo finds the office on the web
// (provincial department pages first), writes the request from DBE facts about that district, attaches a
// partnership PDF, and tracks it like any other lead. The district tile shows where the request stands.

const { OPT_OUT_FOOTER } = require('./conversion');

const clamp = (t, n) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1).trim()}…` : s; };
const PHONE_RE = /(?:\+27|0)\s?(?:\(0\)\s?)?\d{2}[\s-]?\d{3}[\s-]?\d{4}/g;
const EMAIL_RE = /[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9.-]+\.[a-z]{2,}/gi;
const BAD_LOCAL = /^(noreply|no-reply|webmaster|postmaster|abuse|privacy|popia|spam)/i;

function isDistrictLead(lead) { return (lead?.kind || 'funder') === 'school' && lead?.school?.level === 'district'; }
function officeName(district, province) { return `${district} Education District Office${province ? ` (${province})` : ''}`; }
function searchQueries(province, district) {
  return [
    `"${district}" education district office ${province} director contact`,
    `${province} department of education "${district}" district office email telephone`
  ];
}

/** Facts about the district from the DBE list + Chelo's own records. Pure; caller passes the aggregates. */
function districtStats(schoolsStore, db, province, district) {
  const rows = schoolsStore.list({ province, district, limit: 5000 }).items || [];
  const n = rows.length; const q = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }; let noFee = 0, withEmail = 0, learners = 0;
  for (const r of rows) { const m = /^Q([1-5])$/.exec(r.quintile || ''); if (m) q[m[1]] += 1; if (r.noFee) noFee += 1; if (r.email) withEmail += 1; learners += Number(r.learners) || 0; }
  const ours = db.leads.filter(l => (l.kind || 'funder') === 'school' && l.school?.level !== 'district' && l.school?.district === district && l.province === province);
  const needs = ours.flatMap(l => (l.needs || []).map(x => ({ school: l.company, text: x.text, category: x.category })));
  const projects = db.projects.filter(p => p.province === province && ours.some(l => l.id === p.schoolLeadId));
  return { schools: n, quintile: q, noFee, withEmail, learners, q13: q[1] + q[2] + q[3], schoolsOnChelo: ours.length, needsLogged: needs.length, needs: needs.slice(0, 6), projects: projects.length, projectNames: projects.slice(0, 3).map(p => p.name) };
}

/** Pick the office's email / phone / director from search hits and fetched page text. gov.za wins; generic inboxes lose. */
function pickContacts({ district, province, pages = [] }) {
  const emails = new Map(); const phones = new Map(); let director = '';
  const dLow = district.toLowerCase();
  for (const page of pages) {
    const text = String(page.text || ''); const low = text.toLowerCase();
    const near = low.includes(dLow);
    for (const e of text.match(EMAIL_RE) || []) {
      const email = e.toLowerCase(); if (BAD_LOCAL.test(email)) continue;
      let score = 1; if (/\.gov\.za$/.test(email)) score += 3; if (near) score += 1; if (email.includes(dLow.replace(/\s+/g, '')) || email.includes(dLow.split(/\s+/)[0])) score += 3; if (/^(info|enquiries|admin)@/.test(email)) score -= 1;
      emails.set(email, Math.max(emails.get(email) || 0, score));
    }
    for (const p of text.match(PHONE_RE) || []) { const digits = p.replace(/\D/g, '').replace(/^27/, '0'); if (digits.length === 10) phones.set(digits, (phones.get(digits) || 0) + (near ? 2 : 1)); }
    if (!director) { const m = /[Dd](?:istrict\s+)?[Dd]irector\s*[:\-–]\s*((?:Mr|Ms|Mrs|Dr|Prof|Adv)\.?(?:\s+[A-Z][\w'-]*){1,3})/.exec(text); if (m) director = clamp(m[1].replace(/[.,;]+$/, ''), 60); }
  }
  const best = [...emails.entries()].sort((a, b) => b[1] - a[1])[0];
  const phone = [...phones.entries()].sort((a, b) => b[1] - a[1])[0];
  return { email: best ? best[0] : '', emailScore: best ? best[1] : 0, phone: phone ? phone[0] : '', director, candidates: [...emails.keys()].slice(0, 6) };
}

/** Lead seed for the district office. `found` is pickContacts' output; `stats` is districtStats'. */
function leadSeed({ province, district, found = {}, stats = {}, source = '' }) {
  return {
    company: officeName(district, province), contactName: found.director || 'District Director', title: 'District Director', email: found.email || '', phone: found.phone || '',
    province, sector: 'Education', stage: 'New', kind: 'school', sourceName: source ? 'District office page' : 'DBE master list', sourceUrl: source,
    contactChannel: found.email ? 'email' : found.phone ? 'phone' : 'none', relationshipGoal: 'partnership',
    school: { level: 'district', district, province, stats }
  };
}

/** The partnership request, three steps like the principal ladder. */
function emailStep({ step = 1, lead, links = {}, staff = {} }) {
  const s = lead.school || {}; const st = s.stats || {}; const district = s.district || 'your district';
  const to = /^(Mr|Ms|Mrs|Dr|Prof)/.test(lead.contactName || '') ? `Dear ${lead.contactName}` : 'Dear District Director';
  const signature = `Kind regards,\n${staff.name || 'Chelo Schools Team'}\nChelo · cheloapp.com${staff.phone ? ` · ${staff.phone}` : ''}`;
  const optOut = links.optOut ? `\n\n${OPT_OUT_FOOTER}${links.optOut}` : '';
  const call = links.booking ? `You can pick a time here: ${links.booking}` : 'Reply with a time that suits you and we will come to the district office.';
  const facts = [st.schools ? `${district} has ${st.schools.toLocaleString('en-ZA')} public schools on the DBE list${st.q13 ? `, ${st.q13.toLocaleString('en-ZA')} of them quintile 1–3` : ''}${st.noFee ? ` and ${st.noFee.toLocaleString('en-ZA')} no-fee` : ''}.` : '', st.schoolsOnChelo ? `${st.schoolsOnChelo} school${st.schoolsOnChelo === 1 ? '' : 's'} in the district ${st.schoolsOnChelo === 1 ? 'is' : 'are'} already working with Chelo${st.needsLogged ? `, with ${st.needsLogged} need${st.needsLogged === 1 ? '' : 's'} logged` : ''}.` : ''].filter(Boolean).join(' ');
  if (step === 1) {
    return {
      subject: `Partnership request: verified school needs in ${district}`,
      body: `${to},\n\nChelo connects verified public-school needs with companies that fund them. We confirm the need with the principal, get quotes from vetted suppliers, find a company to pay for it, and the company pays the supplier directly against milestones the school signs off. No money passes through the school or the district.\n\n${facts ? `${facts} ` : ''}We would like to work with the district office rather than around it: agree which schools to start with, keep the circuit managers informed, and report every completed project back to you with photos and invoices.\n\nCould we have thirty minutes with you or a delegated official to agree how this would work in ${district}? ${call}\n\nA one-page partnership note is attached.\n\n${signature}${optOut}`
    };
  }
  if (step === 2) return { subject: 'Re: {subject}', body: `${to},\n\nA short follow-up on my partnership request for ${district}. We are ready to start with a small group of schools the district nominates and to report every step to your office. ${call}\n\n${signature}${optOut}` };
  return { subject: 'Re: {subject}', body: `${to},\n\nI will close this thread here. If the district would like Chelo to support its schools — this term or next — reply to this email${links.booking ? ` or book a time: ${links.booking}` : ''} and we will pick it up.\n\n${signature}${optOut}` };
}

/** Partnership-note PDF layout (pdf-engine format, same as desk-pdf). */
function pdfDefaults(lead) {
  const s = lead.school || {}; const st = s.stats || {}; const district = s.district || 'the district';
  return {
    opening: 'Chelo verifies what a public school needs, finds a company to fund it, gets quotes from vetted suppliers and pays the supplier directly against milestones the school confirms. No money passes through the school or the district office; the school gets the thing, not a promise.',
    impact: [st.schools ? `${district}: ${st.schools.toLocaleString('en-ZA')} public schools${st.q13 ? `, ${st.q13.toLocaleString('en-ZA')} quintile 1–3` : ''}${st.noFee ? `, ${st.noFee.toLocaleString('en-ZA')} no-fee` : ''} (DBE master list).` : '', st.schoolsOnChelo ? `${st.schoolsOnChelo} school${st.schoolsOnChelo === 1 ? '' : 's'} already on Chelo; ${st.needsLogged} need${st.needsLogged === 1 ? '' : 's'} logged${st.needs?.length ? ` — e.g. ${st.needs.slice(0, 3).map(n => `${n.text} (${n.school})`).join('; ')}` : ''}.` : 'No school in the district is on Chelo yet; the district nominates where to start.'].filter(Boolean).join(' '),
    rationale: 'The district nominates schools and a contact official. Chelo confirms each need with the principal, gets three quotes from vetted suppliers in the province, finds the funder, and the funder pays the supplier directly. Circuit managers are copied at each step; a completion report with photos and invoices goes to the district office.',
    nextStep: 'A thirty-minute meeting to agree the first group of schools, the district contact, and how you want to be kept informed. Chelo asks the district for no money and no data beyond what is on the public DBE list.'
  };
}
function pdfLayout(lead, proposal = {}) {
  const d = pdfDefaults(lead); const f = k => String(proposal[k] || d[k] || '').trim(); const s = lead.school || {}; const st = s.stats || {};
  return {
    kicker: 'PARTNERSHIP REQUEST · DISTRICT OFFICE', continuedKicker: 'PARTNERSHIP REQUEST (CONTINUED)', title: `Working with the ${clamp(s.district, 30)} district`,
    preparedLabel: 'PREPARED FOR', attentionLabel: 'Attention', attention: lead.contactName || 'The District Director',
    boxLabel: 'SCHOOLS', boxValue: st.schools ? `${st.schools.toLocaleString('en-ZA')} on the DBE list` : clamp(s.district, 40),
    boxRight: [clamp([s.district ? `${s.district} district` : '', lead.province].filter(Boolean).join(' · '), 44), st.q13 ? `${st.q13.toLocaleString('en-ZA')} quintile 1–3 schools` : 'No cost to the district'],
    sections: [['What Chelo does', f('opening')], ['The district as the DBE list shows it', f('impact')], ['How we would work with the office', f('rationale')], ['What we are asking for', f('nextStep')]],
    footerNote: 'Facts from the DBE master list and Chelo records. No money passes through a school or a district office.', filename: `Chelo-Partnership-Request-${clamp(s.district || 'district', 30).replace(/[^a-z0-9]+/gi, '-')}.pdf`, doc: 'Partnership request'
  };
}

/** Status for the district tile, from the office lead's flow. */
function tileStatus(lead, flowStatus = '') {
  if (!lead) return null;
  const map = { new: 'Request drafted', running: 'Preparing request', blocked: 'Needs a contact', dead: 'Declined', error: 'Needs attention', sent: 'Requested', sequence: 'Requested · following up', replied: 'They replied', booked: 'Meeting booked', call: 'Call the office', 'call-booked': 'Meeting booked', won: 'Partnered', interested: 'Interested' };
  const label = map[flowStatus] || (lead.stage === 'Won' ? 'Partnered' : lead.stage === 'Interested' ? 'Interested' : 'Requested');
  return { leadId: lead.id, status: flowStatus || 'new', label, contact: lead.email || lead.phone || '', at: lead.updatedAt || lead.createdAt || '' };
}

module.exports = { isDistrictLead, officeName, searchQueries, districtStats, pickContacts, leadSeed, emailStep, pdfDefaults, pdfLayout, tileStatus };
