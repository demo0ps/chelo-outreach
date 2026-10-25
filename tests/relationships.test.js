const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const rel = require('../lib/relationships');

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

test('org graph: company ↔ foundation by name and domain, people, projects and pledges hang off one org node', () => {
  const leads = [
    { id: 'L1', company: 'Sasol Ltd', website: 'https://sasol.com', foundationName: 'Sasol Foundation', projectId: 'P1', stage: 'Won', sector: 'Energy' },
    { id: 'L2', company: 'Sasol Foundation', email: 'csi@sasolfoundation.org.za', parentCompany: 'Sasol', projectId: 'P2', stage: 'Interested' },
    { id: 'L3', company: 'Sasol (Pty) Limited', email: 'someone@sasol.com', stage: 'New' } // same domain → same node
  ];
  const partners = [{ id: 'PT1', leadId: 'L1', company: 'Sasol Ltd', projectId: 'P1', website: 'https://sasol.com' }];
  const people = [{ id: 'PE1', leadId: 'L1', name: 'Naledi M', role: 'csi-lead' }, { id: 'PE2', partnerId: 'PT1', name: 'Thabo K', role: 'introducer' }];
  const projects = [{ id: 'P1', name: 'Solar for Schools' }, { id: 'P2', name: 'Literacy WC' }];
  const pledges = [{ id: 'PL1', partnerId: 'PT1', amount: 250000, period: 'annual', status: 'pledged', projectId: 'P1' }];
  const g = rel.buildOrgGraph({ leads, partners, people, projects, pledges });
  const orgs = g.nodes.filter(n => n.type === 'org');
  assert.equal(orgs.length, 2, 'three records collapse into two organisation nodes');
  const sasol = orgs.find(o => o.id === 'd:sasol.com');
  assert.ok(sasol && sasol.partner && sasol.records.length === 3, 'lead + partner + same-domain lead share a node');
  const foundation = orgs.find(o => o.kind === 'foundation');
  assert.ok(g.edges.some(e => e.type === 'operates-foundation' && e.from === sasol.id && e.to === foundation.id));
  const hood = rel.neighbourhood(g, 'PT1');
  assert.equal(hood.people.length, 2); assert.equal(hood.foundations.length, 1); assert.equal(hood.foundations[0].direction, 'child');
  assert.equal(hood.projects.find(p => p.label === 'Solar for Schools').relation, 'funds');
  assert.equal(hood.pledges[0].amount, 250000);
  assert.ok(rel.neighbourhood(g, 'L2').foundations[0].direction === 'parent');
  assert.equal(rel.orgKey({ company: 'Umoya', email: 'x@gmail.com' }), 'n:umoya', 'freemail never becomes an org key');
});

test('stewardship plan: deterministic, idempotent, renewal anchored to FYE, pledge follow-up only when unpaid', () => {
  const now = new Date('2026-10-26T08:00:00Z');
  const partner = { id: 'PT1', leadId: 'L1', company: 'Sasol', status: 'Active', partnerSince: '2026-10-20T09:00:00Z', financialYearEnd: 6 };
  const plan = rel.planStewardship(partner, { now });
  const keys = plan.map(t => t.cadenceKey);
  assert.deepEqual(keys.slice(0, 3), ['thank-you', 'welcome-pack', 'site-visit']);
  assert.ok(keys.includes('impact-update:1'), 'first quarterly update within the 120-day horizon');
  const renewal = plan.find(t => t.cadenceKey.startsWith('renewal:'));
  assert.ok(renewal, 'renewal task present'); assert.equal(renewal.cadenceKey, 'renewal:2027-06-30'); assert.match(renewal.detail, /financial year-end Jun/);
  assert.equal(renewal.dueAt.slice(0, 10), '2027-03-02', 'opens 120 days before FYE');
  // idempotent reconcile
  const existing = plan.map(t => ({ ...t, id: 'x', status: 'done' }));
  assert.equal(rel.reconcileTasks(existing, rel.planStewardship(partner, { now })).length, 0);
  // pledge due date passed and unpaid → follow-up; paid → none
  const unpaid = [{ id: 'PL1', amount: 100000, dueAt: '2026-10-10T09:00:00Z', status: 'pledged' }];
  const withPledge = rel.planStewardship(partner, { now, pledges: unpaid });
  const follow = withPledge.find(t => t.cadenceKey === 'pledge-follow-up:PL1');
  assert.ok(follow && follow.dueAt.slice(0, 10) === '2026-10-26', 'overdue pledge follow-up is due now');
  assert.equal(rel.planStewardship(partner, { now, pledges: [{ ...unpaid[0], receivedAt: '2026-10-11T00:00:00Z' }] }).some(t => t.cadenceKey.startsWith('pledge-follow-up')), false);
  // pledge renewal date beats FYE
  const r = rel.renewalAnchor(partner, [{ id: 'PL2', status: 'pledged', renewalAt: '2027-02-01T09:00:00Z' }], now);
  assert.equal(r.basis, 'pledge renewal date');
  assert.equal(rel.planStewardship({ ...partner, status: 'Inactive' }, { now }).length, 0);
});

test('timeline + health: merges every channel, newest first, CSV export; health degrades with silence and overdue pledges', () => {
  const now = new Date('2026-10-26T08:00:00Z');
  const lead = { id: 'L1', company: 'Umoya', createdAt: '2026-07-01T08:00:00Z', triage: { receivedAt: '2026-08-02T08:00:00Z', category: 'interested', excerpt: 'Keen, send more' } };
  const partner = { id: 'PT1', leadId: 'L1', company: 'Umoya', partnerSince: '2026-09-01T08:00:00Z' };
  const rows = rel.timelineFor({ lead, partner,
    messages: [{ id: 'M1', leadId: 'L1', sentAt: '2026-08-01T08:00:00Z', subject: 'Solar partnership' }, { id: 'M2', leadId: 'other', sentAt: '2026-08-01T08:00:00Z' }],
    emailEvents: [{ id: 'E1', leadId: 'L1', type: 'open', occurredAt: '2026-08-01T10:00:00Z' }],
    bookings: [{ id: 'B1', leadId: 'L1', status: 'Confirmed', date: '2026-08-10', time: '10:00', createdAt: '2026-08-03T08:00:00Z' }],
    touches: [{ id: 'T1', partnerId: 'PT1', kind: 'site-visit', summary: 'Visited Soweto school', at: '2026-09-20T08:00:00Z', actor: 'Nandi' }],
    pledges: [{ id: 'PL1', partnerId: 'PT1', amount: 250000, period: 'annual', pledgedAt: '2026-09-02T08:00:00Z', dueAt: '2026-10-01T08:00:00Z' }],
    tasks: [{ id: 'S1', partnerId: 'PT1', status: 'done', title: 'Send a personal thank-you', doneAt: '2026-09-03T08:00:00Z', doneBy: 'Nandi' }] });
  assert.equal(rows.filter(r => r.ref === 'M2').length, 0, 'other leads excluded');
  assert.ok(rows.every((r, i) => i === 0 || rows[i - 1].at >= r.at), 'newest first');
  assert.deepEqual([...new Set(rows.map(r => r.kind))].sort(), ['created', 'email-in', 'email-out', 'meeting', 'pledge', 'signal', 'site-visit', 'stewardship', 'won']);
  assert.equal(rel.lastTouch(rows).kind, 'site-visit');
  assert.equal(rel.lastInbound(rows).kind, 'site-visit');
  const csv = rel.timelineCsv(rows, { organisation: 'Umoya, Inc' });
  assert.match(csv.split('\r\n')[0], /^organisation,at,kind,title/); assert.match(csv, /"Umoya, Inc"/);
  assert.equal(csv.trim().split('\r\n').length, rows.length + 1);

  assert.equal(rel.relationshipHealth({ lastTouchAt: '2026-10-20T00:00:00Z', now }).status, 'warm');
  assert.equal(rel.relationshipHealth({ lastTouchAt: '2026-09-01T00:00:00Z', now }).status, 'cooling');
  assert.equal(rel.relationshipHealth({ lastTouchAt: '2026-06-01T00:00:00Z', now }).status, 'cold');
  assert.equal(rel.relationshipHealth({ now }).status, 'cold');
  const risk = rel.relationshipHealth({ lastTouchAt: '2026-10-20T00:00:00Z', overduePledges: 1, now });
  assert.equal(risk.status, 'at-risk'); assert.match(risk.reasons.join(' '), /pledge overdue/);
  assert.deepEqual(rel.pledgeTotals([{ amount: 100, status: 'pledged', dueAt: '2026-09-01T00:00:00Z' }, { amount: 50, receivedAt: '2026-09-01T00:00:00Z' }, { amount: 999, status: 'cancelled' }], now), { pledged: 150, received: 50, overdue: 100, outstanding: 100 });
});

test('relationships API: Won → partner + stewardship plan; people/touches/pledges; task done logs a touch; pledge received retires follow-up; CSV export; summary', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chelo-rel-'));
  const port = 7000 + Math.floor(Math.random() * 500);
  const child = await startServer({ PORT: String(port), DATA_DIR: dir, NODE_ENV: 'test', SETTINGS_ENCRYPTION_KEY: 'rel-key', SMTP_PROBE_DISABLED: 'true' });
  t.after(() => { child.kill('SIGTERM'); });
  const base = `http://127.0.0.1:${port}`;
  const jar = { cookie: '', csrf: '' };
  const api = async (method, url, body, raw = false) => {
    const headers = { 'Content-Type': 'application/json', Origin: base };
    if (jar.cookie) headers.Cookie = jar.cookie;
    if (jar.csrf) headers['X-CSRF-Token'] = jar.csrf;
    const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = res.headers.get('set-cookie'); if (setCookie) jar.cookie = setCookie.split(';')[0];
    if (raw) return { status: res.status, text: await res.text(), headers: res.headers };
    const payload = (res.headers.get('content-type') || '').includes('application/json') ? await res.json() : null;
    if (payload && payload.csrfToken) jar.csrf = payload.csrfToken;
    return { status: res.status, payload };
  };
  assert.equal((await api('POST', '/api/auth/setup', { username: 'admin@cheloapp.com', displayName: 'Nandi', password: 'correct-horse-battery' })).status, 201);

  const created = await api('POST', '/api/leads', { company: 'Umoya Holdings', contactName: 'Sipho Dlamini', title: 'Head of CSI', email: 'sipho@github.com', sector: 'Education', projectId: 'proj-chelo-solar-gp', amount: 250000, introducer: 'Thabo Kekana', introducedVia: 'Trialogue conference', financialYearEnd: 6, sourceName: 'Website', sourceUrl: 'https://github.com' });
  assert.equal(created.status, 201);
  const leadId = created.payload.id;
  assert.equal(created.payload.introducer, 'Thabo Kekana');
  const listed = (await api('GET', '/api/leads')).payload.find(l => l.id === leadId);
  assert.match(listed.fit.components.warmth.reason, /introduced by Thabo/);

  // Prospect-side relationship: timeline + touches before it is won
  let view = (await api('GET', `/api/relationships/${leadId}`)).payload;
  assert.equal(view.isPartner, false); assert.equal(view.company, 'Umoya Holdings'); assert.ok(view.timeline.some(r => r.kind === 'created'));
  const touched = await api('POST', `/api/relationships/${leadId}/touches`, { kind: 'call', summary: 'Intro call with Sipho; wants the solar proposal', personName: 'Sipho Dlamini' });
  assert.equal(touched.status, 201); assert.equal(touched.payload.lastTouch.kind, 'call'); assert.equal(touched.payload.health.status, 'warm');

  // Win → partner created with relationship fields + stewardship plan
  const won = await api('PATCH', `/api/leads/${leadId}`, { stage: 'Won' });
  assert.equal(won.status, 200);
  view = (await api('GET', `/api/relationships/${leadId}`)).payload;
  assert.equal(view.isPartner, true); assert.ok(view.partnerId); assert.equal(view.introducer, 'Thabo Kekana'); assert.equal(view.financialYearEnd, 6);
  const keys = view.tasks.map(x => x.cadenceKey);
  assert.ok(keys.includes('thank-you') && keys.includes('welcome-pack') && keys.some(k => k.startsWith('renewal:')), `plan keys: ${keys}`);
  assert.ok(view.renewal && /year-end Jun/.test(view.renewal.basis));
  const before = view.tasks.length;
  await api('POST', '/api/stewardship/tick', {});
  assert.equal((await api('GET', `/api/relationships/${view.partnerId}`)).payload.tasks.length, before, 'tick is idempotent');

  // People (PII masked in responses; introducer role backfills)
  const person = await api('POST', `/api/relationships/${view.partnerId}/people`, { name: 'Naledi Mokoena', title: 'CSI Manager', role: 'csi-lead', email: 'naledi@github.com' });
  assert.equal(person.status, 201); assert.equal(person.payload.people[0].email, 'n***@github.com');
  assert.equal(person.payload.graph.people.length, 1);
  assert.equal((await api('POST', `/api/relationships/${view.partnerId}/people`, { name: '' })).status, 400);

  // Pledge: overdue due date → follow-up task appears; marking received retires it
  const pledged = await api('POST', `/api/relationships/${view.partnerId}/pledges`, { amount: 250000, period: 'annual', pledgedAt: '2026-09-01', dueAt: '2026-09-30' });
  assert.equal(pledged.status, 201);
  assert.equal(pledged.payload.pledges[0].status, 'overdue'); assert.equal(pledged.payload.health.status, 'at-risk');
  const follow = pledged.payload.tasks.find(x => x.cadenceKey === `pledge-follow-up:${pledged.payload.pledges[0].id}`);
  assert.ok(follow, 'overdue pledge scheduled a follow-up');
  const received = await api('PATCH', `/api/relationships/${view.partnerId}/pledges/${pledged.payload.pledges[0].id}`, { status: 'received', receivedAt: '2026-10-05' });
  assert.equal(received.payload.pledges[0].status, 'received');
  assert.equal(received.payload.tasks.find(x => x.id === follow.id).status, 'skipped');
  assert.equal(received.payload.pledgeTotals.received, 250000); assert.notEqual(received.payload.health.status, 'at-risk');

  // Complete a stewardship task → logged as a touch on the timeline
  const thank = received.payload.tasks.find(x => x.cadenceKey === 'thank-you');
  const done = await api('POST', `/api/stewardship/tasks/${thank.id}`, { action: 'done', note: 'Called Sipho personally' });
  assert.equal(done.payload.task.status, 'done');
  view = (await api('GET', `/api/relationships/${view.partnerId}`)).payload;
  assert.ok(view.timeline.some(r => r.kind === 'thank-you' && /thank-you/i.test(r.title)));
  assert.ok(view.touches.some(x => x.taskId === thank.id));
  const snoozed = await api('POST', `/api/stewardship/tasks/${view.tasks.find(x => x.cadenceKey === 'welcome-pack').id}`, { action: 'snooze', days: 3 });
  assert.ok(new Date(snoozed.payload.task.dueAt) > new Date());

  // Manual touch with an agreed next step creates a dated task
  const meet = await api('POST', `/api/relationships/${view.partnerId}/touches`, { kind: 'meeting', summary: 'Quarterly review', nextDueAt: '2026-12-01', nextAction: 'Send Q4 spend report' });
  assert.ok(meet.payload.tasks.some(x => x.title === 'Send Q4 spend report' && x.dueAt.startsWith('2026-12-01')));

  // CSV export
  const csv = await api('GET', `/api/relationships/${view.partnerId}/timeline.csv`, undefined, true);
  assert.equal(csv.status, 200); assert.match(csv.headers.get('content-disposition'), /Umoya-Holdings-timeline\.csv/);
  assert.match(csv.text, /^organisation,at,kind,title/); assert.match(csv.text, /Intro call with Sipho/);

  // Summary
  const summary = (await api('GET', '/api/relationships')).payload;
  assert.equal(summary.totals.partners >= 1, true); assert.ok(summary.stewardship.open >= 1);
  assert.ok(summary.partners.find(p => p.company === 'Umoya Holdings').people === 1);
  assert.ok(summary.renewals.length >= 0 && Array.isArray(summary.cadence) && summary.graph.orgs >= 1);
  assert.equal((await api('GET', '/api/relationships/nope')).status, 404);

  // Partner PATCH carries relationship fields back to the lead
  const patched = await api('PATCH', `/api/partners/${view.partnerId}`, { foundationName: 'Umoya Foundation', renewalAt: '2027-04-01' });
  assert.equal(patched.payload.foundationName, 'Umoya Foundation');
  const after = (await api('GET', `/api/relationships/${view.partnerId}`)).payload;
  assert.equal(after.renewal.at, '2027-04-01'); assert.equal(after.renewal.basis, 'renewal date on record');
  assert.ok(after.tasks.some(x => x.cadenceKey === 'renewal:2027-04-01'));

  // Persisted across restart
  child.kill('SIGTERM'); await new Promise(r => child.on('exit', r));
  const child2 = await startServer({ PORT: String(port), DATA_DIR: dir, NODE_ENV: 'test', SETTINGS_ENCRYPTION_KEY: 'rel-key', SMTP_PROBE_DISABLED: 'true' });
  t.after(() => { child2.kill('SIGTERM'); });
  jar.cookie = ''; jar.csrf = '';
  assert.equal((await api('POST', '/api/auth/login', { username: 'admin@cheloapp.com', password: 'correct-horse-battery' })).status, 200);
  const persisted = (await api('GET', `/api/relationships/${view.partnerId}`)).payload;
  assert.equal(persisted.people.length, 1); assert.equal(persisted.pledges.length, 1); assert.ok(persisted.tasks.length >= 5); assert.ok(persisted.touches.length >= 3);
});
