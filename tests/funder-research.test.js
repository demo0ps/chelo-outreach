const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const createFunderResearch = require('../lib/funder-research');

const FUNDER_HTML = `<!doctype html><html><head><title>Umoya Holdings | Corporate Social Investment</title></head><body>
<nav>Home About Careers Contact</nav>
<h1>Our commitment to communities</h1>
<p>Umoya Holdings is committed to education and skills development in under-resourced communities across South Africa. Our mission is to invest in learners, teachers and schools so that every young person can thrive.</p>
<p>In 2024 the Umoya Foundation supported 42 schools and 11,500 learners through literacy, numeracy and STEM programmes, with a focus on measurable outcomes and transparent reporting.</p>
<p>We also run an employee volunteering programme and partner with community organisations on water and sanitation infrastructure in rural villages.</p>
<p>For enquiries contact csi@umoya.example or call 011 555 0199. ID 8001015009087 was quoted in error.</p>
<p>Thandi Mokoena, Head of Corporate Social Investment, leads the foundation team.</p>
<footer>© Umoya Holdings. All rights reserved. Privacy policy</footer>
</body></html>`;

const PRESS_HTML = `<html><head><title>Umoya Foundation annual report highlights</title></head><body><p>The Umoya Foundation invests in early childhood development and youth employability, supporting 300 ECD practitioners in Limpopo and Gauteng during 2024.</p><p>Applications for the foundation's grant window open in March each year and close at the end of May.</p></body></html>`;

function fakeFetch(calls) {
  return async (url, init = {}) => {
    const href = typeof url === 'string' ? url : url.href;
    calls.push({ href, init });
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    const html = body => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (href.startsWith('https://api.tavily.com/search')) {
      const body = JSON.parse(init.body);
      assert.equal(body.api_key, 'tv-secret');
      return json(200, { results: [
        { title: 'Umoya CSI', url: 'https://www.umoya-holdings.co.za/csi', content: 'Umoya Holdings is committed to education and skills development.' },
        { title: 'Umoya annual report', url: 'https://news.example.org/umoya-foundation-report', content: 'The Umoya Foundation invests in early childhood development.' },
        { title: 'Umoya on LinkedIn', url: 'https://www.linkedin.com/in/thandi-mokoena', content: 'profile' },
        { title: 'Integrated report PDF', url: 'https://www.umoya-holdings.co.za/ir-2024.pdf', content: 'pdf' }
      ] });
    }
    if (href.startsWith('https://www.umoya-holdings.co.za/csi')) return html(FUNDER_HTML);
    if (href.startsWith('https://www.umoya-holdings.co.za')) return new Response('Not found', { status: 404 });
    if (href.startsWith('https://news.example.org/')) return html(PRESS_HTML);
    if (href === 'https://ai.example/v1/chat/completions') {
      const body = JSON.parse(init.body);
      const user = JSON.parse(body.messages[1].content);
      const joined = JSON.stringify(user);
      assert.ok(!joined.includes('csi@umoya.example'), 'email must be scrubbed before AI');
      assert.ok(!joined.includes('011 555 0199'), 'phone must be scrubbed before AI');
      assert.ok(!joined.includes('8001015009087'), 'SA ID must be scrubbed before AI');
      return json(200, { choices: [{ message: { content: JSON.stringify({
        missionSummary: 'Umoya Holdings invests in education and skills in under-resourced South African communities.',
        focusAreas: ['Education', 'Skills development', 'Water and sanitation'],
        findings: [
          { kind: 'public_figure', text: 'In 2024 the Umoya Foundation supported 42 schools and 11,500 learners through literacy, numeracy and STEM programmes.', ref: 'S1', confidence: 'high' },
          { kind: 'grant_window', text: 'Grant applications open in March and close at the end of May each year.', ref: 'S2', confidence: 'medium' },
          { kind: 'mission', text: 'Invented claim with no source', ref: 'S9', confidence: 'high' }
        ],
        contacts: [{ name: 'Thandi Mokoena', title: 'Head of Corporate Social Investment', ref: 'S1' }],
        alignmentPoints: [{ text: "Umoya's stated focus on measurable outcomes and transparent reporting matches Chelo's traceable funding and milestone reporting for verified schools.", ref: 'S1' }],
        suggestedProjectId: 'proj-chelo-literacy-wc'
      }) } }] });
    }
    throw new Error(`unexpected fetch ${href}`);
  };
}

const publicResolver = { lookup: async () => [{ address: '41.0.0.10', family: 4 }] };
const projects = [{ id: 'proj-chelo-literacy-wc', name: 'Foundation-phase literacy', sector: 'Education', province: 'Western Cape' }, { id: 'proj-chelo-wash-ec', name: 'School WASH', sector: 'Water & sanitation', province: 'Eastern Cape' }];

test('funder research: search + official site, PII scrubbing, cited findings, AI refs validated', async () => {
  const calls = [];
  const researcher = createFunderResearch({ fetch: fakeFetch(calls), resolver: publicResolver });
  const brief = await researcher.researchFunder(
    { company: 'Umoya Holdings', website: 'umoya-holdings.co.za', sector: 'Mining' },
    { searchConfig: { provider: 'tavily', apiKey: 'tv-secret' }, aiConfig: { apiKey: 'ai-key', model: 'test-model', endpoint: 'https://ai.example/v1/chat/completions' }, projects }
  );
  assert.equal(brief.status, 'pending-review');
  assert.equal(brief.mode, 'openai');
  assert.equal(brief.provider, 'tavily');
  assert.equal(brief.website, 'https://umoya-holdings.co.za');
  assert.ok(brief.sources.some(s => s.url.includes('/csi') && s.official), 'official CSI page read');
  assert.ok(!calls.some(c => c.href.includes('linkedin.com')), 'social profiles are never fetched');
  assert.ok(brief.attempted.some(a => a.url.endsWith('.pdf') && /Paste-to-Extract/.test(a.reason)), 'PDF handed off to Paste-to-Extract');
  assert.equal(brief.redactions.emails, 1);
  assert.equal(brief.redactions.phones, 1);
  assert.equal(brief.redactions.saIds, 1);
  assert.equal(brief.findings.length, 2, 'finding with unknown source ref is dropped');
  assert.ok(brief.findings.every(f => f.sourceUrl && f.id));
  assert.equal(brief.contacts[0].name, 'Thandi Mokoena');
  assert.ok(!('email' in brief.contacts[0]) && !('phone' in brief.contacts[0]));
  assert.equal(brief.alignmentPoints.length, 1);
  assert.equal(brief.suggestedProjectId, 'proj-chelo-literacy-wc');
  assert.equal(researcher.approvedContext(brief), null, 'nothing is usable before review');

  brief.status = 'approved';
  brief.approvedFindingIds = [brief.findings[0].id];
  brief.approvedAlignmentIds = [brief.alignmentPoints[0].id];
  const ctx = researcher.approvedContext(brief);
  assert.equal(ctx.citedFunderFacts.length, 1);
  assert.equal(ctx.alignmentWithChelo.length, 1);
  assert.equal(ctx.stale, false);
  assert.equal(researcher.isStale({ expiresAt: '2000-01-01T00:00:00.000Z' }), true);
});

test('funder research: local extraction without AI or search provider (official website only)', async () => {
  const calls = [];
  const researcher = createFunderResearch({ fetch: fakeFetch(calls), resolver: publicResolver });
  const brief = await researcher.researchFunder(
    { company: 'Umoya Holdings', website: 'https://www.umoya-holdings.co.za' },
    { searchConfig: { provider: 'none', apiKey: '' }, aiConfig: { apiKey: '' }, projects }
  );
  assert.equal(brief.mode, 'local');
  assert.equal(brief.provider, 'official-site');
  assert.ok(brief.findings.length >= 2);
  assert.ok(brief.findings.some(f => /42 schools/.test(f.text)));
  assert.ok(brief.findings.every(f => !/umoya\.example|555 0199|8001015009087/.test(f.text)), 'local findings never contain scrubbed PII');
  assert.ok(brief.focusAreas.includes('Education & schools'));
  assert.ok(brief.alignmentPoints.length >= 1 && brief.alignmentPoints[0].sourceUrl);
  assert.equal(brief.contacts[0]?.name, 'Thandi Mokoena');
  assert.ok(!calls.some(c => c.href.includes('api.tavily.com')));
  await assert.rejects(researcher.researchFunder({ company: 'Nobody Corp', website: '' }, { searchConfig: { provider: 'none', apiKey: '' } }), /Configure a web-search provider/);
});

test('funder research: SSRF guard blocks private hosts and credentials', async () => {
  const researcher = createFunderResearch({ fetch: async () => { throw new Error('must not fetch'); }, resolver: { lookup: async host => host === 'intranet.example' ? [{ address: '10.1.2.3', family: 4 }] : [{ address: '41.0.0.10', family: 4 }] } });
  await assert.rejects(researcher.fetchPublicText('http://127.0.0.1:3000/'), /Private IP/);
  await assert.rejects(researcher.fetchPublicText('http://localhost/admin'), /Private hosts/);
  await assert.rejects(researcher.fetchPublicText('http://169.254.169.254/latest/meta-data'), /Private IP/);
  await assert.rejects(researcher.fetchPublicText('https://intranet.example/'), /private networks/);
  await assert.rejects(researcher.fetchPublicText('https://user:pw@public.example/'), /credentials/);
  await assert.rejects(researcher.fetchPublicText('ftp://public.example/'), /http\(s\)/);
});

test('pdf: approved alignment section is rendered with numbered public sources', () => {
  const { makeProposalPdf } = require('../lib/pdf-engine');
  const buffer = makeProposalPdf({ company: 'Umoya Holdings', project: 'Literacy', amount: 250000 }, {
    opening: 'Opening', impact: 'Impact', rationale: 'Rationale', nextStep: 'Next',
    alignment: { missionSummary: 'Umoya invests in education.', points: [{ text: 'Shared focus on measurable outcomes.', sourceUrl: 'https://www.umoya-holdings.co.za/csi' }], facts: [{ text: 'Supported 42 schools in 2024.', sourceUrl: 'https://news.example.org/report' }], researchedAt: '2026-10-25T08:00:00.000Z' }
  });
  const text = buffer.toString('latin1');
  assert.match(text, /ALIGNMENT WITH YOUR MISSION/);
  assert.match(text, /umoya-holdings\.co\.za/);
  assert.match(text, /\[2\] news\.example\.org/);
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

test('end-to-end: research → review → approved brief shapes email draft and proposal PDF, with audit trail', async t => {
  // Local fixture standing in for the search provider and the funder's website (loopback is only allowed in tests).
  const fixture = http.createServer((req, res) => {
    if (req.url.startsWith('/search')) {
      let body = ''; req.on('data', c => { body += c; }); req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ results: [{ title: 'Umoya CSI', url: `http://127.0.0.1:${fixturePort}/csi`, content: 'Umoya Holdings is committed to education.' }] }));
      });
      return;
    }
    if (req.url === '/csi') { res.setHeader('content-type', 'text/html'); return res.end(FUNDER_HTML); }
    res.statusCode = 404; res.end('nope');
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const fixturePort = fixture.address().port;
  t.after(() => fixture.close());

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chelo-research-'));
  const port = 4400 + Math.floor(Math.random() * 500);
  const child = await startServer({ PORT: String(port), DATA_DIR: dir, NODE_ENV: 'test', SETTINGS_ENCRYPTION_KEY: 'e2e-key', RESEARCH_ALLOW_LOOPBACK: 'true', SEARCH_PROVIDER: 'tavily', SEARCH_API_KEY: 'tv-secret', SEARCH_ENDPOINT: `http://127.0.0.1:${fixturePort}/search` });
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
    const ct = res.headers.get('content-type') || '';
    const payload = ct.includes('application/json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    if (payload && payload.csrfToken) jar.csrf = payload.csrfToken;
    return { status: res.status, payload };
  };

  assert.equal((await api('POST', '/api/auth/setup', { username: 'admin@cheloapp.com', displayName: 'Nandi', password: 'correct-horse-battery' })).status, 201);
  const settings = await api('GET', '/api/settings');
  assert.equal(settings.payload.searchConfigured, true);
  assert.equal(settings.payload.searchProvider, 'tavily');

  const created = await api('POST', '/api/leads', { company: 'Umoya Holdings', contactName: 'Sipho Dlamini', email: 'sipho@github.com', sector: 'Mining', project: 'Foundation-phase literacy', amount: 250000, sourceName: 'CSI page', sourceUrl: `http://127.0.0.1:${fixturePort}/csi` });
  assert.equal(created.status, 201, JSON.stringify(created.payload));
  const leadId = created.payload.lead?.id || created.payload.id;

  const ran = await api('POST', `/api/leads/${leadId}/research`, {});
  assert.equal(ran.status, 201, JSON.stringify(ran.payload));
  const brief = ran.payload.brief;
  assert.equal(brief.status, 'pending-review');
  assert.ok(brief.findings.length >= 1);
  assert.equal(brief.redactions.emails, 1);
  assert.ok(brief.contacts.some(c => c.name === 'Thandi Mokoena'));

  // Pending brief must not leak into drafts.
  const emailBefore = await api('POST', `/api/leads/${leadId}/outreach/generate`, { project: 'Foundation-phase literacy', amount: 250000 });
  assert.equal(emailBefore.status, 201, JSON.stringify(emailBefore.payload));
  const alignmentText = brief.alignmentPoints[0]?.text || '';
  assert.ok(alignmentText && !emailBefore.payload.emailDraft.body.includes(alignmentText));

  const reviewed = await api('POST', `/api/leads/${leadId}/research/review`, { approvedFindingIds: [brief.findings[0].id], approvedAlignmentIds: brief.alignmentPoints.slice(0, 1).map(a => a.id), approvedContactIds: brief.contacts.slice(0, 1).map(c => c.id), reviewNotes: 'Checked against CSI page.' });
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.payload));
  assert.equal(reviewed.payload.brief.status, 'approved');
  assert.match(reviewed.payload.brief.reviewedBy, /^Nandi/);

  const emailAfter = await api('POST', `/api/leads/${leadId}/outreach/generate`, { project: 'Foundation-phase literacy', amount: 250000 });
  assert.equal(emailAfter.status, 201);
  assert.ok(emailAfter.payload.emailDraft.body.includes(alignmentText.replace(/\.$/, '')), 'approved alignment point shapes the guided email');

  const pdf = await api('POST', `/api/leads/${leadId}/proposal`, { opening: 'Opening', impact: 'Impact', rationale: 'Rationale', nextStep: 'Next', amount: 250000, project: 'Foundation-phase literacy' });
  assert.equal(pdf.status, 201, JSON.stringify(pdf.payload));
  const download = await api('GET', `/api/leads/${leadId}/proposal/download`);
  assert.equal(download.status, 200);
  assert.match(download.payload.toString('latin1'), /ALIGNMENT WITH YOUR MISSION/);

  const audit = await api('GET', '/api/audit');
  const actions = audit.payload.entries.map(l => l.action);
  assert.ok(actions.includes('research.gathered') && actions.includes('research.approved'));

  const removed = await api('DELETE', `/api/leads/${leadId}/research`);
  assert.equal(removed.status, 200);
  assert.equal((await api('GET', `/api/leads/${leadId}/research`)).payload.brief, null);
});
