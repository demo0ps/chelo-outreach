const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const signals = require('../lib/signals');

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

test('approach window: deterministic phases around financial year-end', () => {
  const now = new Date('2026-10-27T08:00:00Z');
  const phase = m => signals.approachWindow(m, now).phase;
  assert.equal(phase(1), 'budgeting', 'Jan FYE: budgets set Aug–Dec → late Oct is budgeting');
  assert.equal(phase(2), 'budgeting'); assert.equal(phase(3), 'budgeting', 'Mar FYE (most common in SA) is in budgeting in late Oct');
  assert.equal(phase(11), 'closing'); assert.equal(phase(12), 'closing');
  assert.equal(phase(9), 'allocation'); assert.equal(phase(10), 'allocation');
  assert.equal(phase(6), 'mid-year'); assert.equal(phase(5), 'mid-year');
  const dec = signals.approachWindow(12, now);
  assert.deepEqual(dec.budgeting, { from: '2026-07-01', to: '2026-11-01' }); assert.deepEqual(dec.allocation, { from: '2027-01-01', to: '2027-04-01' });
  assert.equal(dec.nextBudgetingOpens, '2027-07-01');
  const jun = signals.approachWindow(6, now);
  assert.equal(jun.nextBudgetingOpens, '2027-01-01'); assert.equal(jun.daysToNextBudgeting, 66);
  assert.equal(signals.approachWindow(3, now).daysToNextBudgeting, 0);
  assert.equal(signals.approachWindow(null, now).known, false); assert.equal(signals.approachWindow(13, now).phase, 'unknown');
  assert.ok(signals.approachWindow(3, now).score > signals.approachWindow(9, now).score && signals.approachWindow(9, now).score > signals.approachWindow(12, now).score && signals.approachWindow(12, now).score > signals.approachWindow(6, now).score);
});

test('FYE inference from public text', () => {
  assert.deepEqual(signals.inferFinancialYearEnd('Results for the year ended 30 June 2025 show CSI spend of R12m'), { month: 6, evidence: 'year ended 30 June' });
  assert.equal(signals.inferFinancialYearEnd('Financial year-end: February').month, 2);
  assert.equal(signals.inferFinancialYearEnd('FY ending 31 Mar 2026').month, 3);
  assert.equal(signals.inferFinancialYearEnd('Integrated report for the twelve months ended 31 December 2025').month, 12);
  assert.equal(signals.inferFinancialYearEnd('We fund schools in June every year'), null, 'a month alone is not an FYE');
});

test('fit score: sector × province × SED × window × warmth as a weighted geometric mean, with explainable drivers', () => {
  const now = new Date('2026-10-27T08:00:00Z');
  const project = { id: 'p1', name: 'Solar Classrooms', sector: 'Energy & Digital Education', province: 'Gauteng' };
  const base = { id: 'L1', company: 'Umoya Mining', sector: 'Mining', financialYearEnd: 3, research: { status: 'approved', focusAreas: ['Education & schools'], missionSummary: 'Operates in Gauteng and Limpopo' } };
  const strong = signals.fitScore({ ...base, relationshipContext: 'intro via board member' }, { project, now });
  assert.equal(strong.band, 'strong'); assert.ok(strong.score >= 90, String(strong.score));
  assert.equal(strong.components.window.score, 100); assert.equal(strong.window.phase, 'budgeting');
  const cold = signals.fitScore(base, { project, now });
  assert.ok(cold.score < strong.score); assert.equal(cold.weakest.key, 'warmth');
  const wrongProvince = signals.fitScore({ ...base, research: { ...base.research, missionSummary: 'Operates in the Northern Cape only' }, province: 'Northern Cape' }, { project, now });
  assert.ok(wrongProvince.score < cold.score); assert.equal(wrongProvince.weakest.key, 'province');
  const midYear = signals.fitScore({ ...base, financialYearEnd: 6 }, { project, now });
  assert.ok(midYear.score < cold.score); assert.equal(midYear.window.phase, 'mid-year');
  const noFye = signals.fitScore({ ...base, financialYearEnd: null }, { project, now });
  assert.equal(noFye.window.known, false); assert.match(noFye.components.window.reason, /FYE unknown/);
  const foundation = signals.fitScore({ ...base, company: 'Umoya Foundation' }, { project, now });
  assert.equal(foundation.components.sed.score, 80);
  const staffWindow = signals.fitScore({ ...base, grantWindowOpenMonth: 10, grantWindowCloseMonth: 11 }, { project, now });
  assert.equal(staffWindow.window.phase, 'grant-window'); assert.equal(staffWindow.components.window.score, 100, 'explicit grant window overrides FYE heuristics');
  const noProject = signals.fitScore(base, { now });
  assert.equal(noProject.components.sector.score, 50);
  // geometric mean: a near-zero factor collapses the score even when others are perfect
  assert.ok(signals.fitScore({ ...base, relationshipContext: 'x', research: { ...base.research, missionSummary: 'Western Cape only' }, province: 'Western Cape' }, { project, now }).score < strong.score - 10);
});

test('signals API: FYE set by staff or inferred from research drives the window; /api/signals ranks and groups; fit attached to every lead', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chelo-sig-'));
  const port = 6900 + Math.floor(Math.random() * 500);
  const child = await startServer({ PORT: String(port), DATA_DIR: dir, NODE_ENV: 'test', SETTINGS_ENCRYPTION_KEY: 'sig-key', SMTP_PROBE_DISABLED: 'true' });
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

  const a = await api('POST', '/api/leads', { company: 'Umoya Mining', contactName: 'Sipho Dlamini', email: 'sipho@github.com', sector: 'Mining', province: 'Gauteng', projectId: 'proj-chelo-solar-gp', financialYearEnd: 3, sourceName: 'Website', sourceUrl: 'https://github.com' });
  assert.equal(a.status, 201); assert.equal(a.payload.financialYearEnd, 3); assert.equal(a.payload.fyeSource, 'staff');
  const b = await api('POST', '/api/leads', { company: 'Thabo Capital', contactName: 'Thabo N', email: 'thabo@gitlab.com', sector: 'Finance', projectId: 'proj-chelo-literacy-wc', sourceName: 'Website', sourceUrl: 'https://gitlab.com' });
  assert.equal(b.status, 201);

  let init = (await api('GET', '/api/init')).payload;
  const la = init.leads.find(l => l.id === a.payload.id); const lb = init.leads.find(l => l.id === b.payload.id);
  assert.ok(la.fit && typeof la.fit.score === 'number' && la.fit.window.known, 'fit is attached to leads');
  assert.equal(lb.fit.window.known, false);
  assert.ok(la.fit.score > lb.fit.score, 'known in-window FYE + province match outranks an unknown');

  // staff change the FYE → window changes; invalid month clears it
  const nowMonth = new Date().getUTCMonth() + 1;
  const midYearMonth = ((nowMonth + 6) % 12) + 1; // FYE five months ago → always mid-year
  const patched = await api('PATCH', `/api/leads/${a.payload.id}`, { financialYearEnd: midYearMonth });
  assert.equal(patched.status, 200); assert.equal(patched.payload.financialYearEnd, midYearMonth);
  init = (await api('GET', '/api/init')).payload;
  assert.equal(init.leads.find(l => l.id === a.payload.id).fit.window.phase, 'mid-year');
  assert.equal((await api('PATCH', `/api/leads/${a.payload.id}`, { financialYearEnd: 'nope' })).payload.financialYearEnd, null);
  assert.equal((await api('PATCH', `/api/leads/${a.payload.id}`, { financialYearEnd: 3 })).payload.fyeSource, 'staff');

  const sig = (await api('GET', '/api/signals')).payload;
  assert.equal(sig.totals.withFye >= 1, true); assert.ok(sig.missingFye.find(r => r.id === b.payload.id));
  assert.equal(sig.ranking[0].fit >= sig.ranking[sig.ranking.length - 1].fit, true);
  assert.deepEqual(Object.keys(sig.weights), ['sector', 'province', 'sed', 'window', 'warmth']);
  const march = signals.approachWindow(3, new Date());
  if (['budgeting', 'allocation'].includes(march.phase)) assert.ok(sig.inWindow.find(r => r.id === a.payload.id));
});
