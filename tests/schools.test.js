// Four Desks — Release 3 (v62): Schools desk. DBE master list in its own table (bundled Q2 2025 + CSV upload with the official
// headers), district-first tree, school → target, email where published / call task with script otherwise, needs → Verified Project.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const schools = require('../lib/schools');

const ROOT = path.join(__dirname, '..');
function startServer(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => reject(new Error(`server did not start: ${out}`)), 15000);
    child.stdout.on('data', chunk => { out += chunk; if (/running at/.test(out)) { clearTimeout(timer); resolve(child); } });
    child.stderr.on('data', chunk => { out += chunk; });
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${out}`)); });
  });
}
function client(base, desk = '') {
  const jar = { cookie: '', csrf: '' };
  return async (method, url, body, extra = {}) => {
    const raw = typeof body === 'string';
    const headers = { 'Content-Type': raw ? 'text/csv' : 'application/json', Origin: base, ...(desk ? { 'X-Chelo-Desk': desk } : {}), ...extra };
    if (jar.cookie) headers.Cookie = jar.cookie;
    if (jar.csrf) headers['X-CSRF-Token'] = jar.csrf;
    const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) jar.cookie = setCookie.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    const payload = ct.includes('application/json') ? await res.json() : await res.text();
    if (payload && payload.csrfToken) jar.csrf = payload.csrfToken;
    return { status: res.status, payload };
  };
}
const DBE_CSV = `NatEmis,DataYear,Province,Official_Institution_Name,Status,Sector,Type_DoE,Phase_PED,EIDistrict,EICircuit,GIS_Long,GIS_Lat,LMunName,Addressee,Town_City,Email,Telephone,Quintile,NoFeeSchool,Urban_Rural,Learners2025,Educators2025
700111111,2025,GT,SIZANANI PRIMARY SCHOOL,OPEN,PUBLIC,ORDINARY SCHOOL,PRIMARY SCHOOL,JOHANNESBURG EAST,JE1,-26.2041,28.0473,City of Johannesburg,MOKOENA T,ALEXANDRA,,0115551234,Q1,No Fee,Urban,812,24
700222222,2025,GT,"EKUKHANYENI SECONDARY, SCHOOL",OPEN,PUBLIC,ORDINARY SCHOOL,SECONDARY SCHOOL,JOHANNESBURG EAST,JE2,-26.1,28.1,City of Johannesburg,DLAMINI S,ALEXANDRA,admin@github.com,0115559999,Q2,No Fee,Urban,1200,40
700333333,2025,GT,CLOSED SCHOOL,CLOSED,PUBLIC,ORDINARY SCHOOL,PRIMARY SCHOOL,JOHANNESBURG EAST,JE1,,,,,,,,,,,,
700444444,2025,KZN,NO CONTACT COMBINED,OPEN,PUBLIC,ORDINARY SCHOOL,COMBINED SCHOOL,UMLAZI,99,,,eThekwini,99,99,99,99,Q3,No Fee,Rural,500,15
`;

test('schools module: DBE CSV parsing, bundled list, district-first tree, script, call outcomes, need → project body', () => {
  const conn = new DatabaseSync(':memory:');
  const store = schools.createSchoolsStore(conn);
  const r = store.importCsv(DBE_CSV, { source: 'test' });
  assert.deepEqual([r.imported, r.skipped], [3, 1], 'closed schools are skipped');
  const s1 = store.get('700111111');
  assert.equal(s1.name, 'Sizanani Primary School'); assert.equal(s1.province, 'Gauteng'); assert.equal(s1.district, 'Johannesburg East'); assert.equal(s1.phone, '0115551234'); assert.equal(s1.email, ''); assert.equal(s1.noFee, true);
  assert.equal(s1.lat, -26.2041, 'swapped GIS columns are corrected');
  assert.equal(store.get('700222222').name, 'Ekukhanyeni Secondary, School', 'quoted commas survive');
  assert.equal(store.get('700444444').phone, '', '"99" placeholders are blank');
  assert.equal(store.tree().items.length, 2);
  const gp = store.tree({ province: 'Gauteng' }).items[0];
  assert.deepEqual([gp.name, gp.schools, gp.withEmail, gp.withPhone], ['Johannesburg East', 2, 1, 2]);
  assert.equal(store.tree({ province: 'Gauteng', district: 'Johannesburg East' }).items.length, 2);
  assert.equal(store.list({ province: 'Gauteng', contact: 'email' }).total, 1);
  assert.equal(store.list({ province: 'Gauteng', contact: 'phone' }).total, 1);
  assert.equal(store.list({ q: 'sizanani' }).items[0].natemis, '700111111');
  assert.throws(() => store.importCsv('a,b\n1,2'), /does not look like the DBE master list/);
  // Re-import with a blank email never erases a known one.
  store.importCsv(DBE_CSV.replace('admin@github.com', ''), { source: 'again' });
  assert.equal(store.get('700222222').email, 'admin@github.com');

  // Bundled national list loads quickly and is big.
  const conn2 = new DatabaseSync(':memory:'); const big = schools.createSchoolsStore(conn2);
  const t0 = Date.now(); const loaded = big.loadBundled();
  assert.ok(loaded.imported > 24000, `bundled list has ${loaded.imported} schools`);
  assert.ok(Date.now() - t0 < 15000);
  const st = big.status(); assert.ok(st.loaded && st.withPhone > 20000 && st.withEmail > 5000);
  assert.ok(big.tree().items.some(p => p.name === 'KwaZulu-Natal'), 'province names keep their spelling');

  // School → target, brief, email, script, call outcomes, need → project.
  const lead = { ...schools.leadFromSchool(s1), id: 'l1', stage: 'New' };
  assert.equal(lead.kind, 'school'); assert.equal(lead.contactChannel, 'phone'); assert.equal(lead.contactName, 'Mokoena T (principal)');
  const brief = schools.dbeBrief(lead); assert.equal(brief.kind, 'dbe'); assert.ok(brief.findings.length >= 3); assert.match(brief.findings[0].text, /primary school in the Johannesburg East district, Gauteng/);
  const mail = schools.emailStep({ step: 1, lead, links: { booking: 'https://c/b', optOut: 'https://c/o' }, staff: { name: 'Lerato' } });
  assert.match(mail.subject, /15-minute call/); assert.match(mail.body, /Dear Principal/); assert.ok(mail.body.includes('https://c/b') && mail.body.includes('https://c/o'));
  assert.ok(!/proposal|R\s?\d/.test(mail.body));
  const script = schools.callScript(lead, { name: 'Lerato' }); assert.ok(script.length >= 6); assert.match(script[1], /Lerato from Chelo/); assert.match(script[script.length - 1], /Never ask for ID numbers/);
  schools.openCallTask(lead, { actor: 'Lerato' }); assert.equal(lead.callTask.status, 'open');
  schools.recordCall(lead, { outcome: 'no-answer', actor: 'Lerato' }); assert.equal(lead.stage, 'Contacted'); assert.equal(lead.callTask.attempts, 1);
  schools.recordCall(lead, { outcome: 'call-back', callBackAt: 'Tue 10:00', actor: 'Lerato' }); assert.equal(lead.callTask.status, 'call-back');
  schools.recordCall(lead, { outcome: 'booked', bookedAt: 'Thu 09:00', actor: 'Lerato' }); assert.equal(lead.callTask.status, 'booked'); assert.equal(lead.stage, 'Briefing booked');
  assert.throws(() => schools.recordCall(lead, { outcome: 'sold' }), /Outcome must be/);
  const need = schools.addNeed(lead, { text: 'Two of five toilet blocks unusable; 812 learners share the rest.', category: 'sanitation', estimate: 450000, actor: 'Lerato' });
  const body = schools.projectFromNeed(lead, need);
  assert.equal(body.name, 'Sanitation — Sizanani Primary School'); assert.equal(body.recipientName, 'Sizanani Primary School'); assert.equal(body.targetAmount, 450000); assert.match(body.summary, /812 learners, no-fee school, Johannesburg East district/);
});

test('schools desk end-to-end: load list, browse district, add phone-only school → call task, add email school → email ask, need → Verified Project', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chelo-schools-'));
  const port = 9400 + Math.floor(Math.random() * 500);
  const child = await startServer({ PORT: String(port), DATA_DIR: dir, NODE_ENV: 'test', SETTINGS_ENCRYPTION_KEY: 'school-key', SMTP_PROBE_DISABLED: 'true' });
  t.after(() => { child.kill('SIGTERM'); });
  const base = `http://127.0.0.1:${port}`;
  const sc = client(base, 'schools'); const csi = client(base, 'csi');
  assert.equal((await sc('POST', '/api/auth/setup', { username: 'founder@cheloapp.com', displayName: 'Founder', password: 'correct-horse-battery' })).status, 201);
  assert.equal((await csi('POST', '/api/auth/login', { username: 'founder@cheloapp.com', password: 'correct-horse-battery' })).status, 200);

  assert.equal((await sc('GET', '/api/schools/status')).payload.loaded, false);
  const imp = (await sc('POST', '/api/schools/import', DBE_CSV)).payload;
  assert.equal(imp.imported, 3, JSON.stringify(imp));
  assert.equal((await sc('GET', '/api/schools/tree')).payload.items.length, 2);
  const list = (await sc('GET', '/api/schools?province=Gauteng&district=Johannesburg%20East')).payload;
  assert.equal(list.total, 2); assert.equal(list.items[0].email, 'admin@github.com', 'email-bearing schools sort first');

  // Phone-only school → call task with the script.
  const a = (await sc('POST', '/api/schools/700111111/add', { run: false })).payload;
  assert.equal(a.lead.kind, 'school'); assert.equal(a.lead.phone, '0115551234');
  const run = (await sc('POST', `/api/leads/${a.lead.id}/flow`, {})).payload;
  assert.equal(run.flow.steps.verify.status, 'phone-only', JSON.stringify(run.flow.steps.verify));
  assert.equal(run.lead.flowStatus, 'call'); assert.ok(run.lead.callTask?.script?.length);
  assert.equal((await sc('POST', '/api/schools/700111111/add', {})).payload.alreadyAdded, true);
  const logged = (await sc('POST', `/api/leads/${a.lead.id}/call`, { outcome: 'booked', bookedAt: 'Thu 09:00', notes: 'Principal keen' })).payload;
  assert.equal(logged.lead.flowStatus, 'call-booked'); assert.equal(logged.lead.stage, 'Briefing booked');
  assert.equal((await sc('POST', `/api/leads/${a.lead.id}/call`, { outcome: 'sold' })).status, 400);

  // Need → Verified Project.
  const need = (await sc('POST', `/api/leads/${a.lead.id}/needs`, { text: 'Two of five toilet blocks unusable.', category: 'sanitation', estimate: 450000 })).payload;
  assert.equal(need.need.category, 'sanitation');
  const proj = (await sc('POST', `/api/leads/${a.lead.id}/needs/${need.need.id}/project`, {})).payload;
  assert.equal(proj.project.name, 'Sanitation — Sizanani Primary School'); assert.equal(proj.project.recipientName, 'Sizanani Primary School'); assert.equal(proj.project.targetAmount, 450000);
  assert.equal((await sc('POST', `/api/leads/${a.lead.id}/needs/${need.need.id}/project`, {})).payload.alreadyCreated, true);
  assert.ok((await csi('GET', '/api/projects')).payload.some(p => p.id === proj.project.id), 'Verified Projects are shared across desks');

  // Email school → the 15-minute call ask by email; no PDF; facts come from the DBE list, not the web.
  const b = (await sc('POST', '/api/schools/700222222/add', { run: false })).payload;
  const run2 = (await sc('POST', `/api/leads/${b.lead.id}/flow`, {})).payload;
  assert.ok(['verified', 'accepted'].includes(run2.flow.steps.verify.status), JSON.stringify(run2.flow.steps.verify));
  assert.equal(run2.lead.research?.kind, 'dbe');
  assert.equal(run2.flow.steps.match.status, 'set');
  assert.equal(run2.flow.steps.draft.status, 'drafted', JSON.stringify(run2.flow.steps.draft));
  assert.match(run2.lead.emailDraft.subject, /15-minute call/); assert.ok(!run2.lead.proposalFile);

  // Desk scoping: schools never show on the CSI desk.
  assert.ok(!(await csi('GET', '/api/init')).payload.leads.some(l => l.kind === 'school'));
  assert.equal((await sc('GET', '/api/init')).payload.leads.filter(l => l.kind === 'school').length, 2);
});

// v72: partnership requests to district offices.
const districts = require('../lib/districts');
test('schools emails: listing is free, NextFinder is an optional unpriced nudge', () => {
  const lead = { company: 'Sizanani Primary', kind: 'school', province: 'Gauteng', school: { district: 'Johannesburg East' } };
  const m = schools.emailStep({ step: 1, lead, links: { booking: 'https://c/book/x' }, staff: { name: 'Founder' } });
  assert.match(m.body, /Listing Sizanani Primary on Chelo is free/); assert.match(m.body, /no money through the school/); assert.match(m.body, /sister service NextFinder \(https:\/\/nextfinder\.org\)/); assert.match(m.body, /It is optional/); assert.ok(!/R ?8|booking fee|R\d/.test(m.body));
  assert.match(schools.emailStep({ step: 2, lead }).body, /costs the school nothing/);
  assert.ok(schools.callScript(lead, { name: 'F' }).some(l => /Listing the school on Chelo is free/.test(l))); assert.ok(schools.callScript(lead).some(l => /NextFinder/.test(l)));
  assert.match(require('../lib/desk-pdf').defaults('school', lead).nextStep, /NextFinder/);
});

test('districts module: contact picking, seed, request email, PDF layout, tile status', () => {
  const pages = [
    { url: 'https://www.education.gpg.gov.za/districts', text: 'Johannesburg East district office. District Director: Ms N Mahlangu. Tel 011 555 0001. Email: jhbeast.info@gauteng.gov.za. General enquiries info@gauteng.gov.za' },
    { url: 'https://example.com/listing', text: 'Johannesburg East schools directory webmaster@example.com 082 123 4567' }
  ];
  const found = districts.pickContacts({ district: 'Johannesburg East', province: 'Gauteng', pages });
  assert.equal(found.email, 'jhbeast.info@gauteng.gov.za', JSON.stringify(found)); assert.equal(found.phone, '0115550001'); assert.match(found.director, /Mahlangu/);
  const seed = districts.leadSeed({ province: 'Gauteng', district: 'Johannesburg East', found, stats: { schools: 320, q13: 210, noFee: 180, schoolsOnChelo: 2, needsLogged: 3, needs: [{ school: 'Sizanani Primary', text: 'Two toilet blocks', category: 'sanitation' }] }, source: pages[0].url });
  assert.equal(seed.kind, 'school'); assert.equal(seed.school.level, 'district'); assert.equal(seed.contactChannel, 'email'); assert.match(seed.company, /Johannesburg East Education District Office/);
  const lead = { id: 'd1', ...seed };
  const m = schools.emailStep({ step: 1, lead, links: { booking: 'https://c/book/x' }, staff: { name: 'Founder' } });
  assert.match(m.subject, /Partnership request: listing Johannesburg East's public schools on Chelo \(no cost\)/); assert.match(m.body, /^Dear Ms N Mahlangu,/); assert.match(m.body, /320 public schools/); assert.match(m.body, /210 of them quintile 1–3/); assert.match(m.body, /2 schools in the district are already listed on Chelo/);
  assert.match(m.body, /not asking the district or any school for money/); assert.match(m.body, /1\. A signed memorandum of understanding/); assert.match(m.body, /2\. Permission to approach principals/); assert.match(m.body, /3\. The principals' contact details/); assert.ok(!/R ?\d/.test(m.body), 'no amounts in a district request');
  assert.match(schools.emailStep({ step: 3, lead }).body, /close this thread/);
  const brief = schools.dbeBrief(lead); assert.ok(brief.findings.some(f => /320 public schools/.test(f.text))); assert.equal(brief.sources[0].title, 'District office page');
  const deskPdf = require('../lib/desk-pdf');
  const layout = deskPdf.layoutFor('school', lead, {}); assert.equal(layout.kicker, 'PARTNERSHIP REQUEST · DISTRICT OFFICE'); assert.match(layout.title, /Listing Johannesburg East's schools on Chelo/); assert.ok(layout.sections[1][1].includes('Two toilet blocks (Sizanani Primary)')); assert.match(layout.sections[4][0], /memorandum of understanding/i); assert.match(layout.sections[4][1], /2\. No cost/); assert.match(layout.sections[2][1], /NextFinder/); assert.ok(!/R ?8/.test(layout.sections[2][1]), 'never prices NextFinder');
  assert.match(deskPdf.filenameFor('school', lead), /Partnership-Request/); assert.equal(deskPdf.fieldLabels('school', lead).doc, 'Partnership request');
  assert.match(schools.callScript(lead, { name: 'Founder' })[0], /District Director/);
  assert.equal(districts.tileStatus(lead, 'sent').label, 'Requested'); assert.equal(districts.tileStatus(lead, 'booked').label, 'Meeting booked'); assert.equal(districts.tileStatus(null), null);
  assert.equal(districts.pickContacts({ district: 'X', province: 'Y', pages: [] }).email, '');
});

test('server: district office request from the district tile, status shows on the tree', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chelo-districts-'));
  const port = 9950 + Math.floor(Math.random() * 40);
  const child = await startServer({ PORT: String(port), DATA_DIR: dir, NODE_ENV: 'test', SETTINGS_ENCRYPTION_KEY: 'school-key', SMTP_PROBE_DISABLED: 'true' });
  t.after(() => { child.kill('SIGTERM'); });
  const base = `http://127.0.0.1:${port}`; const sc = client(base, 'schools'); const csi = client(base, 'csi');
  assert.equal((await sc('POST', '/api/auth/setup', { username: 'founder@cheloapp.com', displayName: 'Founder', password: 'correct-horse-battery' })).status, 201);
  assert.equal((await csi('POST', '/api/auth/login', { username: 'founder@cheloapp.com', password: 'correct-horse-battery' })).status, 200);
  assert.equal((await sc('POST', '/api/schools/import', DBE_CSV)).payload.imported, 3);
  const tree0 = (await sc('GET', '/api/schools/tree?province=Gauteng')).payload; assert.equal(tree0.items[0].office, null);
  assert.equal((await sc('POST', '/api/schools/district/office', { province: 'Gauteng' })).status, 400);
  // No search key in the sandbox: staff give the contact; the office is still created from DBE facts.
  const r = await sc('POST', '/api/schools/district/office', { province: 'Gauteng', district: 'Johannesburg East', email: 'district@github.com', contactName: 'Ms N Mahlangu', run: false });
  assert.equal(r.status, 201, JSON.stringify(r.payload)); assert.equal(r.payload.lead.kind, 'school'); assert.equal(r.payload.lead.school.level, 'district'); assert.equal(r.payload.lead.school.stats.schools, 2);
  assert.equal(r.payload.lead.contactName, 'Ms N Mahlangu'); assert.equal(r.payload.lead.email, 'district@github.com');
  assert.equal((await sc('POST', '/api/schools/district/office', { province: 'Gauteng', district: 'Johannesburg East' })).payload.alreadyAdded, true);
  const tree1 = (await sc('GET', '/api/schools/tree?province=Gauteng')).payload; assert.equal(tree1.items[0].office.leadId, r.payload.lead.id); assert.equal(tree1.items[0].office.label, 'Request drafted');
  assert.ok(!(await csi('GET', '/api/init')).payload.leads.some(l => l.id === r.payload.lead.id), 'district office lives on the Schools desk');
  // Umlazi is in the DBE directory → office email, Director and address without any web search.
  const dirHit = await sc('POST', '/api/schools/district/office', { province: 'KwaZulu-Natal', district: 'Umlazi', run: false });
  assert.equal(dirHit.status, 201, JSON.stringify(dirHit.payload)); assert.equal(dirHit.payload.lead.email, 'seelan.pillay@kzndoe.gov.za'); assert.equal(dirHit.payload.lead.contactName, 'Mr PN Cele'); assert.match(dirHit.payload.lead.sourceUrl, /education\.gov\.za/); assert.equal(dirHit.payload.warnings.length, 0);
  assert.equal((await sc('GET', '/api/schools/tree?province=KwaZulu-Natal')).payload.items.find(d => d.name === 'Umlazi').directory.director, 'Mr PN Cele');
  // Directory covers every district in the bundled DBE list; webmail never becomes the first-touch address.
  assert.equal(districts.directoryAll().length >= 75, true);
  for (const e of districts.DIRECTORY.districts) assert.ok(!e.email || /\.gov\.za$/i.test(e.email) || /\.gov$/i.test(e.email), `${e.dbeName}: ${e.email}`);
  const none = districts.directoryEntry('Gauteng', 'Nowhere'); assert.equal(none, null);
});

// v72b: emails sign with the account that owns the lead, never a hard-coded name.
test('server: a school added by Daniel is signed by Daniel', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chelo-owner-'));
  const port = 9860 + Math.floor(Math.random() * 40);
  const child = await startServer({ PORT: String(port), DATA_DIR: dir, NODE_ENV: 'test', SETTINGS_ENCRYPTION_KEY: 'school-key', SMTP_PROBE_DISABLED: 'true' });
  t.after(() => { child.kill('SIGTERM'); });
  const base = `http://127.0.0.1:${port}`; const root = client(base, 'schools'); const dan = client(base, 'schools');
  assert.equal((await root('POST', '/api/auth/setup', { username: 'founder@cheloapp.com', displayName: 'Founder', password: 'correct-horse-battery' })).status, 201);
  assert.equal((await root('POST', '/api/staff', { username: 'daniel@cheloapp.com', displayName: 'Daniel Mokoena', role: 'owner', desks: ['schools'], password: 'daniel-strong-password' })).status, 201);
  assert.equal((await dan('POST', '/api/auth/login', { username: 'daniel@cheloapp.com', password: 'daniel-strong-password' })).status, 200);
  assert.equal((await root('POST', '/api/schools/import', DBE_CSV)).status, 200);
  const added = (await dan('POST', '/api/schools/700222222/add', { run: false })).payload; assert.ok(added.lead.id, JSON.stringify(added));
  const lead = (await dan('GET', '/api/init')).payload.leads.find(l => l.id === added.lead.id);
  assert.equal(lead.owner, 'Daniel Mokoena'); assert.ok(lead.ownerId);
  const draft = (await dan('POST', `/api/leads/${lead.id}/outreach/generate`, { userNotes: '' })).payload;
  const body = draft.draft?.body || draft.body || JSON.stringify(draft);
  assert.match(body, /Daniel Mokoena/); assert.ok(!/Nandi/.test(body), body);
  const manual = (await dan('POST', '/api/leads', { company: 'Thuto Primary School', contactName: 'Principal', email: 'thuto@github.com', sector: 'Education' })).payload;
  assert.equal(manual.owner, 'Daniel Mokoena', JSON.stringify(manual));
});

// v73: anyone on the Schools desk uploads a DBE list; it stays private, shows differences, admin promotes.
test('server: staff private DBE upload → diff → browse mine → admin promotes', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chelo-dbe-private-'));
  const port = 9800 + Math.floor(Math.random() * 40);
  const child = await startServer({ PORT: String(port), DATA_DIR: dir, NODE_ENV: 'test', SETTINGS_ENCRYPTION_KEY: 'school-key', SMTP_PROBE_DISABLED: 'true' });
  t.after(() => { child.kill('SIGTERM'); });
  const base = `http://127.0.0.1:${port}`; const root = client(base, 'schools'); const dan = client(base, 'schools');
  assert.equal((await root('POST', '/api/auth/setup', { username: 'founder@cheloapp.com', displayName: 'Founder', password: 'correct-horse-battery' })).status, 201);
  assert.equal((await root('POST', '/api/staff', { username: 'daniel@cheloapp.com', displayName: 'Daniel Mokoena', role: 'owner', desks: ['schools'], password: 'daniel-strong-password' })).status, 201);
  assert.equal((await dan('POST', '/api/auth/login', { username: 'daniel@cheloapp.com', password: 'daniel-strong-password' })).status, 200);
  assert.equal((await root('POST', '/api/schools/import', DBE_CSV)).payload.imported, 3, 'admin upload is still the shared list');
  // Daniel's newer file: Sizanani gains an email, a new school appears, Ekukhanyeni is gone.
  const NEWER = DBE_CSV.replace('MOKOENA T,ALEXANDRA,,0115551234', 'MOKOENA T,ALEXANDRA,sizanani@github.com,0115551234').replace(/700222222[^\n]*\n/, '') + '700555555,2025,GT,NEW HOPE PRIMARY,OPEN,PUBLIC,ORDINARY SCHOOL,PRIMARY SCHOOL,JOHANNESBURG EAST,JE1,,,City of Johannesburg,X,ALEXANDRA,,0115550000,Q1,No Fee,Urban,300,10\n';
  const up = (await dan('POST', '/api/schools/import', NEWER)).payload;
  assert.equal(up.scope, 'mine', JSON.stringify(up)); assert.equal(up.imported, 3); assert.ok(up.diff);
  assert.deepEqual([up.diff.counts.added, up.diff.counts.removed, up.diff.counts.changed], [1, 1, 1], JSON.stringify(up.diff.counts));
  assert.equal(up.diff.byField[0].field, 'email'); assert.equal(up.diff.counts.contactGain, 1); assert.equal(up.diff.samples.changed[0].fields[0].to, 'sizanani@github.com');
  // Shared list untouched; Daniel can browse both.
  assert.equal((await root('GET', '/api/schools/status')).payload.total, 3);
  assert.equal((await dan('GET', '/api/schools/status')).payload.mine.total, 3);
  assert.equal((await dan('GET', '/api/schools/tree?province=Gauteng&list=mine')).payload.items[0].withEmail, 1);
  assert.equal((await dan('GET', '/api/schools/tree?province=Gauteng')).payload.items[0].withEmail, 1, 'shared still has Ekukhanyeni email');
  assert.equal((await dan('GET', '/api/schools?province=Gauteng&district=Johannesburg%20East&list=mine')).payload.items.some(x => x.name === 'New Hope Primary'), true);
  assert.equal((await dan('POST', '/api/schools/700555555/add', { run: false })).status, 201, 'a school from my upload can be added');
  // Daniel cannot promote; the admin sees his upload, compares it, and promotes it.
  assert.equal((await dan('POST', '/api/schools/mine/promote', {})).status, 403);
  const adminStatus = (await root('GET', '/api/schools/status')).payload; assert.equal(adminStatus.uploads.length, 1); assert.equal(adminStatus.uploads[0].name, 'Daniel Mokoena');
  const d2 = (await root('GET', `/api/schools/diff?owner=${adminStatus.uploads[0].ownerId}`)).payload; assert.equal(d2.counts.added, 1);
  const prom = (await root('POST', '/api/schools/mine/promote', { owner: adminStatus.uploads[0].ownerId })).payload; assert.equal(prom.total, 3, JSON.stringify(prom));
  assert.equal((await root('GET', '/api/schools?province=Gauteng&district=Johannesburg%20East')).payload.items.some(x => x.name === 'New Hope Primary'), true);
  assert.equal((await dan('GET', '/api/schools/status')).payload.mine, null, 'private copy cleared after promotion');
});
