// v71: Supporters desk — individuals sign up on /support, get told about matching projects, pledge on a hosted form;
// staff confirm pledges. SMEs found on the web get an invitation carrying the supplier sign-up link.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const supporters = require('../lib/supporters');
const desks = require('../lib/desks');

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
const SIGNUP = { name: 'Naledi Mokoena', email: 'naledi@github.com', phone: '082 555 9876', provinces: ['Gauteng'], categories: ['sanitation', 'water'], band: '1000', town: 'Soweto', why: 'My old school.', consent: true };

test('supporters module: sign-up validation, matching, pledge link, pledges', () => {
  assert.throws(() => supporters.fromSignup({ ...SIGNUP, consent: false }), /agree/);
  assert.throws(() => supporters.fromSignup({ ...SIGNUP, email: 'nope' }), /email/);
  const a = { id: 'a', bookingToken: 'ab'.repeat(12), ...supporters.fromSignup(SIGNUP) };
  const b = { id: 'b', bookingToken: 'cd'.repeat(12), ...supporters.fromSignup({ ...SIGNUP, name: 'Sipho Dlamini', email: 'sipho@github.com', provinces: [], categories: [] }) };
  assert.equal(a.kind, 'individual'); assert.equal(a.phone, '0825559876'); assert.deepEqual(a.supporter.categories, ['sanitation', 'water']);
  assert.equal(desks.kindOfLead(a), 'individual'); assert.equal(desks.deskOfLead(a), 'supporters'); assert.equal(desks.deskOfLead({ kind: 'ngo' }), 'supporters');
  const project = { id: 'p1', name: 'Sanitation — Sizanani Primary School', recipientName: 'Sizanani Primary School', province: 'Gauteng', needCategory: 'sanitation', summary: 'Two of five toilet blocks unusable.', targetAmount: 450000 };
  assert.deepEqual(supporters.matchSupporters([a, b], project).map(m => m.lead.id), ['a', 'b']);
  assert.deepEqual(supporters.matchSupporters([a, b], { ...project, province: 'Limpopo' }).map(m => m.lead.id), ['b'], 'province preference respected; blank means anywhere');
  assert.deepEqual(supporters.matchSupporters([a, b], { ...project, needCategory: 'ict' }).map(m => m.lead.id), ['b']);
  const link = supporters.pledgeLink('https://c', a, project); assert.equal(link, `https://c/pledge/${a.bookingToken}?p=p1`);
  const mail = supporters.supporterEmail({ project, lead: a, link, staff: { name: 'Founder' } });
  assert.match(mail.subject, /Sizanani Primary School needs toilets & sanitation/i); assert.match(mail.body, /^Hi Naledi,/); assert.ok(mail.body.includes(link)); assert.ok(!/\[Your Name\]/.test(mail.body));
  supporters.recordTold(a, project, 'job1'); assert.equal(supporters.matchSupporters([a, b], project).filter(m => !m.told).length, 1, 'never told twice');
  assert.throws(() => supporters.recordPledge(a, project, { amount: 10 }), /at least/);
  const pl = supporters.recordPledge(a, project, { amount: '500', message: 'Go well.' });
  assert.equal(pl.status, 'pledged'); assert.equal(project.supporterPledges.length, 1); assert.equal(supporters.supporterSummary(a).pledged, 500);
  assert.deepEqual(supporters.projectPledges(project), { count: 1, pledged: 500, received: 0 });
  const out = supporters.setPledgeStatus(a, project, pl.id, 'received', 'Founder'); assert.equal(out.status, 'received');
  assert.equal(supporters.supporterSummary(a).received, 500); assert.equal(supporters.projectPledges(project).received, 500);
  assert.throws(() => supporters.setPledgeStatus(a, project, pl.id, 'maybe'), /status/i);
  const view = supporters.publicPledgeView(a, project); assert.equal(view.project.recipientName, 'Sizanani Primary School'); assert.ok(!('supporterPledges' in view.project)); assert.equal(view.already.length, 1);
  const inv = supporters.smeInviteEmail({ candidate: { company: 'Tzaneen Plumbing' }, link: 'https://c/suppliers/join', trade: 'Toilets & plumbing', town: 'Tzaneen', staff: { name: 'Founder' } });
  assert.ok(inv.body.includes('https://c/suppliers/join')); assert.match(inv.subject, /Tzaneen/);
});

test('server: public sign-up lands on the Supporters desk; tell → pledge → confirm; SME invitations', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chelo-supporters-'));
  const port = 9700 + Math.floor(Math.random() * 90);
  const child = await startServer({ PORT: String(port), DATA_DIR: dir, NODE_ENV: 'test', SETTINGS_ENCRYPTION_KEY: 'sup-key', SMTP_PROBE_DISABLED: 'true' });
  t.after(() => { child.kill('SIGTERM'); });
  const base = `http://127.0.0.1:${port}`;
  const sup = client(base, 'supporters'); const csi = client(base, 'csi'); const anon = client(base);
  assert.equal((await sup('POST', '/api/auth/setup', { username: 'founder@cheloapp.com', displayName: 'Founder', password: 'correct-horse-battery' })).status, 201);
  assert.equal((await csi('POST', '/api/auth/login', { username: 'founder@cheloapp.com', password: 'correct-horse-battery' })).status, 200);

  assert.ok((await (await fetch(`${base}/support`)).text()).includes('Back a school project'));
  assert.equal((await anon('GET', '/api/public/support/signup')).payload.bands.length, supporters.BANDS.length);
  assert.equal((await anon('POST', '/api/public/support/signup', { ...SIGNUP, consent: false })).status, 400);
  const signed = await anon('POST', '/api/public/support/signup', SIGNUP); assert.equal(signed.status, 201, JSON.stringify(signed.payload));
  assert.match((await anon('POST', '/api/public/support/signup', { ...SIGNUP, provinces: ['Limpopo'] })).payload.message, /updated/);

  const init = (await sup('GET', '/api/init')).payload;
  const lead = init.leads.find(l => l.email === 'naledi@github.com');
  assert.ok(lead && lead.kind === 'individual', JSON.stringify(init.leads.map(l => [l.company, l.kind])));
  assert.deepEqual(lead.supporter.provinces, ['Limpopo'], 'second sign-up updates preferences');
  assert.ok(!(await csi('GET', '/api/init')).payload.leads.some(l => l.email === 'naledi@github.com'), 'not on the CSI desk');
  const wb = (await sup('GET', '/api/workbench')).payload.leads.find(l => l.id === lead.id); assert.equal(wb.flowStatus, 'supporter'); assert.equal(wb.account.told, 0);
  assert.equal((await sup('GET', '/api/supporters/signup-link')).payload.individuals, 1);

  assert.equal((await sup('POST', '/api/deliverability/mailboxes', { label: 'Supporters', fromEmail: 'hello@github.com', fromName: 'Chelo', host: '127.0.0.1', port: 2525, username: 'u', password: 'secret' })).status, 201);
  const project = (await sup('POST', '/api/projects', { name: 'Sanitation — Mokopane Primary', recipientName: 'Mokopane Primary School', province: 'Limpopo', sector: 'Education', targetAmount: 120000, summary: 'Toilet block rebuild.', needCategory: 'sanitation' })).payload;
  assert.ok(project.id, JSON.stringify(project));
  assert.equal(project.needCategory, 'sanitation');
  const other = (await sup('POST', '/api/projects', { name: 'ICT — Mokopane Primary', recipientName: 'Mokopane Primary School', province: 'Limpopo', sector: 'Education', targetAmount: 50000, summary: 'Lab.', needCategory: 'ict' })).payload;
  assert.equal((await sup('GET', `/api/projects/${other.id}/supporters`)).payload.count, 0, 'she did not tick ICT');
  const m = (await sup('GET', `/api/projects/${project.id}/supporters`)).payload; assert.equal(m.count, 1); assert.equal(m.fresh, 1);
  const told = (await sup('POST', `/api/projects/${project.id}/supporters/tell`, {})).payload; assert.equal(told.queued, 1, JSON.stringify(told));
  assert.equal((await sup('POST', `/api/projects/${project.id}/supporters/tell`, {})).payload.queued, 0, 'nobody is told twice');

  const token = (await sup('GET', '/api/init')).payload.leads.find(l => l.id === lead.id).bookingToken; assert.ok(token);
  assert.ok((await (await fetch(`${base}/pledge/${token}?p=${project.id}`)).text()).includes('support.js'));
  const view = (await anon('GET', `/api/public/pledge/${token}?p=${project.id}`)).payload; assert.equal(view.project.recipientName, 'Mokopane Primary School');
  assert.equal((await anon('GET', `/api/public/pledge/${token}?p=nope`)).status, 404);
  const pledged = await anon('POST', `/api/public/pledge/${token}?p=${project.id}`, { amount: 750, message: 'For the learners.' }); assert.equal(pledged.status, 201, JSON.stringify(pledged.payload));
  const wb2 = (await sup('GET', '/api/workbench')).payload.leads.find(l => l.id === lead.id); assert.equal(wb2.flowStatus, 'pledged'); assert.equal(wb2.account.pledged, 750);
  const pid = wb2.account.items[0].id;
  const conf = (await sup('PUT', `/api/leads/${lead.id}/pledges/${pid}`, { status: 'received' })).payload; assert.equal(conf.pledge.status, 'received'); assert.equal(conf.lead.flowStatus, 'supporter');
  const p2 = (await sup('GET', '/api/init')).payload.projects.find(p => p.id === project.id); assert.equal(p2.supporterPledges[0].status, 'received');

  // SME invitations from the Suppliers desk: a candidate is recorded, an email queued, nothing becomes a supplier.
  const supl = client(base, 'suppliers'); assert.equal((await supl('POST', '/api/auth/login', { username: 'founder@cheloapp.com', password: 'correct-horse-battery' })).status, 200);
  const inv = (await supl('POST', '/api/suppliers/invite', { trade: 'sanitation', town: 'Tzaneen', items: [{ name: 'Tzaneen Plumbing', website: 'https://github.com', email: 'info@github.com' }, { name: 'No Mail CC' }] })).payload;
  assert.equal(inv.queued, 1, JSON.stringify(inv)); assert.equal(inv.skipped.length, 1);
  assert.equal((await supl('POST', '/api/suppliers/invite', { trade: 'sanitation', town: 'Tzaneen', items: [{ name: 'Tzaneen Plumbing', email: 'info@github.com' }] })).payload.queued, 0, 'not invited twice');
  assert.ok(!(await supl('GET', '/api/init')).payload.leads.some(l => l.company === 'Tzaneen Plumbing'), 'invitation does not create a supplier');
  assert.ok((await supl('GET', '/api/init')).payload.candidates.some(c => c.company === 'Tzaneen Plumbing' && c.status === 'Invited'));
});
