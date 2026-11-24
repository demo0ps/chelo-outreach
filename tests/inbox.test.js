// Communication Center inbox: conversations open on human replies, members scope visibility, owner-first/round-robin assignment,
// statuses, notes with @mentions, replies honour the approval policy.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

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
  return async (method, url, body, extraHeaders = {}) => {
    const headers = { 'Content-Type': 'application/json', Origin: base, ...extraHeaders };
    if (jar.cookie) headers.Cookie = jar.cookie;
    if (jar.csrf) headers['X-CSRF-Token'] = jar.csrf;
    const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) jar.cookie = setCookie.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    const payload = ct.includes('application/json') ? await res.json() : await res.text();
    if (payload && payload.csrfToken) jar.csrf = payload.csrfToken;
    return { status: res.status, payload };
  };
}

test('inbox: replies become conversations, members scope visibility, assignment, statuses, notes, four-eyes replies', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chelo-inbox-'));
  const port = 7400 + Math.floor(Math.random() * 500);
  const child = await startServer({ PORT: String(port), DATA_DIR: dir, NODE_ENV: 'test', SETTINGS_ENCRYPTION_KEY: 'inbox-key', SMTP_PROBE_DISABLED: 'true' });
  t.after(() => { child.kill('SIGTERM'); });
  const base = `http://127.0.0.1:${port}`;
  const root = client(base); const thandi = client(base); const sipho = client(base); const anon = client(base);

  assert.equal((await root('POST', '/api/auth/setup', { username: 'founder@cheloapp.com', displayName: 'Founder', password: 'correct-horse-battery' })).status, 201);
  const u1 = (await root('POST', '/api/staff', { username: 'thandi@cheloapp.com', displayName: 'Thandi Nkosi', role: 'owner', desks: ['csi'], password: 'thandi-strong-password' })).payload;
  const u2 = (await root('POST', '/api/staff', { username: 'sipho@cheloapp.com', displayName: 'Sipho Dlamini', role: 'owner', desks: ['csi'], password: 'sipho-strong-password-1' })).payload;
  assert.equal((await thandi('POST', '/api/auth/login', { username: 'thandi@cheloapp.com', password: 'thandi-strong-password' })).status, 200);
  assert.equal((await sipho('POST', '/api/auth/login', { username: 'sipho@cheloapp.com', password: 'sipho-strong-password-1' })).status, 200);

  // Two mailboxes = two inboxes
  const mbA = (await root('POST', '/api/deliverability/mailboxes', { label: 'Partnerships', fromEmail: 'partnerships@github.com', fromName: 'Chelo', host: '127.0.0.1', port: 2525, username: 'u', password: 'secret', dailyCap: 30 })).payload;
  const mbB = (await root('POST', '/api/deliverability/mailboxes', { label: 'Emmaculate', fromEmail: 'emma@github.com', fromName: 'Emma', host: '127.0.0.1', port: 2525, username: 'u', password: 'secret', dailyCap: 30 })).payload;
  const idA = mbA.mailbox?.id || mbA.id; const idB = mbB.mailbox?.id || mbB.id;
  assert.ok(idA && idB, JSON.stringify([mbA, mbB]));

  // Membership: only root/full-access may set it; Thandi → A, Sipho → B
  assert.equal((await thandi('PUT', `/api/inbox/mailboxes/${idA}/members`, { userIds: [u1.id] })).status, 403);
  assert.equal((await root('PUT', `/api/inbox/mailboxes/${idA}/members`, { userIds: [u1.id] })).status, 200);
  assert.equal((await root('PUT', `/api/inbox/mailboxes/${idB}/members`, { userIds: [u2.id] })).status, 200);

  // A lead owned by Sipho, contacted from mailbox A (simulated via a sent message on the lead), replies
  const lead = (await root('POST', '/api/leads', { company: 'Metsi Energy Group', contactName: 'Lerato M', email: 'lerato@github.com', owner: 'Sipho Dlamini', projectId: 'proj-chelo-solar-gp', sector: 'Energy', province: 'Gauteng' })).payload;
  assert.ok(lead.id, JSON.stringify(lead));
  // Private workspaces: replies follow the funder. Root shares this funder with Thandi so inbox A's member can work it.
  assert.equal((await root('PUT', `/api/leads/${lead.id}/share`, { userIds: [u1.id] })).status, 200);
  const info = (await root('GET', '/api/inbound/webhook-info')).payload;
  const evt = JSON.stringify({ type: 'inbound', from: 'Lerato M <lerato@github.com>', to: 'partnerships@github.com', subject: 'Re: Solar classrooms', text: 'Thanks — this looks interesting. Could we talk next week? Lerato' });
  const sig = crypto.createHmac('sha256', info.secret).update(evt).digest('hex');
  const hook = await anon('POST', '/api/inbound/webhook', evt, { 'X-Chelo-Signature': sig });
  assert.equal(hook.status, 200, JSON.stringify(hook.payload));

  // Routed to inbox A (by To: address). Owner Sipho is NOT a member of A → round-robin among members → Thandi.
  const rootView = (await root('GET', '/api/inbox')).payload;
  assert.equal(rootView.conversations.length, 1);
  const conv = rootView.conversations[0];
  assert.equal(conv.mailboxId, idA);
  assert.equal(conv.assigneeId, u1.id, 'round-robin among inbox members when owner is not a member');
  assert.equal(conv.status, 'open'); assert.equal(conv.unread, true);
  assert.equal(rootView.mailboxes.length, 2); assert.equal(rootView.canManageMembers, true);

  // Visibility: Thandi (member of A) sees it; Sipho (member of B only) does not
  const thandiView = (await thandi('GET', '/api/inbox')).payload;
  assert.equal(thandiView.conversations.length, 1); assert.equal(thandiView.folders.mine, 1); assert.equal(thandiView.folders.mineUnread, 1);
  assert.equal(thandiView.mailboxes.length, 1, 'non-members do not even see the other inbox');
  assert.equal(thandiView.canManageMembers, false);
  const siphoView = (await sipho('GET', '/api/inbox')).payload;
  assert.equal(siphoView.conversations.length, 0);
  assert.equal((await sipho('GET', `/api/inbox/conversations/${conv.id}`)).status, 404);

  // Opening marks it read; thread contains the inbound message
  const opened = (await thandi('GET', `/api/inbox/conversations/${conv.id}`)).payload;
  assert.ok(opened.messages.some(m => m.kind === 'inbound' && /interesting/.test(m.text)));
  assert.equal(opened.lead.id, lead.id);
  assert.equal((await thandi('GET', '/api/inbox')).payload.folders.mineUnread, 0);

  // Private note with @mention → Sipho gets a mention AND can now see the conversation? No — mentions do not widen visibility; assignment does.
  const note = await thandi('POST', `/api/inbox/conversations/${conv.id}/note`, { text: 'Lead owner is @Sipho Dlamini — can you take this one?' });
  assert.equal(note.status, 201); assert.deepEqual(note.payload.message.mentions, [u2.id]);
  assert.equal((await thandi('POST', `/api/inbox/conversations/${conv.id}/assign`, { userId: u2.id })).status, 200);
  const siphoAfter = (await sipho('GET', '/api/inbox')).payload;
  assert.equal(siphoAfter.conversations.length, 1, 'assignment makes the thread visible to the assignee');
  assert.equal(siphoAfter.mentions.length, 1);
  assert.equal(siphoAfter.folders.mine, 1);

  // Statuses: snooze needs a future date; pending; resolve
  assert.equal((await sipho('POST', `/api/inbox/conversations/${conv.id}/status`, { status: 'snoozed', snoozedUntil: '2020-01-01' })).status, 400);
  assert.equal((await sipho('POST', `/api/inbox/conversations/${conv.id}/status`, { status: 'snoozed', snoozedUntil: new Date(Date.now() + 86400e3).toISOString() })).payload.conversation.status, 'snoozed');
  assert.equal((await sipho('POST', `/api/inbox/conversations/${conv.id}/status`, { status: 'pending' })).payload.conversation.status, 'pending');

  // Reply under single-approver policy → queued straight away (no SMTP in test → job queued, message status queued)
  const r1 = await sipho('POST', `/api/inbox/conversations/${conv.id}/reply`, { text: 'Hi Lerato, wonderful — Tuesday 10:00 or Thursday 14:00 work on our side.' });
  assert.equal(r1.status, 201, JSON.stringify(r1.payload));
  assert.ok(['queued', 'failed'].includes(r1.payload.message.status), r1.payload.message.status);
  assert.equal(r1.payload.message.firstApproverId, u2.id);

  // Four-eyes: reply waits for a different signer
  assert.equal((await root('PUT', '/api/settings', { approvalPolicy: 'four-eyes' })).status, 200);
  const r2 = await sipho('POST', `/api/inbox/conversations/${conv.id}/reply`, { text: 'Following up with the slot details.' });
  assert.equal(r2.payload.message.status, 'awaiting-countersign');
  assert.equal((await sipho('POST', `/api/inbox/conversations/${conv.id}/reply/${r2.payload.message.id}`, {})).status, 400, 'same person cannot countersign');
  const cs = await root('POST', `/api/inbox/conversations/${conv.id}/reply/${r2.payload.message.id}`, {});
  assert.equal(cs.status, 200, JSON.stringify(cs.payload)); assert.ok(['queued', 'failed'].includes(cs.payload.message.status));
  assert.equal(cs.payload.message.secondApprover, 'Founder');

  // A second inbound reply reopens the conversation in the same thread (not a new one)
  const evt2 = JSON.stringify({ type: 'inbound', from: 'lerato@github.com', to: 'partnerships@github.com', subject: 'Re: Solar classrooms', text: 'Tuesday works. Lerato' });
  await anon('POST', '/api/inbound/webhook', evt2, { 'X-Chelo-Signature': crypto.createHmac('sha256', info.secret).update(evt2).digest('hex') });
  const again = (await root('GET', '/api/inbox')).payload;
  assert.equal(again.conversations.length, 1); assert.equal(again.conversations[0].status, 'open'); assert.equal(again.conversations[0].unread, true);
  assert.equal((await root('GET', `/api/inbox/conversations/${conv.id}`)).payload.messages.filter(m => m.kind === 'inbound').length, 2);

  // Resolve
  assert.equal((await root('POST', `/api/inbox/conversations/${conv.id}/status`, { status: 'resolved' })).payload.conversation.status, 'resolved');
  assert.equal((await root('GET', '/api/inbox')).payload.folders.all, 0);
});

test('inbox UI: desktop three-pane renders folders, list, thread, lead panel and members modal in a vm sandbox', () => {
  const vm = require('node:vm');
  const read = f => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
  const html = { app: '', modal: '' };
  const el = (id = '') => ({ id, innerHTML: '', value: '', style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], focus() {}, setSelectionRange() {} });
  const appEl = el('app'); const modalEl = el('modal-root');
  Object.defineProperty(appEl, 'innerHTML', { set(v) { html.app = v; }, get() { return html.app; } });
  Object.defineProperty(modalEl, 'innerHTML', { set(v) { html.modal = v; }, get() { return html.modal; } });
  const doc = { addEventListener() {}, querySelector: sel => sel === '#app' ? appEl : sel === '#modal-root' ? modalEl : sel === '#toast-root' ? el('toast') : null, querySelectorAll: () => [], getElementById: id => id === 'app' ? appEl : id === 'modal-root' ? modalEl : el(id), body: el('body'), documentElement: el('html'), createElement: () => el(), visibilityState: 'visible' };
  const location = { pathname: '/', search: '', origin: 'http://x', href: 'http://x/' };
  const win = { location, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), scrollTo() {}, navigator: { platform: 'Linux' }, setTimeout, clearTimeout, prompt: () => '', confirm: () => true, Intl };
  const ctx = { document: doc, window: win, location, navigator: win.navigator, matchMedia: win.matchMedia, setTimeout, clearTimeout, setInterval: () => 0, console, fetch: () => new Promise(() => {}), URL, URLSearchParams, Intl, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} }, requestAnimationFrame: fn => fn(), CSS: { escape: s => s } };
  ctx.globalThis = ctx; ctx.self = ctx; vm.createContext(ctx);
  vm.runInContext(read('app.js'), ctx); vm.runInContext(read('inbox.js'), ctx);
  vm.runInContext('globalThis.__t = { state, renderApp };', ctx);
  const t = ctx.__t; const now = new Date().toISOString();
  t.state.auth = { authenticated: true, username: 'root@chelo', displayName: 'Root', role: 'admin', isRoot: true, approvalPolicy: 'single', csrfToken: 'x' };
  t.state.data = { ...t.state.data, leads: [{ id: 'l1', company: 'Metsi Energy Group', contactName: 'Lerato M', email: 'l@x.co', stage: 'Interested', sector: 'Energy', province: 'Gauteng', owner: 'Sipho', createdAt: now, updatedAt: now, flow: { status: 'done', steps: {} }, triage: { category: 'interested', confidence: 'high', handled: false, dueAt: now } }], candidates: [], partners: [], bookings: [], activities: [], messages: [], emailEvents: [], projects: [], staff: [], mailboxes: [], settings: {} };
  t.state.view = 'inbox';
  t.state.ix.data = { me: 'u1', staff: [{ id: 'u1', displayName: 'Root' }, { id: 'u2', displayName: 'Thandi Nkosi' }], approvalPolicy: 'single', canManageMembers: true,
    mailboxes: [{ id: 'mb1', label: 'Partnerships', fromEmail: 'partnerships@cheloapp.com', open: 1, unread: 1, members: ['u2'] }], unrouted: { open: 0, unread: 0 },
    folders: { mine: 0, mineUnread: 0, unassigned: 0, all: 1 }, statuses: { open: 1, pending: 0, snoozed: 0, resolved: 0 }, mentions: [{ id: 'n1', conversationId: 'c1', author: 'Thandi Nkosi', text: '@Root can you take this?', createdAt: now }],
    conversations: [{ id: 'c1', leadId: 'l1', mailboxId: 'mb1', company: 'Metsi Energy Group', contactName: 'Lerato M', contactEmail: 'l@x.co', subject: 'Re: Solar', status: 'open', assigneeId: 'u2', unread: true, lastActivityAt: now, createdAt: now, triageCategory: 'interested', preview: { kind: 'inbound', text: 'Could we talk next week?' }, pendingCountersign: false }] };
  t.state.ix.folder = 'all';
  t.renderApp();
  assert.match(html.app, /class="ix-shell"/); assert.match(html.app, /data-folder="box:mb1"/); assert.match(html.app, /class="ix-badge">1</);
  assert.match(html.app, /Metsi Energy Group/); assert.match(html.app, /Could we talk next week\?/); assert.match(html.app, /Select a conversation/);
  assert.match(html.app, /data-action="ix-members-open"/, 'root sees the members manager');
  assert.match(html.app, /Communication Center/, 'sidebar brand renamed');
  assert.match(html.app, /data-view="inbox"/, 'Inbox in the sidebar');
  // open a thread (inject thread payload, as fetch is inert)
  t.state.ix.convId = 'c1';
  t.state.ix.thread = { conversation: t.state.ix.data.conversations[0], lead: t.state.data.leads[0], messages: [
    { id: 'm0', kind: 'sent', author: 'Chelo', subject: 'Solar classrooms', text: 'Picture the first day of term…', createdAt: now, sequenceStep: 1 },
    { id: 'm1', kind: 'inbound', author: 'Lerato M', text: 'Could we talk next week?', createdAt: now },
    { id: 'm2', kind: 'note', author: 'Thandi Nkosi', text: '@Root can you take this?', mentions: ['u1'], mentionedMe: true, createdAt: now },
    { id: 'm3', kind: 'outbound', author: 'Root', text: 'Yes — Tuesday?', status: 'awaiting-countersign', firstApproverId: 'u1', createdAt: now },
    { id: 'm4', kind: 'event', author: 'Root', text: 'Marked pending', createdAt: now }] };
  t.renderApp();
  assert.match(html.app, /class="ix-msg is-inbound/); assert.match(html.app, /class="ix-msg is-note is-mentioned/); assert.match(html.app, /waiting for a second approval/);
  assert.match(html.app, /A different teammate must approve this/, 'author cannot countersign own reply');
  assert.match(html.app, /What kind of reply is this/); assert.match(html.app, /data-action="ix-triage" data-category="interested"/);
  assert.match(html.app, /id="ix-assignee"/); assert.match(html.app, /data-action="ix-status" data-status="resolved"/);
  assert.match(html.app, /id="ix-reply"/, 'reply composer');
  t.state.ix.members = { mb1: ['u2'] }; t.renderApp();
  assert.match(html.app, /Inbox members/); assert.match(html.app, /data-member-box="mb1" value="u2" checked/);
});
