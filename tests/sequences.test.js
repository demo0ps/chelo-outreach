const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const sequences = require('../lib/sequences');
const triage = require('../lib/reply-triage');

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

test('sequence planner: 4 steps in-thread, edits, digest, business-day scheduling, stop semantics', () => {
  const lead = { email: 'a@b.org', contactName: 'Naledi Mokoena', company: 'Umoya', project: 'Literacy WC', amount: 250000, emailDraft: { subject: 'Partnership with Chelo', body: 'Dear Naledi,\n\nHello.' } };
  const plan = sequences.buildPlan({ lead, links: { booking: 'https://x/book', optOut: 'https://x/out' }, project: { name: 'Literacy WC', province: 'Western Cape', outcomes: ['1 200 learners reading at grade level'] }, facts: ['The group funds early-grade reading in the Western Cape'], now: new Date('2026-10-27T08:00:00Z') });
  assert.equal(plan.steps.length, 4);
  assert.equal(plan.steps[0].subject, 'Partnership with Chelo');
  assert.ok(plan.steps.slice(1).every(s => s.subject === 'Re: Partnership with Chelo'), 'follow-ups stay in the thread');
  assert.match(plan.steps[1].body, /Western Cape|reading/i);
  assert.match(plan.steps[2].body, /\?/, 'step 3 asks a question');
  assert.match(plan.steps[3].body, /close this thread/i);
  assert.ok(plan.steps.slice(1).every(s => s.body.includes('https://x/out')), 'every follow-up carries the opt-out link');
  const d1 = sequences.planDigest(plan, lead);
  sequences.applyStepEdits(plan, [{ n: 3, enabled: false }, { n: 2, offsetDays: 2, subject: 'Re: Partnership with Chelo — one fact' }]);
  assert.equal(plan.steps[2].status, 'skipped'); assert.equal(plan.steps[1].offsetDays, 2);
  assert.notEqual(sequences.planDigest(plan, lead), d1, 'edits change the digest (voids a first approval)');
  assert.equal(sequences.activeSteps(plan).length, 3);
  plan.steps[0].status = 'sent'; plan.steps[0].sentAt = '2026-10-30T08:00:00Z'; // Friday
  const next = sequences.nextPlannedStep(plan); assert.equal(next.n, 2);
  assert.equal(sequences.scheduleFor(plan, next, new Date()).toISOString().slice(0, 10), '2026-11-03', '2 business days after a Friday send is Tuesday');
  plan.status = 'running'; sequences.stop(plan, 'replied');
  assert.equal(plan.status, 'stopped'); assert.equal(plan.stoppedReason, 'Human reply received');
  assert.ok(plan.steps.slice(1).every(s => ['cancelled', 'skipped'].includes(s.status)));
  assert.throws(() => sequences.applyStepEdits(plan, [{ n: 2, body: 'x' }]), /unapproved/);
});

test('reply triage: five buckets, redirect capture, resume hints, automatic replies never count as engagement', () => {
  const c = (text, extra = {}) => triage.classifyReply({ subject: 'Re: Partnership with Chelo', text, ...extra }, { now: new Date('2026-10-27T08:00:00Z') });
  assert.equal(c('I am out of the office until 3 November with limited access to email.').category, 'automatic');
  assert.equal(c('', { headers: 'Auto-Submitted: auto-replied\nPrecedence: bulk' }).category, 'automatic');
  assert.equal(c('Thanks for reaching out', { subject: 'Automatic reply: Partnership' }).category, 'automatic');
  assert.equal(c('Hello', { fromEmail: 'no-reply@corp.co.za' }).category, 'automatic');
  assert.equal(c('Please unsubscribe me and do not contact us again.').category, 'opt-out');
  const wrong = c('I am not the right person. Please contact Naledi Mokoena, our Head of CSI, who handles this.');
  assert.equal(wrong.category, 'wrong-person'); assert.deepEqual(wrong.hints.redirect, { name: 'Naledi Mokoena', title: 'Head of CSI' });
  assert.equal(c('Thandi Nkosi (Transformation Manager) is the right person for this.').hints.redirect.name, 'Thandi Nkosi');
  const later = c('Our CSI budgets are allocated for this year. Circle back in March 2027.');
  assert.equal(later.category, 'not-now'); assert.equal(later.hints.resumeOn, '2027-03-01');
  assert.equal(c('Not a priority right now, check back in 6 weeks.').hints.resumeOn, '2026-12-08');
  const yes = c('This sounds interesting. Could we set up a call next week? Thursday works for me.');
  assert.equal(yes.category, 'interested'); assert.equal(yes.confidence, 'high');
  assert.equal(c('Noted.').category, 'unclassified');
  assert.equal(triage.slaDueAt('interested', new Date('2026-10-27T08:00:00Z')), '2026-10-27T12:00:00.000Z');
  assert.equal(triage.slaDueAt('automatic'), null);
});

test('sequence API: build → edit → approve once → step 1 queued; human reply halts the plan and opens triage; auto-reply is ignored; triage outcomes', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chelo-seq-'));
  const port = 5900 + Math.floor(Math.random() * 500);
  const child = await startServer({ PORT: String(port), DATA_DIR: dir, NODE_ENV: 'test', SETTINGS_ENCRYPTION_KEY: 'seq-key', SMTP_PROBE_DISABLED: 'true' });
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
  assert.equal((await api('POST', '/api/deliverability/mailboxes', { label: 'Team', fromEmail: 'team@github.com', host: '127.0.0.1', port: 2525, username: 'u', password: 'p', dailyCap: 30, rampEnabled: false })).status, 201);

  const lead = (await api('POST', '/api/leads', { company: 'Umoya Holdings', contactName: 'Sipho Dlamini', email: 'sipho@github.com', sector: 'Mining', projectId: 'proj-chelo-solar-gp', sourceName: 'Website', sourceUrl: 'https://github.com' })).payload;
  const flow = await api('POST', `/api/leads/${lead.id}/flow`, {});
  assert.equal(flow.status, 200, JSON.stringify(flow.payload));
  assert.ok(flow.payload.lead.emailDraft, 'flow produced a first-touch draft');

  const built = await api('POST', `/api/leads/${lead.id}/sequence/build`, {});
  assert.equal(built.status, 201, JSON.stringify(built.payload));
  const seq = built.payload.sequence;
  assert.equal(seq.steps.length, 4); assert.equal(seq.status, 'draft');

  const edited = await api('PATCH', `/api/leads/${lead.id}/sequence`, { steps: [{ n: 4, enabled: false }, { n: 2, offsetDays: 2 }] });
  assert.equal(edited.status, 200); assert.equal(edited.payload.sequence.steps[3].status, 'skipped');

  const approved = await api('POST', `/api/leads/${lead.id}/sequence/approve`, {});
  assert.ok([200, 409].includes(approved.status), JSON.stringify(approved.payload));
  const running = approved.payload.sequence;
  assert.equal(running.status, 'running');
  assert.equal(running.approval.policy, 'single');
  assert.equal(running.steps[0].status === 'queued' || running.steps[0].status === 'sent' || running.steps[0].status === 'failed', true, JSON.stringify(running.steps[0]));
  assert.ok(running.steps[0].jobId);
  assert.equal(running.steps[1].status, 'planned', 'follow-ups wait for step 1 to actually send');
  assert.equal((await api('POST', `/api/leads/${lead.id}/sequence/build`, {})).status, 409, 'cannot rebuild while running');
  assert.equal((await api('PATCH', `/api/leads/${lead.id}/sequence`, { steps: [{ n: 2, body: 'x' }] })).status, 409, 'approved plans are frozen');

  // Automatic reply must not stop the sequence or count as engagement
  const secret = (await api('GET', '/api/inbound/webhook-info')).payload.secret;
  const post = async evt => { const raw = JSON.stringify(evt); const sig = crypto.createHmac('sha256', secret).update(raw).digest('hex'); const r = await fetch(`${base}/api/inbound/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Chelo-Signature': sig }, body: raw }); return r.json(); };
  const ooo = await post({ type: 'inbound', from: 'sipho@github.com', subject: 'Automatic reply: Partnership', text: 'I am out of office until Monday with limited access to email.' });
  assert.equal(ooo.results[0].kind, 'auto_reply');
  let state = (await api('GET', '/api/init')).payload.leads.find(l => l.id === lead.id);
  assert.equal(state.sequence.status, 'running'); assert.equal(state.triage, undefined);
  assert.ok(state.emailStatus !== 'Replied (webhook)');

  // Human reply halts the plan and opens a triage item
  const reply = await post({ type: 'inbound', from: 'sipho@github.com', subject: 'Re: Partnership', text: 'Thanks — I am not the right person. Please contact Naledi Mokoena, our Head of CSI, who handles this.' });
  assert.equal(reply.results[0].kind, 'reply'); assert.equal(reply.results[0].triage, 'wrong-person');
  state = (await api('GET', '/api/init')).payload.leads.find(l => l.id === lead.id);
  assert.equal(state.sequence.status, 'stopped'); assert.equal(state.sequence.stoppedReason, 'Human reply received');
  assert.ok(state.sequence.steps.slice(1).every(s => ['cancelled', 'skipped'].includes(s.status)));
  assert.equal(state.triage.category, 'wrong-person'); assert.equal(state.triage.handled, false);
  assert.equal(state.triage.hints.redirect.name, 'Naledi Mokoena');
  const q = await api('GET', '/api/triage'); assert.equal(q.payload.items.length, 1); assert.equal(q.payload.items[0].leadId, lead.id);
  const queued = (await api('GET', '/api/deliverability')).payload.jobs.filter(j => j.leadId === lead.id && j.status === 'queued');
  assert.equal(queued.length, 0, 'no queued job survives a human reply');

  // Triage: wrong person → redirect becomes a candidate
  const outcome = await api('POST', `/api/leads/${lead.id}/triage`, { category: 'wrong-person' });
  assert.equal(outcome.status, 200); assert.equal(outcome.payload.triage.handled, true);
  const init = (await api('GET', '/api/init')).payload;
  const cand = init.candidates.find(c => c.contactName === 'Naledi Mokoena');
  assert.ok(cand, 'redirect captured as a candidate'); assert.equal(cand.company, 'Umoya Holdings'); assert.equal(cand.title, 'Head of CSI'); assert.equal(cand.email, '');
  assert.equal((await api('GET', '/api/triage')).payload.items.length, 0);

  // Triage: not-now sets a resurfacing date; opt-out suppresses workspace-wide
  const lead2 = (await api('POST', '/api/leads', { company: 'Thabo Capital', contactName: 'Thabo N', email: 'thabo@github.com', sector: 'Finance', sourceName: 'Website', sourceUrl: 'https://github.com' })).payload;
  await post({ type: 'inbound', from: 'thabo@github.com', subject: 'Re: Partnership', text: 'Budgets are allocated for this year. Circle back in March 2027.' });
  const later = await api('POST', `/api/leads/${lead2.id}/triage`, { category: 'not-now' });
  assert.equal(later.payload.triage.outcome.resumeOn, '2027-03-01');
  assert.equal(later.payload.lead.resumeOn, '2027-03-01');
  await post({ type: 'inbound', from: 'thabo@github.com', subject: 'Re: Partnership', text: 'Actually please unsubscribe me.' });
  state = (await api('GET', '/api/init')).payload.leads.find(l => l.id === lead2.id);
  assert.equal(state.doNotContact, true, 'opt-out replies suppress immediately without waiting for staff');
  assert.equal(state.triage.handled, true);
  assert.equal((await api('POST', `/api/leads/${lead2.id}/sequence/build`, {})).status, 409);
});
