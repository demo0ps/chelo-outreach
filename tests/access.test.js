// Private workspaces (v56): staff see their own funders plus what is shared with them; admins and root see everything.
// Sharing works per funder and per Verified Project; owner changes are admin-only; duplicates never leak another person's notes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const access = require('../lib/access');

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
function client(base) {
  const jar = { cookie: '', csrf: '' };
  return async (method, url, body) => {
    const headers = { 'Content-Type': 'application/json', Origin: base };
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

test('access rules: owner, shared, project team, admin/root/reviewer see all', () => {
  const projects = [{ id: 'p1', team: ['u3'] }];
  const lead = { id: 'l1', ownerId: 'u1', sharedWith: ['u2'], projectId: 'p1' };
  const teams = access.projectTeams(projects);
  assert.equal(access.accessReason({ userId: 'u1', role: 'owner' }, lead, teams), 'owner');
  assert.equal(access.accessReason({ userId: 'u2', role: 'owner' }, lead, teams), 'shared');
  assert.equal(access.accessReason({ userId: 'u3', role: 'member' }, lead, teams), 'project');
  assert.equal(access.accessReason({ userId: 'u4', role: 'owner' }, lead, teams), '');
  assert.equal(access.accessReason({ userId: 'u4', role: 'admin' }, lead, teams), 'all');
  assert.equal(access.accessReason({ userId: 'u4', role: 'reviewer' }, lead, teams), 'all');
  assert.equal(access.accessReason({ userId: 'u4', role: 'owner', isRoot: true }, lead, teams), 'all');
  assert.equal(access.canManageLead({ userId: 'u2', role: 'owner' }, lead), false);
  assert.equal(access.canManageLead({ userId: 'u1', role: 'owner' }, lead), true);
  const legacy = [{ id: 'a' }, { id: 'b', ownerId: 'u9', sharedWith: [] }];
  assert.equal(access.assignMissingOwners(legacy, 'root-1'), 2);
  assert.equal(legacy[0].ownerId, 'root-1'); assert.deepEqual(legacy[0].sharedWith, []); assert.equal(legacy[1].ownerId, 'u9');
  assert.deepEqual(access.cleanUserIds(['u1', 'u1', 'ghost'], [{ id: 'u1' }, { id: 'ghost', active: false }]), ['u1']);
});

test('private workspaces end-to-end: own + shared + project team; admins see all; dedup message does not leak', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chelo-access-'));
  const port = 7900 + Math.floor(Math.random() * 500);
  const child = await startServer({ PORT: String(port), DATA_DIR: dir, NODE_ENV: 'test', SETTINGS_ENCRYPTION_KEY: 'access-key', SMTP_PROBE_DISABLED: 'true' });
  t.after(() => { child.kill('SIGTERM'); });
  const base = `http://127.0.0.1:${port}`;
  const root = client(base); const thandi = client(base); const sipho = client(base);
  assert.equal((await root('POST', '/api/auth/setup', { username: 'founder@cheloapp.com', displayName: 'Founder', password: 'correct-horse-battery' })).status, 201);
  const u1 = (await root('POST', '/api/staff', { username: 'thandi@cheloapp.com', displayName: 'Thandi Nkosi', role: 'owner', desks: ['csi'], password: 'thandi-strong-password' })).payload;
  const u2 = (await root('POST', '/api/staff', { username: 'sipho@cheloapp.com', displayName: 'Sipho Dlamini', role: 'owner', desks: ['csi'], password: 'sipho-strong-password-1' })).payload;
  assert.equal((await thandi('POST', '/api/auth/login', { username: 'thandi@cheloapp.com', password: 'thandi-strong-password' })).status, 200);
  assert.equal((await sipho('POST', '/api/auth/login', { username: 'sipho@cheloapp.com', password: 'sipho-strong-password-1' })).status, 200);

  // Seed/demo funders that pre-date private workspaces belong to root → staff do not see them, root does.
  const rootInit = (await root('GET', '/api/init')).payload;
  assert.equal(rootInit.canSeeAll, true);
  assert.ok(rootInit.leads.length > 0 && rootInit.leads.every(l => l.access.ownerId), 'every pre-existing funder has an owner');
  assert.equal((await thandi('GET', '/api/init')).payload.leads.length, 0, 'staff start with an empty, private workspace');

  // Thandi adds a funder → only she (and admins) see it.
  const mine = (await thandi('POST', '/api/leads', { company: 'Metsi Energy Group', contactName: 'Lerato M', email: 'lerato@github.com', projectId: 'proj-chelo-solar-gp', sector: 'Energy', province: 'Gauteng' })).payload;
  assert.ok(mine.id, JSON.stringify(mine)); assert.equal(mine.projectId, 'proj-chelo-solar-gp', JSON.stringify(mine));
  const tInit = (await thandi('GET', '/api/init')).payload;
  assert.equal(tInit.leads.length, 1); assert.equal(tInit.leads[0].access.reason, 'owner'); assert.equal(tInit.leads[0].access.canManage, true);
  assert.equal((await sipho('GET', '/api/init')).payload.leads.length, 0);
  assert.equal((await sipho('GET', `/api/leads/${mine.id}/access`)).status, 404, 'no peeking by id');
  assert.equal((await sipho('GET', '/api/workbench')).payload.leads.length, 0);
  assert.equal((await sipho('GET', '/api/leads')).payload.length, 0);
  assert.equal((await root('GET', '/api/leads')).payload.some(l => l.id === mine.id), true, 'root sees it');

  // Duplicate protection stays global, but the message does not leak the other person's record.
  const dup = await sipho('POST', '/api/leads', { company: 'Metsi Energy Group', contactName: 'Other', email: 'lerato@github.com' });
  assert.equal(dup.status, 409); assert.match(dup.payload.error, /Already in Chelo/); assert.ok(!dup.payload.duplicates, 'no duplicate details for a funder you cannot see');

  // Share with Sipho → he can work it; only owner/admin may share.
  assert.equal((await sipho('PUT', `/api/leads/${mine.id}/share`, { userIds: [u2.id] })).status, 404);
  const shared = await thandi('PUT', `/api/leads/${mine.id}/share`, { userIds: [u2.id] });
  assert.equal(shared.status, 200); assert.equal(shared.payload.access.sharedWith[0].displayName, 'Sipho Dlamini');
  const sInit = (await sipho('GET', '/api/init')).payload;
  assert.equal(sInit.leads.length, 1); assert.equal(sInit.leads[0].access.reason, 'shared'); assert.equal(sInit.leads[0].access.canManage, false);
  assert.equal((await sipho('PUT', `/api/leads/${mine.id}/share`, { userIds: [] })).status, 403, 'a guest cannot unshare');
  assert.equal((await thandi('PUT', `/api/leads/${mine.id}/share`, { userIds: [] })).status, 200);
  assert.equal((await sipho('GET', `/api/leads/${mine.id}/access`)).status, 404);

  // Project team: admin puts Sipho on the solar project → he sees every funder linked to it, now and later.
  assert.equal((await thandi('PUT', '/api/projects/proj-chelo-solar-gp/team', { userIds: [u2.id] })).status, 403);
  const teamRes = await root('PUT', '/api/projects/proj-chelo-solar-gp/team', { userIds: [u2.id] });
  assert.equal(teamRes.status, 200); assert.deepEqual(teamRes.payload.project.team, [String(u2.id)], JSON.stringify({ u2, team: teamRes.payload.project.team }));
  assert.equal((await sipho('GET', `/api/leads/${mine.id}/access`)).status, 200);
  const later = (await thandi('POST', '/api/leads', { company: 'Vuka Mining Trust', contactName: 'N', email: 'vuka@github.com', projectId: 'proj-chelo-solar-gp' })).payload;
  assert.equal((await sipho('GET', `/api/leads/${later.id}/access`)).status, 200, 'future funders on the project are visible too');
  assert.equal((await sipho('GET', '/api/init')).payload.leads.find(l => l.id === later.id).access.reason, 'project');

  // Owner change: admin only, single and bulk; audit trail.
  assert.equal((await thandi('PUT', `/api/leads/${mine.id}/owner`, { userId: u2.id })).status, 403);
  assert.equal((await root('PUT', `/api/leads/${mine.id}/owner`, { userId: u2.id })).payload.access.ownerName, 'Sipho Dlamini');
  assert.equal((await root('PUT', '/api/leads/owner', { userId: u1.id, leadIds: [mine.id, later.id] })).payload.changed, 2);
  const audit = (await root('GET', '/api/audit')).payload;
  const entries = Array.isArray(audit) ? audit : audit.entries || audit.items || [];
  assert.ok(entries.some(e => e.action === 'lead.shared'), 'share audited');
  assert.ok(entries.some(e => e.action === 'lead.owner_changed'), 'owner change audited');
  assert.ok(entries.some(e => e.action === 'project.team'), 'project team audited');
});
