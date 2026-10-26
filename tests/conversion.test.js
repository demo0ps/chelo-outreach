const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const conversion = require('../lib/conversion');
const sequences = require('../lib/sequences');

const ROOT = path.join(__dirname, '..');
const NOW = new Date('2026-10-26T08:00:00Z'); // Monday
const project = { id: 'p1', name: 'Repainting of School', recipientName: 'Philemon Montsho Primary', province: 'Gauteng', summary: '24 classrooms inside and outside', sector: 'Education', targetAmount: 84200, committedAmount: 35300, verifiedMetrics: [{ label: 'Classrooms repainted', baselineValue: 0, currentValue: 24, unit: 'classrooms' }], status: 'Verified' };
const lead = { id: 'l1', company: 'Bolt South Africa', contactName: 'Naledi Mokoena', email: 'csi@github.com', sector: 'Mobility', bookingToken: 'tok-1' };
const links = { page: 'https://x/p/tok-1', booking: 'https://x/book/tok-1', optOut: 'https://x/opt-out/tok-1' };

test('conversion: template auto-pick follows cheloapp categories', () => {
  assert.equal(conversion.templateFor(project), 'classroom');
  assert.equal(conversion.templateFor({ name: 'Solar + e-learning lab', summary: 'tablets and screens' }), 'ict');
  assert.equal(conversion.templateFor({ name: 'Ablution block', summary: 'build 6 toilets and a borehole' }), 'construction');
  assert.equal(conversion.templateFor(null), 'classroom');
});

test('conversion: picture puts the funder in the frame, custom picture wins', () => {
  const auto = conversion.pictureFor({ project, lead, now: NOW });
  assert.match(auto, /Philemon Montsho Primary, Gauteng/); assert.match(auto, /Bolt South Africa/); assert.match(auto, /0 to 24/);
  const custom = conversion.pictureFor({ project: { ...project, picture: 'Picture the first day of term with {{company}} on the wall.' }, lead });
  assert.equal(custom, 'Picture the first day of term with Bolt South Africa on the wall.');
});

test('conversion: 4-step ladder — no link + one question at step 1, page link at step 2, two slots at step 3, close at 4', () => {
  const slots = conversion.proposedSlots(NOW);
  assert.equal(slots.length, 2);
  assert.ok(slots.every(s => ['Tue', 'Thu'].includes(new Date(`${s.date}T12:00:00Z`).toUTCString().slice(0, 3))), JSON.stringify(slots));
  assert.ok(slots.every(s => new Date(`${s.date}T00:00:00Z`) >= new Date('2026-10-28T00:00:00Z')), 'at least two business days out');
  const s1 = conversion.ladderStep({ step: 1, lead, project, links, slots, now: NOW, staff: { name: 'Nandi' } });
  assert.ok(!/https?:\/\//.test(s1.body.replace(links.optOut, '')), 'step 1 carries no link beyond opt-out');
  assert.equal((s1.body.match(/\?/g) || []).length, 1);
  assert.ok(conversion.words(s1.body) <= 125, `step 1 is ${conversion.words(s1.body)} words`);
  assert.match(s1.body, /Worth a one-page look\?/);
  const s2 = conversion.ladderStep({ step: 2, lead, project, links, slots, now: NOW });
  assert.ok(s2.body.includes(links.page)); assert.match(s2.body, /15-minute/);
  const s3 = conversion.ladderStep({ step: 3, lead, project, links, slots, now: NOW });
  assert.ok(s3.body.includes(slots[0].label) && s3.body.includes(slots[1].label));
  const s4 = conversion.ladderStep({ step: 4, lead, project, links, slots, now: NOW });
  assert.match(s4.body, /closing the loop/i);
  for (const [n, s] of [[1, s1], [2, s2], [3, s3], [4, s4]]) {
    const r = conversion.lint(`${s.subject}\n${s.body}`, { project, lead, step: n });
    assert.equal(r.blocks, 0, `step ${n} passes its own guardrail: ${JSON.stringify(r.issues)}`);
  }
  const plan = sequences.buildPlan({ lead: { ...lead, emailDraft: { subject: s1.subject, body: s1.body } }, links, project, now: NOW, slots, ladder: step => conversion.ladderStep({ step, lead, project, links, slots, now: NOW }) });
  assert.ok(plan.steps[1].body.includes(links.page), 'sequence step 2 uses the ladder');
  assert.ok(plan.steps[2].body.includes(slots[0].label));
});

test('conversion: guardrail blocks manipulation and invented numbers, warns on length/asks, respects project numbers', () => {
  const bad = conversion.lint('Last chance! Only 3 spots left. We have helped 12 000 learners and 40 schools. Shall we talk? Or call? Guaranteed impact.', { project, lead, step: 1 });
  const types = bad.issues.map(i => i.type);
  assert.ok(types.includes('false urgency') && types.includes('manufactured scarcity') && types.includes('unfounded guarantee'));
  assert.ok(bad.issues.some(i => i.type.startsWith('number not traceable') && i.text === '12'), JSON.stringify(bad.issues));
  assert.ok(bad.issues.some(i => i.text === '40'));
  assert.ok(bad.issues.some(i => i.type.includes('more than one question')));
  assert.equal(bad.ok, false);
  const good = conversion.lint('24 classrooms at Philemon Montsho Primary, R84k budget, R7m+ traceably donated by 500+ donors. A 15-minute call on Tuesday at 10:00 in 2026?', { project, lead, step: 2 });
  assert.equal(good.blocks, 0, JSON.stringify(good.issues));
  const implied = conversion.lint('As we discussed, here is the page.', { project, lead, step: 2 });
  assert.ok(implied.issues.some(i => i.type === 'implied prior relationship'));
  assert.equal(conversion.lint('As we discussed, here is the page.', { project, lead: { ...lead, lastContactedAt: '2026-10-01' }, step: 2 }).blocks, 0);
});

test('conversion: hosted page model — numbers, slots, expiry after last step, funded/DNC fallbacks', () => {
  const seq = { steps: [{ n: 1, status: 'sent', sentAt: '2026-10-26T08:00:00Z' }, { n: 2, status: 'planned', scheduledAt: '2026-10-29T08:00:00Z' }, { n: 3, status: 'skipped', scheduledAt: '2026-12-01T08:00:00Z' }] };
  assert.equal(conversion.pageExpiry({ sequence: seq }).slice(0, 10), '2026-11-28');
  const m = conversion.pageModel({ lead: { ...lead, sequence: seq }, project, funding: { gap: 48900, committed: 35300 }, now: NOW });
  assert.equal(m.expired, false); assert.equal(m.template, 'classroom'); assert.equal(m.image, '/brand/templates/classroom.jpg');
  assert.equal(m.headline, 'Bolt South Africa × Philemon Montsho Primary');
  assert.ok(m.numbers.some(n => n.value === 'R7m+') && m.numbers.some(n => n.value === 'R49k'));
  assert.equal(m.slots.length, 2); assert.equal(m.bookingPath, '/book/tok-1');
  assert.equal(conversion.pageModel({ lead: { ...lead, sequence: seq }, project, funding: { gap: 0 }, now: NOW }).reason, 'funded');
  assert.equal(conversion.pageModel({ lead: { ...lead, doNotContact: true }, project, now: NOW }).reason, 'closed');
  const old = conversion.pageModel({ lead: { ...lead, pageExpiresAt: '2026-01-01T00:00:00Z' }, project, now: NOW });
  assert.equal(old.reason, 'expired'); assert.match(old.fallback.href, /cheloapp\.com\/projects/);
});

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

test('conversion API: ladder draft, guardrail blocks approval (422) and admin override, public page view = warmth event, slot booking', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chelo-conv-'));
  const port = 6400 + Math.floor(Math.random() * 500);
  const child = await startServer({ PORT: String(port), DATA_DIR: dir, NODE_ENV: 'test', SETTINGS_ENCRYPTION_KEY: 'conv-key', SMTP_PROBE_DISABLED: 'true' });
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
  const settings = (await api('GET', '/api/init')).payload.settings;
  assert.equal(settings.outreachStyle, 'ladder'); assert.equal(settings.guardrail, 'block');

  const l = (await api('POST', '/api/leads', { company: 'Umoya Holdings', contactName: 'Sipho Dlamini', email: 'sipho@github.com', sector: 'Mining', projectId: 'proj-chelo-solar-gp', sourceName: 'Website', sourceUrl: 'https://github.com' })).payload;
  const flow = await api('POST', `/api/leads/${l.id}/flow`, {});
  assert.equal(flow.status, 200, JSON.stringify(flow.payload));
  const draft = flow.payload.lead.emailDraft;
  assert.match(draft.body, /Worth a one-page look\?/, 'fallback first touch uses the ladder');
  assert.ok(!/\/book\//.test(draft.body), 'no booking link in step 1');

  // Guardrail: an edited draft with false urgency + an invented number is blocked, reason surfaced
  const blocked = await api('POST', `/api/leads/${l.id}/approve-email`, { subject: draft.subject, body: `${draft.body}\n\nLast chance — we reached 9 000 learners.` });
  assert.equal(blocked.status, 422, JSON.stringify(blocked.payload));
  assert.match(blocked.payload.error, /false urgency/); assert.ok(blocked.payload.guardrail.issues.some(i => i.text === '9'));
  const overridden = await api('POST', `/api/leads/${l.id}/approve-email`, { subject: draft.subject, body: `${draft.body}\n\nLast chance — we reached 9 000 learners.`, overrideGuardrail: 'Figure confirmed by Chelo ops; funder asked for a reminder' });
  assert.ok([200, 409].includes(overridden.status), JSON.stringify(overridden.payload));
  const audit = (await api('GET', '/api/audit?action=guardrail.overridden')).payload.entries;
  assert.ok(JSON.stringify(audit).includes('guardrail.overridden'));

  // Warn mode lets the same text through
  assert.equal((await api('PUT', '/api/settings', { guardrail: 'warn' })).status, 200);
  const lead2 = (await api('POST', '/api/leads', { company: 'Thembi Mining', contactName: 'Zanele Khumalo', email: 'zanele@github.com', sector: 'Mining', projectId: 'proj-chelo-solar-gp', sourceName: 'Website', sourceUrl: 'https://github.com' })).payload;
  await api('POST', `/api/leads/${lead2.id}/flow`, {});
  const seqBuilt = await api('POST', `/api/leads/${lead2.id}/sequence/build`, {});
  assert.equal(seqBuilt.status, 201, JSON.stringify(seqBuilt.payload));
  assert.ok(seqBuilt.payload.sequence.steps[1].body.includes(`/p/${lead2.bookingToken}`), 'step 2 links the hosted page');
  assert.ok(seqBuilt.payload.sequence.steps[2].body.match(/Tue|Thu/), 'step 3 proposes two real slots');

  // Public page: view is recorded as a page_view event + warmth; booking from a slot works without auth
  const pub = await fetch(`${base}/api/public/page/${lead2.bookingToken}`); const page = await pub.json();
  assert.equal(pub.status, 200); assert.equal(page.expired, false); assert.equal(page.company, 'Thembi Mining');
  assert.ok(page.numbers.some(n => n.value === 'R7m+')); assert.equal(page.slots.length, 2); assert.match(page.image, /\/brand\/templates\/(classroom|construction|ict)\.jpg/);
  const html = await fetch(`${base}/p/${lead2.bookingToken}`); assert.equal(html.status, 200); assert.match(await html.text(), /<div id="app"/);
  const init = (await api('GET', '/api/init')).payload;
  const st = init.leads.find(x => x.id === lead2.id);
  assert.equal(st.pageViews, 1);
  assert.ok((init.emailEvents || []).some(e => e.leadId === lead2.id && e.type === 'page_view') || st.lastPageViewAt);
  const book = await fetch(`${base}/api/public/booking/${lead2.bookingToken}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Zanele Khumalo', email: 'zanele@github.com', organization: 'Thembi Mining', date: page.slots[0].date, time: page.slots[0].time, note: 'Booked from partnership page' }) });
  assert.equal(book.status, 201, await book.text());
  assert.equal((await fetch(`${base}/api/public/page/does-not-exist`)).status, 404);

  // Project picture field round-trips
  const projects = (await api('GET', '/api/init')).payload.projects;
  const p = projects.find(x => x.id === 'proj-chelo-solar-gp');
  const upd = await api('PUT', `/api/projects/${p.id}`, { ...p, picture: 'Picture January: 300 learners on screens lit by {{company}}.' });
  assert.equal(upd.status, 200, JSON.stringify(upd.payload));
  const pub2 = await (await fetch(`${base}/api/public/page/${lead2.bookingToken}?preview=1`)).json();
  assert.equal(pub2.picture, 'Picture January: 300 learners on screens lit by Thembi Mining.');
});
