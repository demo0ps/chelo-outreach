'use strict';
// Four Desks — Release 4 (v63): the Suppliers desk. Suppliers arrive through a public sign-up page and are vetted by staff.
// A Verified Project's need is broadcast to approved suppliers by trade + province; each replies on a hosted quote form;
// staff shortlist and sign one; the school confirms the work is done. Money moves on another platform — Chelo records only
// an optional fee % on the signed quote. Pure logic; the server supplies storage, email and HTML plumbing.
const crypto = require('node:crypto');

const TRADES = [
  ['building', 'Building & classrooms'], ['sanitation', 'Toilets & plumbing'], ['water', 'Water tanks & boreholes'], ['electrical', 'Electrical & solar'],
  ['ict', 'Computers & ICT'], ['furniture', 'Furniture & fittings'], ['fencing', 'Fencing & security'], ['roofing', 'Roofing & paint'], ['kitchen', 'Kitchens & feeding'], ['landscaping', 'Grounds & sports'], ['other', 'Other']
];
const TRADE_IDS = TRADES.map(t => t[0]);
const NEED_TO_TRADE = { classrooms: 'building', sanitation: 'sanitation', water: 'water', electricity: 'electrical', ict: 'ict', library: 'building', sports: 'landscaping', furniture: 'furniture', fencing: 'fencing', kitchen: 'kitchen', other: 'other' };
const PROVINCES = ['Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape', 'Western Cape'];
const VETTING = ['pending', 'approved', 'rejected'];
const QUOTE_STATES = ['submitted', 'shortlisted', 'signed', 'declined'];
const TENDER_STATES = ['open', 'closed', 'awarded', 'done'];

function clamp(text, max) { const t = String(text || '').replace(/\s+/g, ' ').trim(); return t.length > max ? `${t.slice(0, max - 1).trim()}…` : t; }
function cleanEmail(v) { const e = String(v || '').trim().toLowerCase(); return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e) ? e : ''; }
function cleanPhone(v) { let d = String(v || '').replace(/\D/g, ''); if (d.startsWith('27') && d.length === 11) d = `0${d.slice(2)}`; return d.length >= 10 && d.length <= 11 ? d : ''; }
function token() { return crypto.randomBytes(12).toString('base64url'); }
function tradeLabel(id) { return (TRADES.find(t => t[0] === id) || ['', id])[1]; }

/** Public sign-up → a supplier target (kind = 'supplier', vetting pending). Throws a plain-English error on bad input. */
function fromSignup(body = {}) {
  const company = clamp(body.company, 120); if (company.length < 2) throw new Error('Company name is required.');
  const contactName = clamp(body.contactName, 100); if (contactName.length < 2) throw new Error('Contact person is required.');
  const email = cleanEmail(body.email); if (!email) throw new Error('A valid business email is required.');
  const phone = cleanPhone(body.phone); if (!phone) throw new Error('A valid South African phone number is required.');
  const trades = [...new Set([].concat(body.trades || []).map(String).filter(t => TRADE_IDS.includes(t)))]; if (!trades.length) throw new Error('Pick at least one trade.');
  const provinces = [...new Set([].concat(body.provinces || []).map(String).filter(p => PROVINCES.includes(p)))]; if (!provinces.length) throw new Error('Pick at least one province you work in.');
  if (body.consent !== true && body.consent !== 'on' && body.consent !== 'true') throw new Error('Please confirm you agree to Chelo keeping these business details to send you project needs.');
  return {
    company, contactName, title: clamp(body.title, 80) || 'Owner', email, phone, kind: 'supplier', stage: 'New', sector: 'Supplier', province: provinces[0],
    sourceName: 'Supplier sign-up', sourceUrl: '', website: clamp(body.website, 200),
    supplier: { trades, provinces, regNo: clamp(body.regNo, 40), csd: clamp(body.csd, 40), yearsTrading: Math.max(0, Math.min(99, Number(body.yearsTrading) || 0)), references: clamp(body.references, 600), vetting: { status: 'pending', notes: '', by: '', at: '' }, signedUpAt: new Date().toISOString(), consentAt: new Date().toISOString(), quotes: 0, awarded: 0 }
  };
}
function setVetting(lead, { status, notes = '', actor = 'staff' }) {
  if (!VETTING.includes(status)) throw new Error(`Vetting status must be one of ${VETTING.join(', ')}.`);
  lead.supplier = lead.supplier || { trades: [], provinces: [], vetting: {} };
  lead.supplier.vetting = { status, notes: clamp(notes, 600), by: actor, at: new Date().toISOString() };
  if (status === 'approved') lead.stage = 'Interested';
  else if (status === 'rejected') lead.stage = 'Not proceeding';
  else lead.stage = 'New';
  return lead.supplier.vetting;
}
function isApproved(lead) { return (lead?.kind === 'supplier') && lead.supplier?.vetting?.status === 'approved' && !lead.doNotContact; }
/** Approved suppliers for a trade in a province ('' province = any). */
function matchSuppliers(leads, { trade, province = '' }) {
  return leads.filter(l => isApproved(l) && (l.supplier.trades || []).includes(trade) && (!province || (l.supplier.provinces || []).includes(province)));
}

// ---------- tender on a Verified Project ----------
function openTender(project, { trade, province = '', closesInDays = 7, brief = '', actor = 'staff', suppliers = [] }) {
  if (!TRADE_IDS.includes(trade)) throw new Error('Pick a trade.');
  if (project.tender && ['open'].includes(project.tender.status)) throw new Error('A need is already out to suppliers for this project. Close it first.');
  const days = Math.max(1, Math.min(60, Number(closesInDays) || 7));
  if (project.tender) project.tenderHistory = [...(project.tenderHistory || []), project.tender].slice(-10); // earlier rounds stay on the record
  project.tender = {
    id: `tender_${crypto.randomBytes(4).toString('hex')}`, token: token(), trade, province: province || project.province || '', brief: clamp(brief, 1200) || clamp(project.summary, 1200),
    status: 'open', openedAt: new Date().toISOString(), openedBy: actor, closesAt: new Date(Date.now() + days * 86400000).toISOString(),
    sentTo: suppliers.map(s => ({ id: s.id, company: s.company, email: s.email, at: '' })), quotes: [], awardedQuoteId: '', feePct: null, completedAt: '', confirmedBy: '', history: []
  };
  return project.tender;
}
function quoteLink(origin, tender, supplierId = '') { return `${origin}/quote/${encodeURIComponent(tender.token)}${supplierId ? `?s=${encodeURIComponent(supplierId)}` : ''}`; }
/** The email each matched supplier receives. Business-to-business, plain, one link. */
function broadcastEmail({ project, tender, supplier, link, staff = {} }) {
  const close = new Date(tender.closesAt).toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' });
  return {
    subject: `Quote request: ${tradeLabel(tender.trade)} — ${clamp(project.recipientName, 60)}${tender.province ? `, ${tender.province}` : ''}`,
    body: `Hi ${String(supplier.contactName || '').split(/\s+/)[0] || 'there'},\n\nA verified school need matches your trade (${tradeLabel(tender.trade)}) in ${tender.province || 'your province'}:\n\n${project.name}\n${project.recipientName}${project.province ? `, ${project.province}` : ''}\n${tender.brief}\n\nIf you can do this work, please send your quote on this short form by ${close}:\n${link}\n\nWhat happens next: Chelo shortlists with the school, one supplier is signed, and the funder pays the supplier directly against milestones the school confirms. There is no fee to quote.\n\nKind regards,\n${staff.name || 'Chelo Suppliers Team'}\nChelo · cheloapp.com${staff.phone ? ` · ${staff.phone}` : ''}`
  };
}
function tenderOpen(tender, now = new Date()) { return tender && tender.status === 'open' && new Date(tender.closesAt).getTime() > now.getTime(); }
/** A quote from the hosted form. One live quote per supplier (a resubmission replaces it). */
function submitQuote(tender, body = {}, { supplier = null, now = new Date() } = {}) {
  if (!tenderOpen(tender, now)) throw new Error('This quote request has closed.');
  const amount = Math.round(Number(String(body.amount || '').replace(/[^\d.]/g, '')) || 0); if (amount <= 0) throw new Error('Enter the total quote amount in rand.');
  const company = clamp(body.company || supplier?.company, 120); if (company.length < 2) throw new Error('Company name is required.');
  const email = cleanEmail(body.email || supplier?.email); if (!email) throw new Error('A valid business email is required.');
  const leadTimeDays = Math.max(1, Math.min(365, Number(body.leadTimeDays) || 0)); if (!leadTimeDays) throw new Error('How many days will the work take?');
  const q = { id: `q_${crypto.randomBytes(4).toString('hex')}`, supplierId: supplier?.id || '', company, email, contactName: clamp(body.contactName || supplier?.contactName, 100), phone: cleanPhone(body.phone || supplier?.phone), amount, leadTimeDays, validDays: Math.max(7, Math.min(180, Number(body.validDays) || 30)), notes: clamp(body.notes, 1500), attachmentsUrl: clamp(body.attachmentsUrl, 300), status: 'submitted', submittedAt: now.toISOString() };
  tender.quotes = (tender.quotes || []).filter(x => !(x.supplierId && x.supplierId === q.supplierId && x.status === 'submitted') && !(x.email === q.email && x.status === 'submitted'));
  tender.quotes.push(q);
  const sent = tender.sentTo.find(s => s.id === q.supplierId); if (sent) sent.quotedAt = q.submittedAt;
  return q;
}
function setQuoteStatus(project, quoteId, { status, feePct = null, actor = 'staff' }) {
  const tender = project.tender; if (!tender) throw new Error('No quote request on this project.');
  if (!QUOTE_STATES.includes(status)) throw new Error(`Quote status must be one of ${QUOTE_STATES.join(', ')}.`);
  const q = (tender.quotes || []).find(x => x.id === quoteId); if (!q) throw new Error('Quote not found.');
  if (tender.status === 'done') throw new Error('This project is already confirmed done.');
  if (status === 'signed') {
    if (tender.awardedQuoteId && tender.awardedQuoteId !== q.id) throw new Error('Another quote is already signed. Decline it first.');
    const fee = feePct === null || feePct === '' ? null : Math.max(0, Math.min(30, Number(feePct)));
    if (feePct !== null && feePct !== '' && !Number.isFinite(fee)) throw new Error('Fee % must be a number between 0 and 30.');
    tender.awardedQuoteId = q.id; tender.feePct = fee; tender.status = 'awarded'; tender.signedAt = new Date().toISOString(); tender.signedBy = actor;
    for (const other of tender.quotes) if (other.id !== q.id && other.status !== 'declined') other.status = 'declined';
    project.supplierId = q.supplierId || ''; project.supplierName = q.company; project.supplierAmount = q.amount; project.status = 'Supplier signed · In delivery';
  } else if (status === 'declined' && tender.awardedQuoteId === q.id) { tender.awardedQuoteId = ''; tender.feePct = null; tender.status = tenderOpen(tender) ? 'open' : 'closed'; project.status = 'Verified · Seeking Partners'; delete project.supplierId; delete project.supplierName; delete project.supplierAmount; }
  q.status = status; q.statusAt = new Date().toISOString(); q.statusBy = actor;
  tender.history = [...(tender.history || []), { at: q.statusAt, by: actor, quoteId: q.id, status }].slice(-30);
  return q;
}
function closeTender(tender, actor = 'staff') { if (tender.status === 'open') { tender.status = 'closed'; tender.closedAt = new Date().toISOString(); tender.closedBy = actor; } return tender; }
/** The school says the work is done. Recorded by staff from the principal's confirmation (phone or email). */
function confirmDone(project, { confirmedBy, notes = '', actor = 'staff' }) {
  const tender = project.tender; if (!tender || tender.status !== 'awarded') throw new Error('Sign a supplier first; the school confirms when the work is done.');
  const who = clamp(confirmedBy, 120); if (!who) throw new Error('Who at the school confirmed? (e.g. "Principal, by phone")');
  tender.status = 'done'; tender.completedAt = new Date().toISOString(); tender.confirmedBy = who; tender.completionNotes = clamp(notes, 600); tender.completedBy = actor;
  project.status = 'Delivered · School confirmed';
  project.deliveredAt = tender.completedAt;
  return tender;
}
/** Public view of a tender for the quote page — no other suppliers' quotes, no staff names. */
function publicTender(project, tender) {
  return { token: tender.token, status: tenderOpen(tender) ? 'open' : 'closed', trade: tender.trade, tradeLabel: tradeLabel(tender.trade), province: tender.province, closesAt: tender.closesAt, project: { name: project.name, recipientName: project.recipientName, province: project.province, brief: tender.brief } };
}
function supplierSummary(lead, projects) {
  const mine = []; for (const p of projects) for (const q of (p.tender?.quotes || [])) if (q.supplierId === lead.id) mine.push({ projectId: p.id, project: p.name, amount: q.amount, status: q.status, at: q.submittedAt, done: p.tender.status === 'done' && p.tender.awardedQuoteId === q.id });
  return { quotes: mine.length, signed: mine.filter(m => m.status === 'signed').length, done: mine.filter(m => m.done).length, items: mine.slice(-10).reverse() };
}

module.exports = { TRADES, TRADE_IDS, NEED_TO_TRADE, PROVINCES, VETTING, QUOTE_STATES, TENDER_STATES, tradeLabel, fromSignup, setVetting, isApproved, matchSuppliers, openTender, quoteLink, broadcastEmail, tenderOpen, submitQuote, setQuoteStatus, closeTender, confirmDone, publicTender, supplierSummary };
