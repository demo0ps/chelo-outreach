const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const de = require('../lib/data-engine');

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

test('identity resolution: registrable domains, fuzzy names, exact vs likely duplicates, field-level merge', () => {
  assert.equal(de.registrableDomain('https://www.csi.angloamerican.co.za/about'), 'angloamerican.co.za');
  assert.equal(de.registrableDomain('naledi@mail.sasol.com'), 'sasol.com');
  assert.equal(de.registrableDomain('foundation.nedbank.co.za'), 'nedbank.co.za');
  assert.ok(de.nameSimilarity('Anglo American Platinum Ltd', 'Anglo American Platinum (Pty) Limited') >= 0.97, 'legal suffixes ignored');
  assert.ok(de.nameSimilarity('Umoya Holdings', 'Umoja Holdings') >= 0.7, 'one-letter typo still similar');
  assert.ok(de.nameSimilarity('Umoya Holdings', 'Thabo Capital') < 0.3);
  assert.ok(de.nameSimilarity('Nedbank', 'Standard Bank') < 0.6, 'sharing the word bank is not a match');

  const pools = { leads: [{ id: 'L1', company: 'Umoya Holdings', email: 'sipho@umoya.co.za' }, { id: 'L2', company: 'Thabo Capital', email: 't@thabo.co.za' }], candidates: [{ id: 'C1', company: 'Sasol', email: '', website: 'https://sasol.com' }], partners: [] };
  const exact = de.findDuplicates({ company: 'Umoya Holdings (Pty) Ltd', email: 'naledi@umoya.co.za' }, pools);
  assert.equal(exact[0].id, 'L1'); assert.equal(exact[0].level, 'exact'); assert.match(exact[0].reasons.join(' '), /same domain/);
  const sameEmail = de.findDuplicates({ company: 'Totally Different', email: 'SIPHO@umoya.co.za' }, pools);
  assert.equal(sameEmail[0].level, 'exact'); assert.match(sameEmail[0].reasons[0], /same email/);
  const typo = de.findDuplicates({ company: 'Umoja Holdings', email: '' }, pools);
  assert.equal(typo[0].id, 'L1'); assert.equal(typo[0].level, 'likely');
  const foundation = de.findDuplicates({ company: 'Sasol Foundation', email: 'x@sasolfoundation.org.za' }, pools);
  assert.equal(foundation[0].id, 'C1'); assert.equal(foundation[0].level, 'likely', 'same core name, different domains → human decides');
  assert.equal(de.findDuplicates({ company: 'Brand New Org', email: 'a@brandnew.co.za' }, pools).length, 0);
  assert.equal(de.findDuplicates({ company: 'Umoya Holdings', email: 'x@gmail.com' }, { leads: [{ id: 'L9', company: 'Other Org', email: 'y@gmail.com' }] }).length, 0, 'freemail domains never link records');

  const primary = { id: 'L1', company: 'Umoya Holdings', email: 'sipho@umoya.co.za', contactName: '', sector: 'Mining', notes: 'met at Trialogue', amount: 0 };
  const filled = de.mergeRecords(primary, { id: 'L3', company: 'Umoya', contactName: 'Naledi Mokoena', title: 'Head of CSI', sector: 'Energy', amount: 250000, notes: 'CSV import', research: { status: 'approved' } });
  assert.deepEqual(filled, ['contactName', 'title', 'amount', 'research']);
  assert.equal(primary.sector, 'Mining', 'primary values win'); assert.match(primary.notes, /merged: CSV import/); assert.equal(primary.mergedFrom[0].id, 'L3');
});

test('freshness & quality: >90d verification flags re-verify; grades combine freshness, completeness and verification', () => {
  const now = new Date('2026-10-27T08:00:00Z');
  const fresh = { company: 'A', contactName: 'B C', title: 'T', email: 'a@b.co.za', website: 'https://b.co.za', sector: 'S', province: 'GP', sourceUrl: 'https://b.co.za', projectId: 'p', mailboxCheck: { status: 'deliverable', checkedAt: '2026-10-20T00:00:00Z' }, research: { generatedAt: '2026-10-15T00:00:00Z' }, updatedAt: '2026-10-20T00:00:00Z' };
  const q1 = de.dataQuality(fresh, now);
  assert.equal(q1.grade, 'A'); assert.equal(q1.reverifyDue, false); assert.equal(q1.freshness.label, 'fresh');
  const old = { ...fresh, mailboxCheck: { status: 'deliverable', checkedAt: '2026-06-01T00:00:00Z' }, research: { generatedAt: '2026-06-01T00:00:00Z' }, updatedAt: '2026-06-01T00:00:00Z' };
  const q2 = de.dataQuality(old, now);
  assert.equal(q2.reverifyDue, true); assert.match(q2.freshness.reasons.join(' '), /verified 148d ago/); assert.match(q2.freshness.reasons.join(' '), /research 148d old/);
  assert.ok(q2.score < q1.score);
  const never = de.dataQuality({ company: 'X', email: 'x@y.co.za' }, now);
  assert.equal(never.reverifyDue, true); assert.ok(['C', 'D'].includes(never.grade)); assert.ok(never.completeness.missing.includes('contactName'));
  assert.equal(de.dataQuality({ company: 'No Email' }, now).reverifyDue, false, 'nothing to verify without an email');
});

test('contact waterfall: names + titles only, per-hop confidence compounds, PII never surfaces, skipped hops are explicit', async () => {
  const people = de.extractPeople('Our CSI team. Naledi Mokoena, Head of Corporate Social Investment, leads the programme. Head of Sustainability: Thabo Nkosi. Email naledi@x.co.za or call 011 555 1234. Sipho Dlamini is our Transformation Manager. John Smith, Chief Financial Officer. Read More, Head Office');
  assert.deepEqual(people.map(p => p.name), ['Naledi Mokoena', 'Thabo Nkosi', 'Sipho Dlamini'], 'CFO and nav text excluded');
  assert.ok(!JSON.stringify(people).includes('@'));
  assert.equal(de.combineConfidence([0.8, 0.7]), 0.94);

  const pages = {
    'https://umoya.co.za/csi': 'Naledi Mokoena, Head of Corporate Social Investment. Contact csi@umoya.co.za',
    'https://umoya.co.za/leadership': 'Executive team: Naledi Mokoena – Head of CSI; Pieter van der Merwe – Chief Operating Officer',
    'https://news.example.org/story': 'Thabo Nkosi, Transformation Manager at Umoya, said the bursary fund would double.'
  };
  const fetched = [];
  const wf = de.createWaterfall({
    fetchText: async url => { fetched.push(url); if (pages[url]) return pages[url]; throw new Error('HTTP 404'); },
    search: async q => /integrated report|CSI report/.test(q) ? [{ title: 'Umoya Integrated Report 2025', url: 'https://umoya.co.za/csi', snippet: 'CSI spend R12m' }] : [{ title: 'Umoya names transformation lead', url: 'https://news.example.org/story', snippet: 'Thabo Nkosi, Transformation Manager at Umoya' }]
  });
  const org = { id: 'L1', company: 'Umoya Holdings', website: 'https://umoya.co.za', email: '' };
  const pools = { leads: [{ id: 'L2', company: 'Umoya Foundation', email: 'zanele@umoya.co.za', contactName: 'Zanele Khumalo', title: 'Foundation Manager' }], candidates: [], partners: [] };
  const result = await wf.run(org, pools);
  assert.deepEqual(result.hops.map(h => `${h.id}:${h.status}`), ['site:done', 'reports:done', 'leadership:done', 'graph:done']);
  const naledi = result.contacts.find(c => c.name === 'Naledi Mokoena');
  assert.ok(naledi.hops.includes('site') && naledi.hops.includes('reports'), 'seen on two hops');
  assert.equal(naledi.confidence, 0.94); assert.equal(naledi.level, 'high');
  assert.equal(naledi.title, 'Head of Corporate Social Investment', 'longest title kept');
  const zanele = result.contacts.find(c => c.name === 'Zanele Khumalo');
  assert.equal(zanele.hops[0], 'graph'); assert.equal(zanele.confidence, 0.9);
  const thabo = result.contacts.find(c => c.name === 'Thabo Nkosi');
  assert.equal(thabo.confidence, 0.55, 'third-party page scores lower than official pages');
  assert.ok(!result.contacts.some(c => c.name === 'Pieter van der Merwe'), 'COO is not a CSI role');
  assert.ok(!JSON.stringify(result).includes('csi@umoya.co.za'), 'no email harvested');
  assert.equal(result.contacts[0].name, 'Naledi Mokoena');
  assert.equal(result.status, 'pending-review');

  const none = await de.createWaterfall({}).run({ company: 'Nowhere Inc', email: '' }, pools);
  assert.deepEqual(none.hops.map(h => h.status), ['skipped', 'skipped', 'skipped', 'empty']);
  assert.equal(none.status, 'empty');
});

test('data API: duplicate blocked at ingest with override, fuzzy → merge review → merge; waterfall graph hop + accept; stale re-verify; data summary', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chelo-data-'));
  const port = 6400 + Math.floor(Math.random() * 500);
  const child = await startServer({ PORT: String(port), DATA_DIR: dir, NODE_ENV: 'test', SETTINGS_ENCRYPTION_KEY: 'data-key', SMTP_PROBE_DISABLED: 'true' });
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

  const first = await api('POST', '/api/leads', { company: 'Umoya Holdings', contactName: 'Sipho Dlamini', title: 'Head of CSI', email: 'sipho@github.com', sector: 'Mining', sourceName: 'Website', sourceUrl: 'https://github.com' });
  assert.equal(first.status, 201);
  assert.ok(first.payload.id);

  // Exact duplicate (same corporate domain + similar name) is blocked, with the matches returned
  const blocked = await api('POST', '/api/leads', { company: 'Umoya Holdings (Pty) Ltd', contactName: 'Naledi Mokoena', email: 'naledi@github.com', sourceName: 'Website', sourceUrl: 'https://github.com' });
  assert.equal(blocked.status, 409); assert.equal(blocked.payload.code, 'duplicate'); assert.equal(blocked.payload.duplicates[0].id, first.payload.id);
  // Staff can override; the override is still queued for review
  const forced = await api('POST', '/api/leads', { company: 'Umoya Holdings (Pty) Ltd', contactName: 'Naledi Mokoena', email: 'naledi@github.com', sourceName: 'Website', sourceUrl: 'https://github.com', allowDuplicate: true });
  assert.equal(forced.status, 201);
  let data = (await api('GET', '/api/data')).payload;
  assert.equal(data.openMergeReviews, 1); assert.equal(data.mergeReviews[0].recordId, forced.payload.id); assert.equal(data.mergeReviews[0].matchId, first.payload.id);
  assert.equal(data.reverifyAfterDays, 90);

  // Fuzzy (typo) name with a different domain → created + review
  const fuzzy = await api('POST', '/api/leads', { company: 'Umoja Holdings', contactName: 'Lerato M', email: 'lerato@gitlab.com', sourceName: 'Website', sourceUrl: 'https://gitlab.com' });
  assert.equal(fuzzy.status, 201);
  data = (await api('GET', '/api/data')).payload;
  assert.ok(data.openMergeReviews >= 2);
  const typoReview = data.mergeReviews.find(r => r.recordId === fuzzy.payload.id);
  assert.ok(typoReview); assert.match(typoReview.reasons.join(' '), /similar/);
  // keep separate
  const kept = await api('POST', `/api/data/merge-reviews/${typoReview.id}`, { action: 'keep' });
  assert.equal(kept.status, 200); assert.equal(kept.payload.review.status, 'resolved');

  // merge the override into the first record: primary keeps its contact, gains nothing destructive, duplicate removed
  const overrideReview = data.mergeReviews.find(r => r.recordId === forced.payload.id);
  const merged = await api('POST', `/api/data/merge-reviews/${overrideReview.id}`, { action: 'merge', primaryId: first.payload.id });
  assert.equal(merged.status, 200, JSON.stringify(merged.payload));
  assert.equal(merged.payload.review.resolution.removedId, forced.payload.id);
  let init = (await api('GET', '/api/init')).payload;
  assert.ok(!init.leads.find(l => l.id === forced.payload.id), 'duplicate removed');
  const primary = init.leads.find(l => l.id === first.payload.id);
  assert.equal(primary.contactName, 'Sipho Dlamini'); assert.equal(primary.mergedFrom[0].id, forced.payload.id);
  assert.ok(primary.dataQuality && primary.dataQuality.grade, 'every lead carries a data-quality grade');
  assert.equal((await api('POST', `/api/data/merge-reviews/${overrideReview.id}`, { action: 'merge' })).status, 400, 'cannot resolve twice');

  // Discovery add with the same name and no disambiguating domain is blocked too
  assert.equal((await api('POST', '/api/discovery/add', { name: 'Umoya Holdings' })).status, 409);

  // Waterfall: no search key and a sandbox without outbound web → site/reports/leadership skipped or empty, graph hop finds the known contact on the sibling record
  const sibling = await api('POST', '/api/leads', { company: 'Umoya Foundation Trust', contactName: 'Zanele Khumalo', title: 'Foundation Manager', email: 'zanele@github.com', sourceName: 'Website', sourceUrl: 'https://github.com', allowDuplicate: true });
  assert.equal(sibling.status, 201);
  const wf = await api('POST', `/api/leads/${sibling.payload.id}/waterfall`, {});
  assert.equal(wf.status, 200, JSON.stringify(wf.payload));
  const hops = Object.fromEntries(wf.payload.contactLeads.hops.map(h => [h.id, h.status]));
  assert.equal(hops.reports, 'skipped'); assert.equal(hops.leadership, 'skipped'); assert.equal(hops.graph, 'done');
  const graphHit = wf.payload.contactLeads.contacts.find(c => c.name === 'Sipho Dlamini');
  assert.ok(graphHit, 'contact on the sibling github.com record surfaces via the partner graph'); assert.equal(graphHit.hops[0], 'graph');
  // capture as candidate (record already has a contact) then reject one
  const asCandidate = await api('POST', `/api/leads/${sibling.payload.id}/contact-leads`, { id: graphHit.id, action: 'candidate' });
  assert.equal(asCandidate.status, 200); assert.ok(asCandidate.payload.outcome.candidateId);
  init = (await api('GET', '/api/init')).payload;
  const cand = init.candidates.find(c => c.id === asCandidate.payload.outcome.candidateId);
  assert.equal(cand.contactName, 'Sipho Dlamini'); assert.equal(cand.email, ''); assert.equal(cand.source, 'waterfall');
  const conflict = await api('POST', `/api/leads/${sibling.payload.id}/contact-leads`, { id: graphHit.id, action: 'accept' });
  assert.equal(conflict.status, 400, 'accept refuses to silently overwrite an existing contact');
  assert.equal((await api('POST', `/api/leads/${sibling.payload.id}/contact-leads`, { id: graphHit.id, action: 'accept', replace: true })).status, 200);

  // Re-verify: freshly created leads are not due; a stale one is picked up by the sweep
  const summaryBefore = (await api('GET', '/api/data')).payload;
  assert.equal(summaryBefore.reverifyDue, 0);
  const stale = await api('PATCH', `/api/leads/${first.payload.id}`, { notes: 'stale marker' });
  assert.equal(stale.status, 200);
  // age the verification by rewriting the stored check (simulating 120 days)
  const { DatabaseSync } = require('node:sqlite');
  child.kill('SIGTERM'); await new Promise(r => child.on('exit', r));
  const conn = new DatabaseSync(path.join(dir, 'chelo.sqlite'));
  const row = conn.prepare('SELECT data_json FROM leads WHERE id = ?').get(first.payload.id);
  const rec = JSON.parse(row.data_json); rec.mailboxCheck = { ...(rec.mailboxCheck || {}), status: 'deliverable', checkedAt: new Date(Date.now() - 120 * 86400e3).toISOString() };
  conn.prepare('UPDATE leads SET data_json = ? WHERE id = ?').run(JSON.stringify(rec), first.payload.id); conn.close();
  const child2 = await startServer({ PORT: String(port), DATA_DIR: dir, NODE_ENV: 'test', SETTINGS_ENCRYPTION_KEY: 'data-key', SMTP_PROBE_DISABLED: 'true', CRON_SECRET: 'cron-s' });
  t.after(() => { child2.kill('SIGTERM'); });
  jar.cookie = ''; jar.csrf = '';
  assert.equal((await api('POST', '/api/auth/login', { username: 'admin@cheloapp.com', password: 'correct-horse-battery' })).status, 200);
  const due = (await api('GET', '/api/data')).payload;
  assert.equal(due.reverifyDue, 1); const att = due.attention.find(a => a.id === first.payload.id); assert.ok(att && att.reverifyDue); assert.match(att.reasons.join(' '), /verified 120d ago/);
  const cron = await fetch(`${base}/api/cron/data-tick`, { headers: { Authorization: 'Bearer cron-s' } }).then(r => r.json());
  assert.equal(cron.checked, 1); assert.equal(cron.results[0].leadId, first.payload.id); assert.ok(!cron.results[0].error, JSON.stringify(cron.results[0]));
  assert.equal((await api('GET', '/api/data')).payload.reverifyDue, 0);
  assert.equal((await fetch(`${base}/api/cron/data-tick`)).status, 401);
});
