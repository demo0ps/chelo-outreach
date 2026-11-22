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
  const script = schools.callScript(lead, { name: 'Lerato' }); assert.ok(script.length >= 6); assert.match(script[1], /Lerato from Chelo/); assert.match(script[6], /Never ask for ID numbers/);
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
