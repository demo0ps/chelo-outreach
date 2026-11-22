'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const geo = require('../lib/geo'); const suppliers = require('../lib/suppliers');

test('geo: towns geocode, unknown towns fall back to the province, distances are sane', () => {
  const t = geo.geocodeTown('tzaneen', 'Limpopo'); assert.equal(t.precision, 'town'); assert.equal(t.province, 'Limpopo');
  const p = geo.geocodeTown('Nowhereville', 'Limpopo'); assert.equal(p.precision, 'province'); assert.ok(p.lat);
  const d = geo.distanceKm(geo.geocodeTown('Johannesburg'), geo.geocodeTown('Pretoria')); assert.ok(d > 45 && d < 70, `Jhb–Pta ${d} km`);
  assert.ok(geo.inSouthAfrica(-26.2, 28.0)); assert.ok(!geo.inSouthAfrica(51.5, -0.1));
  assert.equal(geo.nearestTown({ lat: -23.9, lng: 29.47 }), 'Polokwane');
});

const sup = (company, town, extra = {}) => {
  const seed = suppliers.fromSignup({ company, contactName: 'Pat Dube', email: `${company.replace(/\W/g, '').toLowerCase()}@github.com`, phone: '0825551234', trades: ['water'], provinces: ['Gauteng'], town, consent: true, ...extra });
  return { id: `lead_${company.replace(/\W/g, '')}`, ...seed, supplier: { ...seed.supplier, vetting: { status: 'approved', by: 't', at: 'x' } } };
};

test('suppliers: sign-up captures location (town or GPS) and declared documents; staff mark documents received with expiry', () => {
  const a = sup('Soweto Water', 'Soweto', { taxPin: 'ABC123', insurer: 'Santam', insuranceExpires: '2027-03-01' });
  assert.equal(a.supplier.location.source, 'town'); assert.equal(a.supplier.location.radiusKm, 50);
  const b = sup('GPS Boreholes', 'Some Farm', { lat: -26.25, lng: 27.9 }); assert.equal(b.supplier.location.source, 'gps');
  const c = sup('Lost Co', 'Unknown Dorp'); assert.equal(c.supplier.location.source, 'province');
  assert.throws(() => sup('No Town', ''), /Town/);
  let ds = suppliers.documentStatus(a); assert.equal(ds.items.find(d => d.key === 'tax').state, 'declared'); assert.equal(ds.insured, false); assert.equal(ds.complete, false);
  suppliers.setDocument(a, 'insurance', { status: 'received', ref: 'Santam', expiresAt: '2027-03-01', actor: 'Lerato' });
  ds = suppliers.documentStatus(a, new Date('2026-10-25')); assert.equal(ds.insured, true); assert.equal(ds.insuranceState, 'received');
  ds = suppliers.documentStatus(a, new Date('2027-02-10')); assert.equal(ds.insuranceState, 'expiring'); assert.equal(ds.insured, true);
  ds = suppliers.documentStatus(a, new Date('2027-04-01')); assert.equal(ds.insuranceState, 'expired'); assert.equal(ds.insured, false); assert.equal(ds.expired, 1);
  assert.throws(() => suppliers.setDocument(a, 'tax', { status: 'received', expiresAt: 'soon' }), /date/);
  assert.throws(() => suppliers.setDocument(a, 'nope', { status: 'received' }), /Unknown/);
});

test('waves: nearest ring first, widening after 48 h only while quotes are short, supplier radius respected', () => {
  const school = geo.geocodeTown('Soweto'); // the project point
  const near = sup('Soweto Water', 'Soweto'); const mid = sup('Pretoria Pumps', 'Pretoria', { radiusKm: 100 }); const far = sup('Vaal Tanks', 'Vereeniging', { radiusKm: 25 }); const lost = sup('Lost Co', 'Unknown Dorp');
  const leads = [near, mid, far, lost];
  const ranked = suppliers.rankSuppliers(leads, { trade: 'water', province: 'Gauteng', point: school });
  assert.deepEqual(ranked.list.map(x => x.lead.company), ['Soweto Water', 'Pretoria Pumps', 'Vaal Tanks', 'Lost Co']);
  assert.equal(ranked.list[0].ring, 0); assert.equal(ranked.list[1].ring, 1);
  assert.equal(ranked.list[2].ring, 2, 'Vereeniging is ~50 km away but only travels 25 km — province wave only');
  assert.equal(ranked.list[3].ring, 2, 'unknown town → province wave');
  assert.deepEqual(ranked.rings.map(r => r.count), [1, 2, 4]);

  const project = { id: 'p1', name: 'Water — Sizanani', recipientName: 'Sizanani Primary', province: 'Gauteng', summary: 'Two 5000 l tanks.' };
  const t = suppliers.openTender(project, { trade: 'water', province: 'Gauteng', point: school });
  const t0 = new Date('2026-10-25T08:00:00Z');
  assert.equal(suppliers.dueWave(t, t0), 0);
  let members = suppliers.waveMembers(ranked, 0, t); assert.deepEqual(members.map(m => m.lead.company), ['Soweto Water']);
  suppliers.recordWave(t, 0, members, t0); assert.equal(t.sentTo.length, 1); assert.equal(t.waves[0].label, 'within 25 km');
  assert.equal(suppliers.dueWave(t, new Date(t0.getTime() + 24 * 3600e3)), null, 'not yet 48 h');
  assert.equal(suppliers.dueWave(t, new Date(t0.getTime() + 49 * 3600e3)), 1);
  members = suppliers.waveMembers(ranked, 1, t); assert.deepEqual(members.map(m => m.lead.company), ['Pretoria Pumps'], 'already-sent suppliers are not emailed twice');
  suppliers.recordWave(t, 1, members, new Date(t0.getTime() + 49 * 3600e3));
  for (let i = 0; i < 3; i += 1) t.quotes.push({ id: `q${i}`, supplierId: 'x', amount: 1000, status: 'submitted' });
  assert.equal(suppliers.dueWave(t, new Date(t0.getTime() + 200 * 3600e3)), null, 'three quotes in — no province-wide wave');
  t.quotes.length = 1;
  assert.equal(suppliers.dueWave(t, new Date(t0.getTime() + 100 * 3600e3)), 2);
  members = suppliers.waveMembers(ranked, 2, t); assert.deepEqual(members.map(m => m.lead.company).sort(), ['Lost Co', 'Vaal Tanks']);
  suppliers.recordWave(t, 2, members); assert.equal(suppliers.dueWave(t, new Date(t0.getTime() + 300 * 3600e3)), null, 'no rings left');
  const mail = suppliers.broadcastEmail({ project, tender: t, supplier: near, link: 'https://x/q', distanceKm: 4 }); assert.match(mail.body, /about 4 km from you/);
});

test('account: awarded vs completed, net of fee, places', () => {
  const s = sup('Soweto Water', 'Soweto'); s.id = 'lead_s';
  const p1 = { id: 'p1', name: 'Water — A', recipientName: 'A Primary', province: 'Gauteng', location: { town: 'Soweto', district: 'Johannesburg Central' }, tender: { trade: 'water', status: 'done', feePct: 5, awardedQuoteId: 'q1', completedAt: '2026-09-01', sentTo: [{ id: 'lead_s' }], quotes: [{ id: 'q1', supplierId: 'lead_s', amount: 100000, status: 'signed', submittedAt: '2026-08-01' }] } };
  const p2 = { id: 'p2', name: 'Water — B', recipientName: 'B Primary', province: 'Gauteng', location: { town: 'Tembisa', district: 'Ekurhuleni North' }, tender: { trade: 'water', status: 'awarded', feePct: null, awardedQuoteId: 'q2', sentTo: [{ id: 'lead_s' }], quotes: [{ id: 'q2', supplierId: 'lead_s', amount: 50000, status: 'signed', submittedAt: '2026-10-01' }] } };
  const p3 = { id: 'p3', name: 'Water — C', recipientName: 'C Primary', province: 'Gauteng', tender: { trade: 'water', status: 'open', sentTo: [{ id: 'lead_s' }], quotes: [] } };
  const a = suppliers.supplierSummary(s, [p1, p2, p3]);
  assert.equal(a.invited, 3); assert.equal(a.quotes, 2); assert.equal(a.signed, 2); assert.equal(a.done, 1);
  assert.equal(a.awardedValue, 150000); assert.equal(a.feesTotal, 5000); assert.equal(a.awardedNet, 145000); assert.equal(a.doneValue, 100000);
  assert.deepEqual(a.places, ['Johannesburg Central']); assert.equal(a.items[0].project, 'Water — B');
});
