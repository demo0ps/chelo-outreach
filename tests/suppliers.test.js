// Four Desks — Release 4 (v63): Suppliers desk. Public sign-up → vetting; need broadcast by trade + province; hosted quote
// form; shortlist → signed (optional Chelo fee %); school confirms done. No payment ledger.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const suppliers = require('../lib/suppliers');

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
    const headers = { 'Content-Type': 'application/json', Origin: base, ...(desk ? { 'X-Chelo-Desk': desk } : {}), ...extra };
    if (jar.cookie) headers.Cookie = jar.cookie;
    if (jar.csrf) headers['X-CSRF-Token'] = jar.csrf;
    const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) jar.cookie = setCookie.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    const payload = ct.includes('application/json') ? await res.json() : await res.text();
    if (payload && payload.csrfToken) jar.csrf = payload.csrfToken;
    return { status: res.status, payload };
  };
}
const SIGNUP = { company: 'Thabo Plumbing', contactName: 'Thabo Nkosi', email: 'thabo@github.com', phone: '082 555 1234', trades: ['sanitation', 'water'], provinces: ['Gauteng', 'Limpopo'], regNo: '2015/123456/07', yearsTrading: 8, references: 'Sizanani Primary — Mr M, 011 555 1234', consent: true };

test('suppliers module: sign-up validation, vetting, matching, tender, quotes, sign with fee, done', () => {
  assert.throws(() => suppliers.fromSignup({ ...SIGNUP, trades: [] }), /Pick at least one trade/);
  assert.throws(() => suppliers.fromSignup({ ...SIGNUP, consent: false }), /agree/);
  assert.throws(() => suppliers.fromSignup({ ...SIGNUP, phone: '123' }), /phone/);
  const s1 = { id: 's1', ...suppliers.fromSignup(SIGNUP) };
  assert.equal(s1.kind, 'supplier'); assert.equal(s1.phone, '0825551234'); assert.equal(s1.supplier.vetting.status, 'pending');
  const s2 = { id: 's2', ...suppliers.fromSignup({ ...SIGNUP, company: 'Cape Water Works', email: 'cape@github.com', provinces: ['Western Cape'] }) };
  assert.equal(suppliers.matchSuppliers([s1, s2], { trade: 'sanitation', province: 'Gauteng' }).length, 0, 'pending suppliers never get needs');
  suppliers.setVetting(s1, { status: 'approved', actor: 'Founder' }); suppliers.setVetting(s2, { status: 'approved', actor: 'Founder' });
  assert.equal(s1.stage, 'Interested');
  assert.deepEqual(suppliers.matchSuppliers([s1, s2], { trade: 'sanitation', province: 'Gauteng' }).map(x => x.id), ['s1']);
  assert.deepEqual(suppliers.matchSuppliers([s1, s2], { trade: 'water', province: '' }).map(x => x.id), ['s1', 's2']);
  assert.throws(() => suppliers.setVetting(s2, { status: 'maybe' }), /Vetting status/);

  const project = { id: 'p1', name: 'Sanitation — Sizanani Primary School', recipientName: 'Sizanani Primary School', province: 'Gauteng', summary: 'Two of five toilet blocks unusable.', status: 'Verified · Seeking Partners' };
  const tender = suppliers.openTender(project, { trade: 'sanitation', province: 'Gauteng', closesInDays: 7, actor: 'Founder', suppliers: [s1] });
  assert.equal(tender.status, 'open'); assert.equal(tender.sentTo.length, 1); assert.ok(tender.token.length >= 12);
  assert.throws(() => suppliers.openTender(project, { trade: 'water', suppliers: [] }), /already out/);
  const mail = suppliers.broadcastEmail({ project, tender, supplier: s1, link: 'https://c/quote/x?s=s1' });
  assert.match(mail.subject, /Quote request: Toilets & plumbing — Sizanani Primary School, Gauteng/); assert.match(mail.body, /^Hi Thabo,/); assert.ok(mail.body.includes('https://c/quote/x?s=s1')); assert.match(mail.body, /no fee to quote/);
  const pub = suppliers.publicTender(project, tender); assert.equal(pub.status, 'open'); assert.ok(!('quotes' in pub) && !('sentTo' in pub), 'public view hides other suppliers');

  assert.throws(() => suppliers.submitQuote(tender, { amount: 0 }, { supplier: s1 }), /amount/);
  const q1 = suppliers.submitQuote(tender, { amount: 'R 450 000', leadTimeDays: 21, notes: 'Includes plumbing and tiling.' }, { supplier: s1 });
  assert.equal(q1.amount, 450000); assert.equal(q1.company, 'Thabo Plumbing');
  const q1b = suppliers.submitQuote(tender, { amount: 440000, leadTimeDays: 20 }, { supplier: s1 });
  assert.equal(tender.quotes.length, 1, 'a resubmission replaces the earlier live quote'); assert.equal(tender.quotes[0].id, q1b.id);
  const q2 = suppliers.submitQuote(tender, { company: 'Walk-in Builders', email: 'walkin@github.com', amount: 500000, leadTimeDays: 30 });
  assert.equal(tender.quotes.length, 2);
  suppliers.setQuoteStatus(project, q1b.id, { status: 'shortlisted', actor: 'Founder' });
  assert.throws(() => suppliers.setQuoteStatus(project, q1b.id, { status: 'signed', feePct: 'lots' }), /Fee %/);
  assert.throws(() => suppliers.confirmDone(project, { confirmedBy: 'Principal' }), /Sign a supplier first/);
  suppliers.setQuoteStatus(project, q1b.id, { status: 'signed', feePct: 5, actor: 'Founder' });
  assert.equal(tender.status, 'awarded'); assert.equal(tender.feePct, 5); assert.equal(project.status, 'Supplier signed · In delivery'); assert.equal(project.supplierName, 'Thabo Plumbing');
  assert.equal(tender.quotes.find(q => q.id === q2.id).status, 'declined', 'other quotes are declined when one is signed');
  assert.throws(() => suppliers.submitQuote(tender, { amount: 1, leadTimeDays: 1 }, { supplier: s2 }), /closed/);
  assert.throws(() => suppliers.confirmDone(project, { confirmedBy: '' }), /Who at the school/);
  suppliers.confirmDone(project, { confirmedBy: 'Principal Mokoena, by phone', actor: 'Founder' });
  assert.equal(tender.status, 'done'); assert.equal(project.status, 'Delivered · School confirmed');
  assert.throws(() => suppliers.setQuoteStatus(project, q1b.id, { status: 'declined' }), /already confirmed done/);
  const sum = suppliers.supplierSummary(s1, [project]); assert.deepEqual([sum.quotes, sum.signed, sum.done], [1, 1, 1]);
  // Signing with no fee leaves feePct null — no ledger, no amounts owed.
  const p2 = { id: 'p2', name: 'X', recipientName: 'Y', summary: 'z' }; const t2 = suppliers.openTender(p2, { trade: 'water', suppliers: [] }); t2.closesAt = new Date(Date.now() + 86400000).toISOString();
  const q = suppliers.submitQuote(t2, { company: 'AB Water', email: 'a@github.com', amount: 10, leadTimeDays: 1 }); suppliers.setQuoteStatus(p2, q.id, { status: 'signed', feePct: '' });
  assert.equal(p2.tender.feePct, null);
});

test('suppliers desk end-to-end: public sign-up → vet → broadcast → hosted quote → sign with fee → school confirms; desk scoping', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chelo-suppliers-'));
  const port = 9900 + Math.floor(Math.random() * 90);
  const child = await startServer({ PORT: String(port), DATA_DIR: dir, NODE_ENV: 'test', SETTINGS_ENCRYPTION_KEY: 'sup-key', SMTP_PROBE_DISABLED: 'true' });
  t.after(() => { child.kill('SIGTERM'); });
  const base = `http://127.0.0.1:${port}`;
  const sup = client(base, 'suppliers'); const csi = client(base, 'csi'); const anon = client(base);
  assert.equal((await sup('POST', '/api/auth/setup', { username: 'founder@cheloapp.com', displayName: 'Founder', password: 'correct-horse-battery' })).status, 201);
  assert.equal((await csi('POST', '/api/auth/login', { username: 'founder@cheloapp.com', password: 'correct-horse-battery' })).status, 200);

  // Public pages exist and the sign-up API works without a session.
  assert.equal((await fetch(`${base}/suppliers/join`)).status, 200);
  assert.ok((await (await fetch(`${base}/suppliers/join`)).text()).includes('Register as a supplier'));
  assert.equal((await anon('GET', '/api/public/suppliers/signup')).payload.trades.length, suppliers.TRADES.length);
  assert.equal((await anon('POST', '/api/public/suppliers/signup', { ...SIGNUP, trades: [] })).status, 400);
  const signed = await anon('POST', '/api/public/suppliers/signup', SIGNUP);
  assert.equal(signed.status, 201, JSON.stringify(signed.payload));
  assert.match((await anon('POST', '/api/public/suppliers/signup', SIGNUP)).payload.message, /already registered/);

  // It lands on the Suppliers desk only, as "vet".
  const supInit = (await sup('GET', '/api/init')).payload;
  const lead = supInit.leads.find(l => l.company === 'Thabo Plumbing');
  assert.ok(lead && lead.kind === 'supplier', JSON.stringify(supInit.leads.map(l => [l.company, l.kind])));
  assert.ok(!(await csi('GET', '/api/init')).payload.leads.some(l => l.company === 'Thabo Plumbing'));
  const wb = (await sup('GET', '/api/workbench')).payload.leads.find(l => l.id === lead.id); assert.equal(wb.flowStatus, 'vet');
  assert.equal((await sup('GET', '/api/suppliers/signup-link')).payload.pending, 1);
  assert.equal((await sup('GET', '/api/suppliers/match?trade=sanitation&province=Gauteng')).payload.count, 0);
  const vet = (await sup('PUT', `/api/leads/${lead.id}/vetting`, { status: 'approved', notes: 'References checked out.' })).payload;
  assert.equal(vet.vetting.status, 'approved'); assert.equal(vet.lead.flowStatus, 'vetted');
  assert.equal((await sup('GET', '/api/suppliers/match?trade=sanitation&province=Gauteng')).payload.count, 1);

  // A need from the Schools desk becomes a project; broadcast to matching suppliers (a mailbox exists so the job queues).
  assert.equal((await sup('POST', '/api/deliverability/mailboxes', { label: 'Supplier desk', fromEmail: 'suppliers@github.com', fromName: 'Chelo', host: '127.0.0.1', port: 2525, username: 'u', password: 'secret' })).status, 201);
  const project = (await sup('POST', '/api/projects', { name: 'Sanitation — Sizanani Primary School', recipientName: 'Sizanani Primary School', province: 'Gauteng', sector: 'Education', targetAmount: 450000, summary: 'Two of five toilet blocks unusable; 812 learners share the rest.' })).payload;
  const bc = (await sup('POST', `/api/projects/${project.id}/tender`, { trade: 'sanitation', province: 'Gauteng', closesInDays: 7 })).payload;
  assert.equal(bc.matched, 1, JSON.stringify(bc)); assert.equal(bc.queued, 1, JSON.stringify(bc.failed)); assert.ok(bc.quoteLink.includes('/quote/'));
  assert.equal((await sup('POST', `/api/projects/${project.id}/tender`, { trade: 'water' })).status, 400, 'one open request at a time');

  // The supplier quotes on the hosted form, anonymously, with the personal link.
  const token = bc.tender.token;
  assert.equal((await fetch(`${base}/quote/${token}`)).status, 200);
  const pub = (await anon('GET', `/api/public/quote/${token}?s=${lead.id}`)).payload;
  assert.equal(pub.status, 'open'); assert.equal(pub.supplier.company, 'Thabo Plumbing'); assert.ok(!pub.sentTo);
  assert.equal((await anon('POST', `/api/public/quote/${token}?s=${lead.id}`, { amount: 0 })).status, 400);
  const q = await anon('POST', `/api/public/quote/${token}?s=${lead.id}`, { amount: 440000, leadTimeDays: 21, notes: 'Plumbing and tiling included.' });
  assert.equal(q.status, 201, JSON.stringify(q.payload));
  assert.equal((await anon('GET', '/api/public/quote/nope-nope-nope')).status, 404);

  // Staff shortlist, sign with a 5% fee, then the school confirms done.
  const tender = (await sup('GET', `/api/projects/${project.id}/tender`)).payload.tender;
  assert.equal(tender.quotes.length, 1); const qid = tender.quotes[0].id;
  assert.equal((await sup('PUT', `/api/projects/${project.id}/tender/quotes/${qid}`, { status: 'shortlisted' })).payload.quote.status, 'shortlisted');
  const sign = (await sup('PUT', `/api/projects/${project.id}/tender/quotes/${qid}`, { status: 'signed', feePct: 5 })).payload;
  assert.equal(sign.tender.status, 'awarded'); assert.equal(sign.tender.feePct, 5); assert.equal(sign.project.supplierName, 'Thabo Plumbing');
  assert.equal((await sup('POST', `/api/projects/${project.id}/tender/done`, { confirmedBy: '' })).status, 400);
  const done = (await sup('POST', `/api/projects/${project.id}/tender/done`, { confirmedBy: 'Principal Mokoena, by phone' })).payload;
  assert.equal(done.project.status, 'Delivered · School confirmed');
  const after = (await sup('GET', '/api/init')).payload.leads.find(l => l.id === lead.id);
  assert.equal(after.supplier.quotes, 1); assert.equal(after.supplier.awarded, 1); assert.equal(after.supplier.done, 1);
  assert.ok(!JSON.stringify(done).includes('"ledger"') && !('amountDue' in done.project), 'no payment ledger anywhere');
});
