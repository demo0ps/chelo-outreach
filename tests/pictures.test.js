// v68: photo library — theme from the project, rotation per funder, staff pin, hosted page + PDF cover use it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createLibrary, THEME_IDS } = require('../lib/pictures');
const { jpegSize } = require('../lib/pdf-engine');

const ROOT = path.join(__dirname, '..');
const lib = createLibrary(path.join(ROOT, 'public', 'brand', 'photos'));

test('library: every theme file has a cover, themes come from need category or words, rotation differs per funder, pin wins', () => {
  const counts = lib.scan();
  for (const id of THEME_IDS) for (const n of counts[id]) { const c = lib.coverBuffer({ cover: `/brand/photos/${id}-${n}-cover.jpg` }); assert.ok(c && jpegSize(c), `${id}-${n}-cover.jpg is a baseline JPEG the PDF engine can embed`); }
  assert.ok(counts.sanitation.length >= 3 && counts.water.length >= 3 && counts.electricity.length >= 3, JSON.stringify(counts));
  assert.equal(lib.themeFor({ needCategory: 'sanitation', name: 'Project — X' }), 'sanitation');
  assert.equal(lib.themeFor({ name: 'Water tank for the classroom block' }), 'water', 'specific beats general');
  assert.equal(lib.themeFor({ name: 'Solar power for Motse', summary: 'screens' }), 'electricity');
  assert.equal(lib.themeFor({ name: 'Library corner', summary: 'reading books' }), 'library');
  assert.equal(lib.themeFor({ name: 'Something else' }), 'other');
  const project = { id: 'p1', name: 'Sanitation — Sizanani', needCategory: 'sanitation' };
  const picks = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(id => lib.pick(project, { lead: { id } }).image));
  assert.ok(picks.size >= 2, 'different funders get different photos of the same theme');
  const same = lib.pick(project, { lead: { id: 'a' } }); assert.deepEqual(lib.pick(project, { lead: { id: 'a' } }), same, 'stable for the same funder');
  assert.match(same.image, /^\/brand\/photos\/sanitation-\d+\.jpg$/); assert.equal(same.legacy, 'construction');
  const pinned = lib.pick({ ...project, photo: { theme: 'water', n: lib.variants('water')[0] } }, { lead: { id: 'zzz' } });
  assert.equal(pinned.pinned, true); assert.equal(pinned.theme, 'water');
  const gal = lib.gallery(); assert.equal(gal.length, THEME_IDS.length); assert.ok(gal.find(t => t.id === 'sanitation').photos.length >= 3);
  const empty = createLibrary('/nonexistent-dir').pick({ name: 'Toilets' }, {}); assert.match(empty.image, /^\/brand\/templates\/construction\.jpg$/, 'legacy fallback when no photos exist');
});

test('server: pin a photo, the hosted page and the proposal cover follow it', async t => {
  const child = await new Promise((resolve, reject) => {
    const c = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: ROOT, env: { ...process.env, PORT: '9530', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'chelo-photos-')), NODE_ENV: 'test', SETTINGS_ENCRYPTION_KEY: 'k', SMTP_PROBE_DISABLED: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; const timer = setTimeout(() => reject(new Error(out)), 15000);
    c.stdout.on('data', d => { out += d; if (/running at/.test(out)) { clearTimeout(timer); resolve(c); } }); c.stderr.on('data', d => { out += d; });
  });
  t.after(() => child.kill('SIGTERM'));
  const base = 'http://127.0.0.1:9530'; const jar = {};
  const call = async (method, url, body) => { const h = { 'Content-Type': 'application/json', Origin: base }; if (jar.cookie) h.Cookie = jar.cookie; if (jar.csrf) h['X-CSRF-Token'] = jar.csrf; const r = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }); const sc = r.headers.get('set-cookie'); if (sc) jar.cookie = sc.split(';')[0]; const ct = r.headers.get('content-type') || ''; const p = ct.includes('json') ? await r.json() : await r.text(); if (p && p.csrfToken) jar.csrf = p.csrfToken; return { status: r.status, payload: p }; };
  assert.equal((await call('POST', '/api/auth/setup', { username: 'founder@cheloapp.com', displayName: 'Founder', password: 'correct-horse-battery' })).status, 201);
  const gal = (await call('GET', '/api/photos')).payload.themes; assert.ok(gal.find(x => x.id === 'water').photos.length >= 3);
  const project = (await call('POST', '/api/projects', { name: 'Water — Test Primary', recipientName: 'Test Primary', province: 'Limpopo', sector: 'Education', targetAmount: 90000, summary: 'Two water tanks and a borehole pump.' })).payload;
  assert.equal(project.photoPick.theme, 'water'); assert.equal(project.photoPick.pinned, false);
  assert.equal((await call('PUT', `/api/projects/${project.id}/photo`, { theme: 'water', n: 999 })).status, 400);
  const n = gal.find(x => x.id === 'water').photos[1].n;
  const pinned = (await call('PUT', `/api/projects/${project.id}/photo`, { theme: 'water', n })).payload;
  assert.equal(pinned.photoPick.pinned, true); assert.equal(pinned.photoPick.image, `/brand/photos/water-${n}.jpg`);
  const lead = (await call('POST', '/api/leads', { company: 'Acme Mining', contactName: 'CSI team', email: 'csi@github.com', sourceName: 'Site', sourceUrl: 'https://github.com/about', projectId: project.id })).payload;
  const page = await call('GET', `/api/public/page/${lead.bookingToken}`);
  assert.equal(page.status, 200, JSON.stringify(page.payload).slice(0, 200)); assert.equal(page.payload.image, `/brand/photos/water-${n}.jpg`); assert.equal(page.payload.photoTheme, 'water');
  const made = await call('POST', `/api/leads/${lead.id}/proposal`, {}); assert.equal(made.status, 201, JSON.stringify(made.payload).slice(0, 200));
  const unpinned = (await call('PUT', `/api/projects/${project.id}/photo`, { theme: '' })).payload; assert.equal(unpinned.photoPick.pinned, false);
  const img = await fetch(`${base}/brand/photos/water-${n}.jpg`); assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/jpeg');
});
