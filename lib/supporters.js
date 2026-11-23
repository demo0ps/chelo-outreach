'use strict';
// v71: the Supporters desk — two kinds of account in one place.
//   ngo        → found by web discovery (profile 'ngo'), researched and written to like a funder.
//   individual → signs up on /support with what they care about; Chelo emails them when a matching project needs backing;
//                they pledge on a hosted form. Chelo records pledges; money never passes through this system.
// Also: SME invitations for the Suppliers desk (found businesses get one email with the sign-up link; they register themselves).

const crypto = require('node:crypto');
const { NEED_CATEGORIES } = require('./schools');
const { PROVINCES } = require('./suppliers');

const CATEGORY_LABELS = { classrooms: 'Classrooms', sanitation: 'Toilets & sanitation', water: 'Water', electricity: 'Electricity & solar', ict: 'Computers & ICT', library: 'Library & books', sports: 'Sports & playgrounds', furniture: 'Furniture', fencing: 'Fencing & security', kitchen: 'Kitchens & feeding', other: 'Anything a school needs' };
const BANDS = [['250', 'Up to R250'], ['1000', 'R250 – R1 000'], ['5000', 'R1 000 – R5 000'], ['25000', 'R5 000 – R25 000'], ['more', 'More than R25 000']];
const BAND_IDS = BANDS.map(b => b[0]);
const PLEDGE_STATES = ['pledged', 'received', 'withdrawn'];

function clamp(text, max) { const t = String(text || '').replace(/\s+/g, ' ').trim(); return t.length > max ? `${t.slice(0, max - 1).trim()}…` : t; }
function cleanEmail(v) { const e = String(v || '').trim().toLowerCase(); return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e) ? e : ''; }
function cleanPhone(v) { let d = String(v || '').replace(/\D/g, ''); if (d.startsWith('27') && d.length === 11) d = `0${d.slice(2)}`; return d.length >= 10 && d.length <= 11 ? d : ''; }
function categoryLabel(id) { return CATEGORY_LABELS[id] || id; }
function bandLabel(id) { return (BANDS.find(b => b[0] === id) || ['', ''])[1]; }

/** Public sign-up → lead seed. A person, so POPIA consent is the lawful basis and the record is theirs to withdraw. */
function fromSignup(body = {}) {
  const name = clamp(body.name, 100); if (name.length < 2) throw new Error('Your name is required.');
  const email = cleanEmail(body.email); if (!email) throw new Error('A valid email address is required.');
  const phone = cleanPhone(body.phone); // optional
  const provinces = [...new Set([].concat(body.provinces || []).map(String).filter(p => PROVINCES.includes(p)))];
  const categories = [...new Set([].concat(body.categories || []).map(String).filter(c => NEED_CATEGORIES.includes(c)))];
  const band = BAND_IDS.includes(String(body.band)) ? String(body.band) : '';
  if (body.consent !== true && body.consent !== 'on' && body.consent !== 'true') throw new Error('Please confirm you agree to Chelo emailing you about school projects.');
  const now = new Date().toISOString();
  return {
    company: name, contactName: name, title: 'Individual supporter', email, phone, kind: 'individual', stage: 'New', sector: 'Individual supporter', province: provinces[0] || '',
    sourceName: 'Supporter sign-up', sourceUrl: '', contactKind: 'person',
    supporter: { provinces, categories, band, town: clamp(body.town, 80), why: clamp(body.why, 300), signedUpAt: now, consentAt: now, pledges: [], told: [] }
  };
}
function isActive(lead) { return lead?.kind === 'individual' && !lead.doNotContact && !lead.suppressed; }

/** Individuals who said they care about this kind of project in this province (or anywhere / anything). */
function matchSupporters(leads, project) {
  const cat = project.needCategory || ''; const prov = project.province || '';
  return leads.filter(l => isActive(l)).map(l => {
    const sp = l.supporter || {}; const provOk = !sp.provinces?.length || !prov || sp.provinces.includes(prov); const catOk = !sp.categories?.length || !cat || sp.categories.includes(cat);
    const told = (sp.told || []).some(t => t.projectId === project.id);
    return { lead: l, provOk, catOk, told, score: (provOk ? 2 : 0) + (catOk ? 1 : 0) };
  }).filter(m => m.provOk && m.catOk).sort((a, b) => b.score - a.score || a.lead.company.localeCompare(b.lead.company));
}
function pledgeLink(origin, lead, project) { return `${origin}/pledge/${encodeURIComponent(lead.bookingToken)}?p=${encodeURIComponent(project.id)}`; }

/** The email an individual gets about a project. Short, warm, one link, no pressure. */
function supporterEmail({ project, lead, link, staff = {} }) {
  const first = String(lead.contactName || '').split(/\s+/)[0] || 'there';
  const gap = Math.max(0, Number(project.targetAmount || 0) - Number(project.committedAmount || 0));
  return {
    subject: `${clamp(project.recipientName, 60)} needs ${categoryLabel(project.needCategory || 'other').toLowerCase()} — can you help?`,
    body: `Hi ${first},\n\nYou told us you care about ${lead.supporter?.categories?.length ? lead.supporter.categories.map(c => categoryLabel(c).toLowerCase()).slice(0, 2).join(' and ') : 'schools'}${project.province ? ` in ${project.province}` : ''}. This one is verified and ready:\n\n${project.name}\n${project.recipientName}${project.province ? `, ${project.province}` : ''}\n${clamp(project.summary, 400)}\n\n${gap ? `Still needed: R ${gap.toLocaleString('en-ZA')}. ` : ''}Any amount helps — most pledges are between R250 and R1 000. Pledge here (takes a minute, no payment on this page):\n${link}\n\nWhat happens next: Chelo confirms your pledge by email with how to pay, the supplier is paid directly against milestones the school confirms, and you get the photos when it is done.\n\nThank you,\n${staff.name || 'The Chelo team'}\nChelo · cheloapp.com`
  };
}
function recordTold(lead, project, jobId = '') { lead.supporter.told = [...(lead.supporter.told || []), { projectId: project.id, at: new Date().toISOString(), jobId }].slice(-50); }

/** A pledge from the hosted form. Recorded on the person and on the project. */
function recordPledge(lead, project, body = {}) {
  const amount = Math.round(Number(String(body.amount || '').replace(/[^\d.]/g, '')));
  if (!Number.isFinite(amount) || amount < 50) throw new Error('Please enter an amount of at least R50.');
  if (amount > 5000000) throw new Error('For amounts this large please email Chelo directly.');
  const pledge = { id: `pl_${crypto.randomBytes(5).toString('hex')}`, projectId: project.id, project: project.name, leadId: lead.id, name: lead.contactName, amount, message: clamp(body.message, 300), status: 'pledged', at: new Date().toISOString() };
  lead.supporter.pledges = [...(lead.supporter.pledges || []), pledge];
  project.supporterPledges = [...(project.supporterPledges || []), { id: pledge.id, leadId: lead.id, name: lead.contactName, amount, status: 'pledged', at: pledge.at }];
  return pledge;
}
function setPledgeStatus(lead, project, pledgeId, status, actor = 'staff') {
  if (!PLEDGE_STATES.includes(status)) throw new Error('Status must be pledged, received or withdrawn.');
  const a = (lead.supporter?.pledges || []).find(p => p.id === pledgeId); const b = (project?.supporterPledges || []).find(p => p.id === pledgeId);
  if (!a) throw new Error('Pledge not found.');
  a.status = status; a.statusAt = new Date().toISOString(); a.statusBy = actor; if (b) { b.status = status; }
  return a;
}
function supporterSummary(lead) {
  const pledges = lead.supporter?.pledges || [];
  const sum = st => pledges.filter(p => !st || p.status === st).reduce((n, p) => n + p.amount, 0);
  return { told: (lead.supporter?.told || []).length, pledges: pledges.length, pledged: sum('pledged'), received: sum('received'), total: sum('pledged') + sum('received'), items: pledges.slice(-10).reverse() };
}
function projectPledges(project) {
  const list = project.supporterPledges || []; const sum = st => list.filter(p => p.status === st).reduce((n, p) => n + p.amount, 0);
  return { count: list.filter(p => p.status !== 'withdrawn').length, pledged: sum('pledged'), received: sum('received') };
}
/** What the pledge page shows — the project, nothing about other people. */
function publicPledgeView(lead, project) {
  return { name: lead.contactName, project: { id: project.id, name: project.name, recipientName: project.recipientName, province: project.province || '', summary: clamp(project.summary, 600), targetAmount: project.targetAmount || 0, committedAmount: project.committedAmount || 0, category: categoryLabel(project.needCategory || 'other') }, already: (lead.supporter?.pledges || []).filter(p => p.projectId === project.id && p.status !== 'withdrawn').map(p => ({ amount: p.amount, at: p.at })) };
}

/** Suppliers desk: one invitation to a business found on the web. They register (and consent) themselves. */
function smeInviteEmail({ candidate, link, trade, town, staff = {} }) {
  return {
    subject: `${trade} work at schools${town ? ` near ${town}` : ''} — register with Chelo`,
    body: `Hi ${candidate.contactName ? String(candidate.contactName).split(/\s+/)[0] : 'there'},\n\nChelo matches verified school projects with local suppliers. We are looking for ${trade.toLowerCase()} businesses${town ? ` around ${town}` : ''}: when a nearby school's need is funded, registered suppliers within 25 km get the quote request first, and the funder pays the supplier directly against milestones the school signs off.\n\nRegistering takes five minutes and costs nothing:\n${link}\n\nYou will be asked for your trades, where you work from, and your compliance numbers (CIPC, tax PIN, insurance). We only send work; we never sell your details.\n\nKind regards,\n${staff.name || 'Chelo Suppliers Team'}\nChelo · cheloapp.com`
  };
}

module.exports = { CATEGORY_LABELS, BANDS, BAND_IDS, PLEDGE_STATES, categoryLabel, bandLabel, fromSignup, isActive, matchSupporters, pledgeLink, supporterEmail, recordTold, recordPledge, setPledgeStatus, supporterSummary, projectPledges, publicPledgeView, smeInviteEmail };
