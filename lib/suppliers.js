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
const geo = require('./geo');
// v69: the vetting pack. Suppliers declare numbers on sign-up ("declared"); staff tick "received" once the actual document
// has been seen. Items with an expiry go "expiring" 30 days out and "expired" after. Insurance is the one funders ask about.
const DOCUMENTS = [
  ['cipc', 'CIPC registration', false], ['tax', 'Tax clearance PIN (SARS)', true], ['csd', 'CSD registration', true], ['insurance', 'Public liability insurance', true],
  ['bbbee', 'B-BBEE certificate or affidavit', true], ['bank', 'Bank confirmation letter', false], ['ownerId', 'ID of owner / director', false]
];
const DOC_IDS = DOCUMENTS.map(d => d[0]);
const DOC_STATES = ['missing', 'declared', 'received'];
// v69: distance rings. The nearest registered suppliers hear first; if too few quotes arrive the next ring is added.
const RINGS = [{ km: 25, label: 'within 25 km' }, { km: 75, label: 'within 75 km' }, { km: null, label: 'whole province' }];
const WAVE_HOURS = 48; const TARGET_QUOTES = 3;
const RADII = [25, 50, 100, 200, 0]; // 0 = anywhere in my provinces

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
  const town = clamp(body.town, 80); if (town.length < 2) throw new Error('Town or suburb is required so we can match you to schools near you.');
  const postcode = String(body.postcode || '').replace(/\D/g, '').slice(0, 4);
  const radiusKm = RADII.includes(Number(body.radiusKm)) ? Number(body.radiusKm) : 50;
  const gLat = Number(body.lat), gLng = Number(body.lng); const gps = geo.inSouthAfrica(gLat, gLng);
  const geocoded = geo.geocodeTown(town, provinces[0]);
  const location = gps ? { lat: Number(gLat.toFixed(4)), lng: Number(gLng.toFixed(4)), town: geocoded.town || town, postcode, province: provinces[0], source: 'gps', radiusKm }
    : { lat: geocoded.lat, lng: geocoded.lng, town, postcode, province: provinces[0], source: geocoded.precision === 'town' ? 'town' : geocoded.precision === 'province' ? 'province' : 'none', radiusKm };
  const declared = (ref, extra = {}) => (ref ? { status: 'declared', ref: clamp(ref, 60), at: new Date().toISOString(), by: 'sign-up', ...extra } : { status: 'missing', ref: '' });
  const insuranceExpires = /^\d{4}-\d{2}-\d{2}$/.test(String(body.insuranceExpires || '')) ? String(body.insuranceExpires) : '';
  const documents = {
    cipc: declared(body.regNo), tax: declared(body.taxPin), csd: declared(body.csd), insurance: declared(body.insurer, { expiresAt: insuranceExpires }),
    bbbee: declared(body.bbbeeLevel ? `Level ${String(body.bbbeeLevel).replace(/\D/g, '').slice(0, 1) || '?'}` : ''), bank: { status: 'missing', ref: '' }, ownerId: { status: 'missing', ref: '' }
  };
  return {
    company, contactName, title: clamp(body.title, 80) || 'Owner', email, phone, kind: 'supplier', stage: 'New', sector: 'Supplier', province: provinces[0],
    sourceName: 'Supplier sign-up', sourceUrl: '', website: clamp(body.website, 200),
    supplier: { trades, provinces, regNo: clamp(body.regNo, 40), csd: clamp(body.csd, 40), yearsTrading: Math.max(0, Math.min(99, Number(body.yearsTrading) || 0)), references: clamp(body.references, 600), vetting: { status: 'pending', notes: '', by: '', at: '' }, location, documents, signedUpAt: new Date().toISOString(), consentAt: new Date().toISOString(), quotes: 0, awarded: 0 }
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
/** v69: staff record a document as seen (received), declared or missing, with an expiry where the document has one. */
function setDocument(lead, key, { status, ref = '', expiresAt = '', actor = 'staff' }) {
  if (!DOC_IDS.includes(key)) throw new Error('Unknown document.');
  if (!DOC_STATES.includes(status)) throw new Error('Status must be missing, declared or received.');
  const hasExpiry = DOCUMENTS.find(d => d[0] === key)[2];
  if (expiresAt && !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) throw new Error('Expiry must be a date (YYYY-MM-DD).');
  lead.supplier.documents = lead.supplier.documents || {};
  lead.supplier.documents[key] = { status, ref: clamp(ref, 60), expiresAt: hasExpiry ? expiresAt : '', at: new Date().toISOString(), by: actor };
  return lead.supplier.documents[key];
}
/** Effective state per document and a one-line summary. */
function documentStatus(lead, now = new Date()) {
  const docs = lead?.supplier?.documents || {}; const soon = now.getTime() + 30 * 86400000;
  const items = DOCUMENTS.map(([key, label, hasExpiry]) => {
    const d = docs[key] || { status: 'missing', ref: '' }; let state = d.status || 'missing';
    if (state === 'received' && hasExpiry && d.expiresAt) { const t = Date.parse(d.expiresAt); if (t < now.getTime()) state = 'expired'; else if (t < soon) state = 'expiring'; }
    return { key, label, hasExpiry, state, ref: d.ref || '', expiresAt: d.expiresAt || '', at: d.at || '', by: d.by || '' };
  });
  const count = st => items.filter(i => i.state === st).length;
  const insurance = items.find(i => i.key === 'insurance');
  return { items, received: count('received') + count('expiring'), expiring: count('expiring'), expired: count('expired'), missing: count('missing') + count('declared'), complete: items.every(i => i.state === 'received' || i.state === 'expiring'), insured: ['received', 'expiring'].includes(insurance.state), insuranceState: insurance.state };
}
function isApproved(lead) { return (lead?.kind === 'supplier') && lead.supplier?.vetting?.status === 'approved' && !lead.doNotContact; }
/** Approved suppliers for a trade in a province ('' province = any). */
function matchSuppliers(leads, { trade, province = '' }) {
  return leads.filter(l => isApproved(l) && (l.supplier.trades || []).includes(trade) && (!province || (l.supplier.provinces || []).includes(province)));
}
/** v69: matched suppliers with distance from the school, nearest first; each tagged with the first ring that reaches them. */
function rankSuppliers(leads, { trade, province = '', point = null }) {
  const list = matchSuppliers(leads, { trade, province }).map(l => {
    const loc = l.supplier.location || {}; const d = point ? geo.distanceKm(point, loc) : null;
    const reach = loc.radiusKm || 0; // 0 = anywhere in their provinces
    let ring = RINGS.length - 1;
    if (d !== null && loc.source !== 'province') for (let i = 0; i < RINGS.length - 1; i += 1) if (d <= RINGS[i].km && (!reach || d <= reach)) { ring = i; break; }
    return { lead: l, distanceKm: d, ring, town: loc.town || '', located: loc.source === 'gps' || loc.source === 'town' };
  });
  list.sort((a, b) => (a.ring - b.ring) || (Number(b.located) - Number(a.located)) || ((a.distanceKm ?? 9e9) - (b.distanceKm ?? 9e9)) || a.lead.company.localeCompare(b.lead.company));
  const rings = RINGS.map((r, i) => ({ ...r, count: list.filter(x => x.ring <= i).length }));
  return { list, rings, located: Boolean(point) };
}
/** Which ring should go out now? null when nothing is due. Rings widen only while quotes are short of the target. */
function dueWave(tender, now = new Date()) {
  if (!tender || tender.status !== 'open' || new Date(tender.closesAt).getTime() <= now.getTime()) return null;
  const waves = tender.waves || []; const next = waves.length ? Math.max(...waves.map(w => w.ring)) + 1 : 0;
  if (next >= RINGS.length) return null;
  if (!waves.length) return 0;
  if ((tender.quotes || []).length >= (tender.targetQuotes || TARGET_QUOTES)) return null;
  const last = Date.parse(waves[waves.length - 1].sentAt || 0);
  return now.getTime() - last >= WAVE_HOURS * 3600000 ? next : null;
}
/** Members of a ring not yet written to. */
function waveMembers(ranked, ring, tender) {
  const sent = new Set((tender?.sentTo || []).map(x => x.id));
  return ranked.list.filter(x => x.ring <= ring && !sent.has(x.lead.id));
}
function recordWave(tender, ring, members, now = new Date()) {
  tender.waves = tender.waves || [];
  tender.waves.push({ ring, label: RINGS[ring].label, sentAt: now.toISOString(), count: members.length });
  for (const m of members) tender.sentTo.push({ id: m.lead.id, company: m.lead.company, email: m.lead.email, at: now.toISOString(), wave: ring, distanceKm: m.distanceKm });
  tender.nextWaveAt = ring < RINGS.length - 1 ? new Date(now.getTime() + WAVE_HOURS * 3600000).toISOString() : '';
  return tender;
}

// ---------- tender on a Verified Project ----------
function openTender(project, { trade, province = '', closesInDays = 7, brief = '', actor = 'staff', suppliers = [], point = null }) {
  if (!TRADE_IDS.includes(trade)) throw new Error('Pick a trade.');
  if (project.tender && ['open'].includes(project.tender.status)) throw new Error('A need is already out to suppliers for this project. Close it first.');
  const days = Math.max(1, Math.min(60, Number(closesInDays) || 7));
  if (project.tender) project.tenderHistory = [...(project.tenderHistory || []), project.tender].slice(-10); // earlier rounds stay on the record
  project.tender = {
    id: `tender_${crypto.randomBytes(4).toString('hex')}`, token: token(), trade, province: province || project.province || '', brief: clamp(brief, 1200) || clamp(project.summary, 1200),
    status: 'open', openedAt: new Date().toISOString(), openedBy: actor, closesAt: new Date(Date.now() + days * 86400000).toISOString(),
    sentTo: suppliers.map(s => ({ id: s.id, company: s.company, email: s.email, at: '' })), quotes: [], awardedQuoteId: '', feePct: null, completedAt: '', confirmedBy: '', history: [],
    point: point && Number.isFinite(point.lat) ? { lat: point.lat, lng: point.lng } : null, waves: [], nextWaveAt: '', targetQuotes: TARGET_QUOTES
  };
  return project.tender;
}
function quoteLink(origin, tender, supplierId = '') { return `${origin}/quote/${encodeURIComponent(tender.token)}${supplierId ? `?s=${encodeURIComponent(supplierId)}` : ''}`; }
/** The email each matched supplier receives. Business-to-business, plain, one link. */
function broadcastEmail({ project, tender, supplier, link, staff = {}, distanceKm = null }) {
  const close = new Date(tender.closesAt).toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' });
  return {
    subject: `Quote request: ${tradeLabel(tender.trade)} — ${clamp(project.recipientName, 60)}${tender.province ? `, ${tender.province}` : ''}`,
    body: `Hi ${String(supplier.contactName || '').split(/\s+/)[0] || 'there'},\n\nA verified school need matches your trade (${tradeLabel(tender.trade)})${Number.isFinite(distanceKm) ? ` about ${distanceKm} km from you` : ` in ${tender.province || 'your province'}`}:\n\n${project.name}\n${project.recipientName}${project.province ? `, ${project.province}` : ''}\n${tender.brief}\n\nIf you can do this work, please send your quote on this short form by ${close}:\n${link}\n\nWhat happens next: Chelo shortlists with the school, one supplier is signed, and the funder pays the supplier directly against milestones the school confirms. There is no fee to quote.\n\nKind regards,\n${staff.name || 'Chelo Suppliers Team'}\nChelo · cheloapp.com${staff.phone ? ` · ${staff.phone}` : ''}`
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
/** v69: the supplier's account — what they quoted, won and finished, where, and what it was worth (gross and after Chelo's fee). */
function supplierSummary(lead, projects, now = new Date()) {
  const mine = [];
  for (const p of projects) {
    const rounds = [p.tender, ...(p.tenderHistory || [])].filter(Boolean);
    for (const t of rounds) for (const q of (t.quotes || [])) if (q.supplierId === lead.id) {
      const fee = q.status === 'signed' && t.feePct !== null && t.feePct !== undefined ? Math.round(q.amount * Number(t.feePct) / 100) : 0;
      mine.push({ projectId: p.id, project: p.name, school: p.recipientName, province: p.province || '', district: p.location?.district || '', town: p.location?.town || '', amount: q.amount, fee, net: q.amount - fee, status: q.status, at: q.submittedAt, signedAt: q.statusAt || '', done: t.status === 'done' && t.awardedQuoteId === q.id, doneAt: t.status === 'done' && t.awardedQuoteId === q.id ? t.completedAt : '', trade: t.trade });
    }
  }
  const signed = mine.filter(m => m.status === 'signed'); const done = mine.filter(m => m.done);
  const sum = (arr, k) => arr.reduce((n, m) => n + (Number(m[k]) || 0), 0);
  const invited = projects.filter(p => [p.tender, ...(p.tenderHistory || [])].some(t => (t?.sentTo || []).some(x => x.id === lead.id))).length;
  const places = [...new Set(done.map(m => m.district || m.town || m.province).filter(Boolean))];
  return {
    invited, quotes: mine.length, signed: signed.length, done: done.length,
    awardedValue: sum(signed, 'amount'), awardedNet: sum(signed, 'net'), doneValue: sum(done, 'amount'), doneNet: sum(done, 'net'), feesTotal: sum(signed, 'fee'),
    places, items: mine.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 20), documents: documentStatus(lead, now), location: lead.supplier?.location || null
  };
}

module.exports = { DOCUMENTS, DOC_IDS, DOC_STATES, RINGS, RADII, WAVE_HOURS, TARGET_QUOTES, setDocument, documentStatus, rankSuppliers, dueWave, waveMembers, recordWave, TRADES, TRADE_IDS, NEED_TO_TRADE, PROVINCES, VETTING, QUOTE_STATES, TENDER_STATES, tradeLabel, fromSignup, setVetting, isApproved, matchSuppliers, openTender, quoteLink, broadcastEmail, tenderOpen, submitQuote, setQuoteStatus, closeTender, confirmDone, publicTender, supplierSummary };
