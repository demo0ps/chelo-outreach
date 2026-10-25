const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const createEmailVerifier = require('../lib/email-verify');

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

test('email verifier: syntax, disposable, null-MX, SMTP classification and port-25-blocked degradation', async () => {
  const resolver = {
    async resolveMx(domain) {
      if (domain === 'nullmx.test') return [{ exchange: '.', priority: 0 }];
      if (domain === 'nomx.test') { const e = new Error('x'); e.code = 'ENOTFOUND'; throw e; }
      return [{ exchange: `mx.${domain}`, priority: 10 }];
    },
    async resolve4(domain) { if (domain === 'nomx.test') { const e = new Error('x'); e.code = 'ENOTFOUND'; throw e; } return ['1.2.3.4']; },
    async resolve6() { return []; }
  };
  const answers = {
    'ok@live.test': { rcpt: { code: 250, message: 'OK' }, probe: { code: 550, message: '5.1.1 User unknown' } },
    'gone@live.test': { rcpt: { code: 550, message: '5.1.1 User unknown' }, probe: { code: 550, message: '5.1.1 User unknown' } },
    'any@catchall.test': { rcpt: { code: 250, message: 'OK' }, probe: { code: 250, message: 'OK' } },
    'grey@slow.test': { rcpt: { code: 451, message: 'try later' }, probe: null },
    'who@blocked.test': { rcpt: null, probe: null, error: 'ECONNREFUSED' }
  };
  const verifier = createEmailVerifier({ resolver, probe: async (host, rcpt) => ({ ...(answers[rcpt] || { rcpt: null, error: 'timeout' }) }) });
  assert.equal((await verifier.verify('not-an-email')).status, 'invalid');
  assert.equal((await verifier.verify('a@mailinator.com')).status, 'invalid');
  assert.equal((await verifier.verify('a@nullmx.test')).status, 'invalid');
  assert.equal((await verifier.verify('a@nomx.test')).status, 'invalid');
  assert.equal((await verifier.verify('ok@live.test')).status, 'deliverable');
  assert.equal((await verifier.verify('gone@live.test')).status, 'undeliverable');
  assert.equal((await verifier.verify('any@catchall.test')).status, 'catch-all');
  assert.equal((await verifier.verify('grey@slow.test')).status, 'unknown');
  const blocked = await verifier.verify('who@blocked.test');
  assert.equal(blocked.status, 'unknown', 'connection failures must never be reported as dead');
  assert.equal((await verifier.verify('ok@live.test')).cached, true);
});

test('workbench flow: create → auto verify/research/match/draft, dead email quarantined, run-pending and discovery guard', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chelo-wb-'));
  const port = 4900 + Math.floor(Math.random() * 500);
  const child = await startServer({ PORT: String(port), DATA_DIR: dir, NODE_ENV: 'test', SETTINGS_ENCRYPTION_KEY: 'wb-key', SMTP_PROBE_DISABLED: 'true' });
  t.after(() => { child.kill('SIGTERM'); });
  const base = `http://127.0.0.1:${port}`;
  const jar = { cookie: '', csrf: '' };
  const api = async (method, url, body) => {
    const headers = { 'Content-Type': 'application/json', Origin: base };
    if (jar.cookie) headers.Cookie = jar.cookie;
    if (jar.csrf) headers['X-CSRF-Token'] = jar.csrf;
    const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) jar.cookie = setCookie.split(';')[0];
    const payload = (res.headers.get('content-type') || '').includes('application/json') ? await res.json() : null;
    if (payload && payload.csrfToken) jar.csrf = payload.csrfToken;
    return { status: res.status, payload };
  };
  assert.equal((await api('POST', '/api/auth/setup', { username: 'admin@cheloapp.com', displayName: 'Nandi', password: 'correct-horse-battery' })).status, 201);

  // 1. Healthy lead → full automatic chain up to draft
  const created = await api('POST', '/api/leads', { company: 'Umoya Holdings', contactName: 'Sipho Dlamini', email: 'sipho@github.com', sector: 'Mining', sourceName: 'Public CSI page', sourceUrl: 'https://github.com/about' });
  assert.equal(created.status, 201, JSON.stringify(created.payload));
  const run = await api('POST', `/api/leads/${created.payload.id}/flow`, {});
  assert.equal(run.status, 200, JSON.stringify(run.payload));
  const steps = run.payload.flow.steps;
  assert.ok(['verified', 'accepted'].includes(steps.verify.status), JSON.stringify(steps.verify));
  assert.equal(steps.research.status, 'needs-review');
  assert.ok(['suggested', 'set', 'needs-choice'].includes(steps.match.status));
  const lead = run.payload.lead;
  if (lead.projectId) { assert.equal(steps.draft.status, 'drafted'); assert.ok(lead.emailDraft && lead.emailDraft.subject); assert.equal(lead.flowStatus, 'needs-review'); }
  else assert.equal(steps.draft.status, 'blocked');
  assert.equal(lead.stage, 'Researched');

  // 1b. Approving the research re-drafts the email with approved findings
  const brief = lead.research;
  const review = await api('POST', `/api/leads/${lead.id}/research/review`, { approvedFindingIds: brief.findings.map(f => f.id), approvedAlignmentIds: brief.alignmentPoints.map(a => a.id), approvedContactIds: [], applySuggestedProject: true });
  assert.equal(review.status, 200, JSON.stringify(review.payload));
  const after = await api('GET', `/api/leads/${lead.id}/flow`);
  assert.equal(after.payload.lead.research.status, 'approved');
  if (after.payload.lead.projectId) { assert.equal(after.payload.lead.flowStatus, 'ready'); assert.equal(after.payload.flow.steps.draft.usedApprovedResearch, true); }

  // 2. Dead email (no MX) is rejected at intake; dead mailbox is quarantined by the flow
  const dead = await api('POST', '/api/leads', { company: 'Ghost Mining', contactName: 'Nobody', email: 'x@no-such-domain-zz-123456.co.za', sourceName: 's' });
  assert.equal(dead.status, 400);

  // 3. Workbench snapshot + run-pending processes leads without a flow
  const noFlow = await api('POST', '/api/leads', { company: 'Second Org', contactName: 'A B', email: 'ab@github.com', sourceName: 's' });
  assert.equal(noFlow.status, 201);
  const pending = await api('POST', '/api/flow/run-pending', { limit: 5 });
  assert.equal(pending.status, 200);
  assert.ok(pending.payload.ran.includes(noFlow.payload.id));
  const wb = await api('GET', '/api/workbench');
  assert.equal(wb.status, 200);
  assert.ok(wb.payload.leads.every(l => typeof l.flowStatus === 'string'));
  assert.ok(wb.payload.leads.find(l => l.id === noFlow.payload.id).flow);

  // 4. Discovery requires a search key; adding an organisation without email yields a blocked (needs-email) flow
  const search = await api('GET', '/api/discovery/search?q=mining%20education');
  assert.equal(search.status, 409);
  const added = await api('POST', '/api/discovery/add', { name: 'Anglo Example', website: 'https://example.org', summary: 'CSI focus on education', query: 'mining education' });
  assert.equal(added.status, 201, JSON.stringify(added.payload));
  const addedFlow = await api('POST', `/api/leads/${added.payload.lead.id}/flow`, {});
  assert.equal(addedFlow.payload.flow.status, 'blocked');
  assert.equal(addedFlow.payload.flow.steps.verify.status, 'needs-email');
  const dup = await api('POST', '/api/discovery/add', { name: 'Anglo Example' });
  assert.equal(dup.status, 409);

  // 5. Audit trail records the automation
  const audit = await api('GET', '/api/audit');
  const actions = (audit.payload.entries || audit.payload || []).map(e => e.action);
  assert.ok(actions.includes('research.gathered'));
  assert.ok(actions.includes('discovery.added'));
});
