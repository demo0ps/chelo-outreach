// v65: per-desk PDFs (press backgrounder, school brief, scope of works) and the media mailbox profile for Discover.
const test = require('node:test');
const assert = require('node:assert/strict');
const dp = require('../lib/desk-pdf');
const { makeProposalPdf } = require('../lib/pdf-engine');
const mf = require('../lib/mailbox-finder');

const textOps = buf => (buf.toString('latin1').match(/\((.*?)\) Tj/g) || []).map(x => x.slice(1, -4).replace(/\\\(/g, '(').replace(/\\\)/g, ')'));
const project = { id: 'p1', name: 'Sanitation — Sizanani Primary School', recipientName: 'Sizanani Primary School', province: 'Gauteng', summary: 'Two of five toilet blocks unusable; 812 learners share the rest.', targetAmount: 450000, tender: { trade: 'sanitation', province: 'Gauteng', closesAt: '2026-11-06T12:00:00.000Z', brief: 'Replace two toilet blocks: 12 pedestals, plumbing, tiling, doors, basins.', feePct: 5, sentTo: [{ id: 's1' }], status: 'open', openedAt: '2026-10-26T08:00:00.000Z' } };
const kit = { boilerplate: 'Chelo verifies school needs and gets them funded and built.', facts: ['25 500 public schools on the list.', 'Funders pay suppliers directly.'], spokesperson: 'Nandi M.', spokespersonTitle: 'Founder', pressEmail: 'press@cheloapp.com', assetsUrl: 'https://cheloapp.com/press' };

test('funder proposal is unchanged when no layout is given', () => {
  const t = textOps(makeProposalPdf({ company: 'Acme Mining', contactName: 'CSI team', project: 'School solar', amount: 250000 }, {}));
  assert.ok(t.includes('PARTNERSHIP PROPOSAL')); assert.ok(t.includes('PROPOSED CONTRIBUTION')); assert.ok(t.includes('R 250 000')); assert.ok(t.includes('WHY CHELO'));
  assert.equal(dp.layoutFor('funder', {}, {}, {}), null); assert.equal(dp.filenameFor('funder', { company: 'Acme' }), 'Chelo-Partnership-Proposal.pdf');
});

test('media → press backgrounder from the media kit; no funder language', () => {
  const lead = { kind: 'media', company: 'Daily Maverick', contactName: 'Education desk', projectId: 'p1' };
  const ctx = { kind: 'media', project, kit, tender: null };
  const layout = dp.layoutFor('media', lead, {}, ctx);
  assert.equal(layout.kicker, 'PRESS BACKGROUNDER'); assert.match(layout.boxRight[0], /Nandi M\./);
  const t = textOps(makeProposalPdf(lead, { layout })).join('\n');
  assert.match(t, /PRESS BACKGROUNDER/); assert.match(t, /THE STORY/); assert.match(t, /WHY NOW/); assert.match(t, /FACTS YOU CAN USE/); assert.match(t, /INTERVIEW, VISIT, PICTURES/);
  assert.match(t, /25 500 public schools/); assert.match(t, /press@cheloapp.com/);
  assert.doesNotMatch(t, /PROPOSED CONTRIBUTION|WHY CHELO|PARTNERSHIP PROPOSAL/);
  assert.equal(dp.filenameFor('media', lead), 'Chelo-Press-Backgrounder-Daily-Maverick.pdf');
  // staff edits win over defaults
  const edited = textOps(makeProposalPdf(lead, { layout: dp.layoutFor('media', lead, { opening: 'Our own first paragraph.' }, ctx) })).join('\n');
  assert.match(edited, /Our own first paragraph/); assert.doesNotMatch(edited, /Chelo verifies school needs and gets them/);
});

test('school → plain-language brief: the need, next steps, what the school does, no money through the school', () => {
  const lead = { kind: 'school', company: 'Sizanani Primary School', province: 'Gauteng', school: { district: 'Gauteng East' }, needs: [{ text: 'Two toilet blocks unusable', estimate: 450000 }] };
  const layout = dp.layoutFor('school', lead, {}, { kind: 'school', project: null, kit: null, tender: null });
  assert.equal(layout.boxLabel, 'THE NEED'); assert.equal(layout.boxValue, 'Two toilet blocks unusable'); assert.match(layout.boxRight[1], /R.450.000/);
  const t = textOps(makeProposalPdf(lead, { layout })).join('\n');
  assert.match(t, /PROJECT BRIEF FOR THE SCHOOL/); assert.match(t, /The Principal and the School Governing Body/); assert.match(t, /WHAT THE SCHOOL DOES/); assert.match(t, /no money passes through the school/i);
  assert.doesNotMatch(t, /funder|contribution|partnership proposal/i);
});

test('supplier → scope of works from the open quote request; generic sheet when there is none', () => {
  const lead = { id: 's1', kind: 'supplier', company: 'Thabo Plumbing', contactName: 'Thabo Nkosi', supplier: { trades: ['sanitation'], provinces: ['Gauteng'], vetting: { status: 'approved', at: '2026-10-20' } } };
  const withTender = dp.layoutFor('supplier', lead, {}, { kind: 'supplier', project, kit: null, tender: project.tender });
  assert.equal(withTender.boxLabel, 'QUOTE BY'); assert.match(withTender.boxValue, /6 November 2026/); assert.match(withTender.title, /Toilets & plumbing/);
  const t = textOps(makeProposalPdf(lead, { layout: withTender })).join('\n');
  assert.match(t, /SCOPE OF WORKS/); assert.match(t, /12 pedestals/); assert.match(t, /including VAT/); assert.match(t, /fee of 5%/); assert.match(t, /pays the supplier directly/);
  const generic = dp.layoutFor('supplier', lead, {}, { kind: 'supplier', project: null, kit: null, tender: null });
  assert.equal(generic.boxLabel, 'STATUS'); assert.equal(generic.boxValue, 'Approved supplier'); assert.equal(generic.title, 'How quoting with Chelo works');
  assert.equal(dp.fieldLabels('supplier').impact, 'Scope of works'); assert.equal(dp.fieldLabels('nope').doc, 'Partnership proposal');
});

test('mailbox finder: media profile keeps newsroom addresses that the funder profile rejects, and vice versa', () => {
  const html = 'Contact: news@dailynews.co.za · csi@dailynews.co.za · ads@dailynews.co.za · jane.doe@dailynews.co.za · info@dailynews.co.za';
  const domains = new Set(['dailynews.co.za']);
  const funder = mf.extractMailboxes(html, { domains }).map(x => x.email);
  const mediaHits = mf.extractMailboxes(html, { domains, profile: mf.PROFILES.media }).map(x => x.email);
  assert.deepEqual(funder.slice(0, 2), ['csi@dailynews.co.za', 'info@dailynews.co.za'], 'funder profile: news@ is the wrong team'); assert.ok(!funder.includes('news@dailynews.co.za'));
  assert.deepEqual(mediaHits, ['news@dailynews.co.za', 'info@dailynews.co.za'], 'media profile: newsroom first, CSI dropped, ads dropped, never a person');
  assert.deepEqual(mf.patternCandidates('x.co.za', mf.PROFILES.media).map(c => c.local), ['news', 'newsdesk', 'editor', 'info']);
  assert.deepEqual(mf.patternCandidates('x.co.za').map(c => c.local), ['csi', 'foundation', 'info']);
  assert.equal(mf.profileOf('media').pages.includes('/newsroom'), true);
});

test('server: a supplier lead gets a scope-of-works PDF, not the funder proposal', async t => {
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const { spawn } = require('node:child_process');
  const ROOT = path.join(__dirname, '..');
  const child = await new Promise((resolve, reject) => {
    const c = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: ROOT, env: { ...process.env, PORT: '9560', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'chelo-pdf-')), NODE_ENV: 'test', SETTINGS_ENCRYPTION_KEY: 'k', SMTP_PROBE_DISABLED: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; const timer = setTimeout(() => reject(new Error(out)), 15000);
    c.stdout.on('data', d => { out += d; if (/running at/.test(out)) { clearTimeout(timer); resolve(c); } }); c.stderr.on('data', d => { out += d; });
  });
  t.after(() => child.kill('SIGTERM'));
  const base = 'http://127.0.0.1:9560'; const jar = {};
  const call = async (method, url, body, desk = 'suppliers') => { const h = { 'Content-Type': 'application/json', Origin: base, 'X-Chelo-Desk': desk }; if (jar.cookie) h.Cookie = jar.cookie; if (jar.csrf) h['X-CSRF-Token'] = jar.csrf; const r = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }); const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; const ct = r.headers.get('content-type') || ''; const p = ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()); if (p && p.csrfToken) jar.csrf = p.csrfToken; return { status: r.status, payload: p, headers: r.headers }; };
  assert.equal((await call('POST', '/api/auth/setup', { username: 'founder@cheloapp.com', displayName: 'Founder', password: 'correct-horse-battery' })).status, 201);
  assert.equal((await fetch(`${base}/api/public/suppliers/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company: 'Thabo Plumbing', contactName: 'Thabo', email: 'thabo@github.com', phone: '0825551234', trades: ['sanitation'], provinces: ['Gauteng'], town: 'Soweto', consent: true }) })).status, 201);
  const lead = (await call('GET', '/api/init')).payload.leads.find(l => l.company === 'Thabo Plumbing');
  const draft = (await call('POST', `/api/leads/${lead.id}/proposal/draft`, {})).payload;
  assert.equal(draft.mode, 'desk-template'); assert.match(draft.draft.rationale, /including VAT/);
  const made = await call('POST', `/api/leads/${lead.id}/proposal`, { opening: 'Site: a Gauteng primary school.' });
  assert.equal(made.status, 201, JSON.stringify(made.payload).slice(0, 200));
  const pdf = await call('GET', `/api/leads/${lead.id}/proposal/download`);
  assert.equal(pdf.status, 200); assert.match(pdf.headers.get('content-disposition') || '', /Chelo-Scope-of-Works-Thabo-Plumbing\.pdf/);
  const text = textOps(pdf.payload).join('\n');
  assert.match(text, /SCOPE OF WORKS/); assert.match(text, /Site: a Gauteng primary school/); assert.doesNotMatch(text, /PROPOSED CONTRIBUTION/);
});
