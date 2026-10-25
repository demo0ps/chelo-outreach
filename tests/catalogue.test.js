const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const catalogue = require('../lib/discovered-leads');

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

test('catalogue: 200+ organisation-level SA CSI funders, no PII, every row mapped to a verified project with FYE + focus', () => {
  const rows = catalogue.discoveredLeads();
  assert.ok(rows.length >= 200, `expected 200+ rows, got ${rows.length}`);
  const keys = new Set(rows.map(r => r.catalogKey)); assert.equal(keys.size, rows.length, 'catalogue keys unique');
  const projectIds = new Set(Object.values(catalogue.PROJECTS).map(p => p.id));
  for (const r of rows) {
    assert.ok(r.company && /^https:\/\/www\.[a-z0-9.-]+\.[a-z.]+\/$/.test(r.website), `${r.company}: website`);
    assert.ok(projectIds.has(r.projectId) && r.project && r.amount > 0, `${r.company}: project link`);
    assert.ok(r.partnerPriorities && r.notes && r.sector && r.province, `${r.company}: focus/notes`);
    assert.ok(r.financialYearEnd === null || (r.financialYearEnd >= 1 && r.financialYearEnd <= 12));
    assert.equal(r.email, undefined, 'catalogue never carries emails'); assert.equal(r.contactName, undefined); assert.equal(r.phone, undefined);
  }
  const withFye = rows.filter(r => r.financialYearEnd).length; assert.ok(withFye / rows.length > 0.95, 'FYE captured for nearly all');
  const sixProjects = new Set(rows.map(r => r.projectId)); assert.equal(sixProjects.size, 6, 'all six verified projects get candidates');
});

test('catalogue import API: idempotent batches, org-level verification, duplicates vs existing leads skipped, fit + relationships work on imported rows', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chelo-cat-'));
  const port = 7600 + Math.floor(Math.random() * 400);
  const child = await startServer({ PORT: String(port), DATA_DIR: dir, NODE_ENV: 'test', SETTINGS_ENCRYPTION_KEY: 'cat-key', SMTP_PROBE_DISABLED: 'true' });
  t.after(() => { child.kill('SIGTERM'); });
  const base = `http://127.0.0.1:${port}`;
  const jar = { cookie: '', csrf: '' };
  const api = async (method, url, body) => {
    const headers = { 'Content-Type': 'application/json', Origin: base };
    if (jar.cookie) headers.Cookie = jar.cookie; if (jar.csrf) headers['X-CSRF-Token'] = jar.csrf;
    const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = res.headers.get('set-cookie'); if (setCookie) jar.cookie = setCookie.split(';')[0];
    const payload = (res.headers.get('content-type') || '').includes('application/json') ? await res.json() : null;
    if (payload && payload.csrfToken) jar.csrf = payload.csrfToken;
    return { status: res.status, payload };
  };
  assert.equal((await api('POST', '/api/auth/setup', { username: 'admin@cheloapp.com', displayName: 'Nandi', password: 'correct-horse-battery' })).status, 201);
  // An existing hand-entered lead on a catalogue domain must not be duplicated
  assert.equal((await api('POST', '/api/leads', { company: 'Standard Bank Group', contactName: 'Existing Contact', website: 'https://www.standardbank.co.za/', sourceName: 'Website' })).status, 201);

  const status0 = (await api('GET', '/api/leads/catalogue')).payload;
  assert.ok(status0.total >= 200); assert.equal(status0.imported, 0);

  const first = (await api('POST', '/api/leads/catalogue/import', { limit: 50, verify: false })).payload;
  assert.equal(first.created + first.skippedExisting, 50); assert.ok(first.skippedExisting >= 1, 'Standard Bank skipped as already present');
  const second = (await api('POST', '/api/leads/catalogue/import', { limit: 50, verify: false })).payload;
  assert.equal(second.created + second.skippedExisting, 50); assert.ok(second.status.imported >= first.created + second.created, 'batches continue where the last stopped');
  const again = (await api('POST', '/api/leads/catalogue/import', { limit: 500, verify: false })).payload;
  const total = (await api('GET', '/api/leads/catalogue')).payload;
  assert.equal(total.remaining, 0); assert.ok(total.imported >= 199);
  assert.equal((await api('POST', '/api/leads/catalogue/import', { limit: 500, verify: false })).payload.created, 0, 'idempotent');

  const leads = (await api('GET', '/api/leads')).payload.filter(l => l.catalogKey);
  assert.ok(leads.length >= 199);
  const sample = leads.find(l => l.company === 'Vodacom Group');
  assert.ok(sample, 'Vodacom present'); assert.equal(sample.projectId, 'proj-chelo-solar-gp'); assert.equal(sample.financialYearEnd, 3);
  assert.equal(sample.email, ''); assert.equal(sample.contactCheck.status, 'needs-clarification');
  assert.ok(sample.fit && sample.fit.score > 0 && sample.fit.window.known, 'fit + approach window computed from catalogue FYE');
  assert.match(sample.notes, /confirm current CSI focus/);
  assert.equal(sample.discovered.source, 'catalogue');

  // Org-level verification (DNS may be unavailable in CI → retry, never a crash)
  const ver = (await api('POST', '/api/leads/catalogue/verify', { limit: 5 })).payload;
  assert.equal(ver.checked, 5); assert.equal(Object.values(ver.results).reduce((a, b) => a + b, 0), 5);
  for (const st of Object.keys(ver.results)) assert.ok(['verified', 'invalid', 'retry'].includes(st));

  // Relationship graph collapses foundation + parent (same domain) into one org node
  const sasol = leads.find(l => l.company === 'Sasol'); const view = (await api('GET', `/api/relationships/${sasol.id}`)).payload;
  assert.ok(view.graph.org.records.length >= 2, 'Sasol + Sasol Foundation + site programme share one org node');
  // Signals summary now has a real ranking
  const signals = (await api('GET', '/api/signals')).payload;
  assert.ok(signals.totals.withFye >= 190); assert.ok(signals.ranking.length >= 100);
  assert.equal(again.status.catalogue, 'sa-csi-2026');

  // Published-mailbox finder: bulk + single + staff selection (no internet in CI → unreachable/unconfirmed, never a crash)
  const mb = (await api('POST', '/api/leads/catalogue/mailboxes', { limit: 3 })).payload;
  assert.equal(mb.searched, 3); assert.equal(mb.status.mailboxes.searched, 3);
  const one = (await api('POST', `/api/leads/${sample.id}/find-mailbox`)).payload;
  assert.ok(['unreachable', 'unconfirmed', 'published', 'pattern-verified', 'none-published'].includes(one.mailboxSearch.status));
  assert.ok(one.mailboxSearch.candidates.every(c => !/^[a-z]+\.[a-z]+@/.test(c.email)), 'no personal addresses');
  if (one.mailboxSearch.candidates.length) {
    const pick = one.mailboxSearch.candidates[0].email;
    const used = (await api('POST', `/api/leads/${sample.id}/use-mailbox`, { email: pick })).payload;
    assert.equal(used.lead.email, pick); assert.equal(used.lead.contactKind, 'generic-mailbox'); assert.ok(used.lead.contactName);
    assert.equal((await api('POST', `/api/leads/${sample.id}/use-mailbox`, { email: 'nope@vodacom.co.za' })).status, 400);
  }
});
