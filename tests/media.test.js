// Four Desks — Release 2 (v61): Marketing desk. Pitches come only from the approved media kit; "what you covered" homework
// keeps ≤12-month pieces; outlets discovered on the Marketing desk become media targets; outcomes booked/published/signed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const media = require('../lib/media');

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

const KIT = { boilerplate: 'Chelo is a South African platform that verifies school projects, checks supplier quotes and signs off every milestone.', facts: ['Chelo pays suppliers directly.', 'Every milestone is signed off.'], spokesperson: 'Emma Nkosi', spokespersonTitle: 'Founder', assetsUrl: 'https://github.com/demo0ps/chelo-outreach' };

test('media module: kit cleaning/approval, pitch tracks use only the kit, outcomes, coverage ≤12 months', async () => {
  const kit = media.cleanKit({ ...KIT, facts: [...KIT.facts, '', '   '] });
  assert.equal(kit.facts.length, 2);
  assert.match(media.kitBlockReason({ ...kit, status: 'draft' }), /waiting for approval/);
  assert.equal(media.kitBlockReason({ ...kit, status: 'approved' }), '');
  assert.match(media.kitBlockReason(media.EMPTY_KIT), /Write the media kit first/);

  const lead = { id: 'l1', company: 'Daily Maverick', contactName: 'News desk', kind: 'media' };
  const project = { name: 'Solar for Sizanani Primary', province: 'Gauteng', outcomes: ['Lights in 12 classrooms.'] };
  const links = { booking: 'https://chelo.test/b/x', optOut: 'https://chelo.test/o/x' };
  const pr = media.pitchStep({ step: 1, lead, project, kit: { ...kit, status: 'approved' }, links, coverage: [{ title: 'Schools without power', url: 'https://dm.test/a', when: 'in March' }] });
  assert.match(pr.subject, /Story idea: Solar for Sizanani Primary in Gauteng/);
  assert.match(pr.body, /Hi there,/, 'generic news desk is not called by a first name');
  assert.match(pr.body, /I read your piece "Schools without power" in March/);
  assert.match(pr.body, /Emma Nkosi, Founder is available for an interview/);
  assert.ok(pr.body.includes(kit.boilerplate) && pr.body.includes(links.optOut) && pr.body.includes(links.booking));
  assert.ok(!/proposal PDF|R\s?\d/.test(pr.body), 'no funder proposal language, no money');
  const partner = media.pitchStep({ step: 1, lead: { ...lead, pitchTrack: 'partnership', contactName: 'Thandi Mokoena' }, project: null, kit: { ...kit, status: 'approved' }, links });
  assert.match(partner.subject, /media partnership/);
  assert.match(partner.body, /^Hi Thandi,/);
  assert.match(media.pitchStep({ step: 2, lead, kit, links }).body, /quick follow-up/);
  assert.match(media.pitchStep({ step: 3, lead, kit, links }).body, /close this thread/);
  assert.deepEqual(media.FOLLOW_UP_OFFSETS, [0, 4, 6]);

  const l2 = { stage: 'Contacted', pitchTrack: 'pr' };
  media.applyOutcome(l2, 'booked', { actor: 'a' }); assert.equal(l2.stage, 'Interested');
  media.applyOutcome(l2, 'published', { actor: 'a' }); assert.equal(l2.stage, 'Won'); assert.ok(l2.outcomes.published.at);
  media.applyOutcome(l2, 'published', { on: false }); assert.equal(l2.outcomes.published, undefined);
  assert.throws(() => media.applyOutcome(l2, 'paid'), /Outcome must be/);

  const old = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
  const recent = new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10);
  const runSearch = async () => [
    { url: `https://www.dailymaverick.co.za/article/${recent}-schools-without-power/`, title: 'Schools without power', snippet: 'learners in Limpopo' },
    { url: `https://www.dailymaverick.co.za/article/${old}-old-story/`, title: 'Old story', snippet: 'school' },
    { url: 'https://www.news24.com/other-outlet', title: 'Other outlet', snippet: 'school' }
  ];
  const brief = await media.coverageBrief({ outlet: 'Daily Maverick', website: 'https://www.dailymaverick.co.za' }, { runSearch, searchConfig: { provider: 'tavily', apiKey: 'k' } });
  assert.equal(brief.status, 'pending-review');
  assert.equal(brief.articles.length, 2, 'other outlets are dropped');
  assert.equal(brief.findings.length, 1, 'only the ≤12-month piece becomes a finding');
  assert.equal(brief.findings[0].kind, 'coverage');
  brief.status = 'approved'; brief.approvedFindingIds = [brief.findings[0].id];
  assert.deepEqual(media.approvedCoverage(brief).map(c => c.title), ['Schools without power']);
});

test('marketing desk end-to-end: kit gate, media target flow, track switch, outcomes, desk-scoped candidates', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chelo-media-'));
  const port = 8900 + Math.floor(Math.random() * 500);
  const child = await startServer({ PORT: String(port), DATA_DIR: dir, NODE_ENV: 'test', SETTINGS_ENCRYPTION_KEY: 'media-key', SMTP_PROBE_DISABLED: 'true' });
  t.after(() => { child.kill('SIGTERM'); });
  const base = `http://127.0.0.1:${port}`;
  const mk = client(base, 'marketing'); const csi = client(base, 'csi');
  assert.equal((await mk('POST', '/api/auth/setup', { username: 'founder@cheloapp.com', displayName: 'Founder', password: 'correct-horse-battery' })).status, 201);
  assert.equal((await csi('POST', '/api/auth/login', { username: 'founder@cheloapp.com', password: 'correct-horse-battery' })).status, 200);

  // Kit starts empty → pitches blocked.
  const k0 = (await mk('GET', '/api/media-kit')).payload;
  assert.equal(k0.kit.status, 'draft'); assert.match(k0.blockReason, /Write the media kit/);

  // A media target on the Marketing desk; the flow stops at the draft until the kit is approved.
  const outlet = (await mk('POST', '/api/leads', { company: 'Daily Maverick', contactName: 'News desk', email: 'newsdesk@github.com', sourceName: 'Masthead', sourceUrl: 'https://github.com/about', projectId: 'proj-chelo-solar-gp' })).payload;
  assert.equal(outlet.kind, 'media', JSON.stringify(outlet));
  const run1 = (await mk('POST', `/api/leads/${outlet.id}/flow`, {})).payload;
  assert.ok(['verified', 'accepted'].includes(run1.flow.steps.verify.status), JSON.stringify(run1.flow.steps.verify));
  assert.equal(run1.flow.steps.draft.status, 'blocked'); assert.match(run1.flow.steps.draft.detail, /media kit/);
  assert.equal(run1.lead.research?.kind, 'coverage', 'media targets get the coverage brief, not the funder brief');

  // Save + approve the kit (saving resets approval).
  assert.equal((await mk('PUT', '/api/media-kit', KIT)).payload.kit.status, 'draft');
  const approved = (await mk('POST', '/api/media-kit/approve', {})).payload;
  assert.equal(approved.kit.status, 'approved'); assert.equal(approved.blockReason, '');
  assert.equal((await mk('PUT', '/api/media-kit', { spokesperson: 'Emma N.' })).payload.kit.status, 'draft', 'editing resets approval');
  assert.equal((await mk('POST', '/api/media-kit/approve', {})).status, 200);

  // Now the PR pitch drafts from the kit, with no proposal PDF.
  const run2 = (await mk('POST', `/api/leads/${outlet.id}/flow`, { redraft: true })).payload;
  assert.equal(run2.flow.steps.draft.status, 'drafted', JSON.stringify(run2.flow.steps.draft));
  assert.equal(run2.flow.steps.draft.mode, 'media-kit');
  assert.match(run2.lead.emailDraft.subject, /^Story idea:/);
  assert.ok(run2.lead.emailDraft.body.includes(KIT.boilerplate));
  assert.ok(!run2.lead.proposalFile);

  // Switch track → partnership pitch, no project needed.
  assert.equal((await mk('PATCH', `/api/leads/${outlet.id}`, { pitchTrack: 'partnership', projectId: '' })).status, 200);
  const run3 = (await mk('POST', `/api/leads/${outlet.id}/flow`, { redraft: true })).payload;
  assert.equal(run3.flow.steps.match.status, 'set');
  assert.match(run3.lead.emailDraft.subject, /media partnership/);

  // Outcomes: booked → Interested; signed (partnership) → Won.
  assert.equal((await mk('PUT', `/api/leads/${outlet.id}/outcome`, { outcome: 'booked' })).payload.lead.stage, 'Interested');
  assert.equal((await mk('PUT', `/api/leads/${outlet.id}/outcome`, { outcome: 'signed' })).payload.lead.stage, 'Won');
  assert.equal((await mk('PUT', `/api/leads/${outlet.id}/outcome`, { outcome: 'paid' })).status, 400);

  // CSV rows imported on the Marketing desk land in the Marketing pool only; the CSI desk never sees them.
  const imp = (await mk('POST', '/api/import', { source: 'csv', candidates: [{ company: 'Mail & Guardian', contactName: 'Education desk', email: 'education@github.com', sourceName: 'Masthead', sourceUrl: 'https://github.com/about', csvRowNumber: 2 }] })).payload;
  assert.equal(imp.imported, 1, JSON.stringify(imp));
  const mkInit = (await mk('GET', '/api/init')).payload; const csiInit = (await csi('GET', '/api/init')).payload;
  assert.ok(mkInit.candidates.some(c => c.company === 'Mail & Guardian' && c.kind === 'media'));
  assert.ok(!csiInit.candidates.some(c => c.company === 'Mail & Guardian'));
  assert.ok(mkInit.mediaKit && mkInit.mediaKit.status === 'approved', 'the Marketing desk gets the kit with init');
  assert.equal(csiInit.mediaKit, undefined);
  assert.ok(!csiInit.leads.some(l => l.id === outlet.id), 'media target stays off the CSI desk');
  const cand = mkInit.candidates.find(c => c.company === 'Mail & Guardian');
  const promoted = (await mk('POST', `/api/candidates/${cand.id}/promote`, {})).payload;
  assert.equal(promoted.lead?.kind, 'media', JSON.stringify(promoted));
});
