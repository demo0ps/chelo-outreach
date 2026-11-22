// Consolidation (pre-production): 17 sections → 10. Renders every surviving desktop view in a vm sandbox,
// checks the retired view names redirect to their merged home, and that the merged tabs render their old content.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function boot() {
  const read = f => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
  const html = { app: '', modal: '' };
  const el = (id = '') => ({ id, innerHTML: '', value: '', checked: false, style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], focus() {}, setAttribute() {}, getAttribute: () => null, appendChild() {}, removeChild() {}, remove() {}, closest: () => null, scrollIntoView() {}, getBoundingClientRect: () => ({ top: 0 }) });
  const appEl = el('app'); const modalEl = el('modal-root');
  Object.defineProperty(appEl, 'innerHTML', { set(v) { html.app = v; }, get() { return html.app; } });
  Object.defineProperty(modalEl, 'innerHTML', { set(v) { html.modal = v; }, get() { return html.modal; } });
  const doc = { addEventListener() {}, querySelector: sel => sel === '#app' ? appEl : sel === '#modal-root' ? modalEl : sel === '#toast-root' ? el('toast') : null, querySelectorAll: () => [], getElementById: id => id === 'app' ? appEl : id === 'modal-root' ? modalEl : el(id), createElement: () => el(), body: el('body'), documentElement: el('html'), activeElement: null, title: '' };
  const location = { pathname: '/', search: '', origin: 'http://x', href: 'http://x/' };
  const mql = { matches: false, addEventListener() {} };
  const win = { location, addEventListener() {}, matchMedia: () => mql, scrollTo() {}, navigator: { platform: 'Linux' }, setTimeout, clearTimeout, prompt: () => '', confirm: () => true, Intl };
  const ctx = { document: doc, window: win, location, navigator: win.navigator, matchMedia: win.matchMedia, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, console, fetch: () => new Promise(() => {}), URL, URLSearchParams, Intl, prompt: win.prompt, confirm: win.confirm, requestAnimationFrame: fn => fn(), localStorage: (() => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem(k, v) { m.set(k, String(v)); }, removeItem(k) { m.delete(k); } }; })() };
  ctx.globalThis = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('app.js'), ctx);
  vm.runInContext(read('inbox.js'), ctx);
  vm.runInContext(read('mobile.js'), ctx);
  vm.runInContext('globalThis.__t = { state, renderApp, setView, dispatchAction, approvalItems, VIEW_ALIASES, ls: localStorage };', ctx);
  return { t: ctx.__t, html };
}
const now = new Date().toISOString();
function fixtures(t) {
  const base = { flow: { status: 'done', steps: {} }, createdAt: now, updatedAt: now, stage: 'Contacted', sector: 'Mining', province: 'Gauteng', projectId: 'p1', project: 'Literacy', amount: 250000, fit: { score: 0.78, components: {}, reasons: [] } };
  const replied = { ...base, id: 'l-replied', company: 'Umoya Holdings', contactName: 'Sipho Dlamini', email: 's@x.co', emailStatus: 'Sent', triage: { category: 'wrong-person', confidence: 'high', handled: false, excerpt: 'Please speak to our CSI manager', dueAt: now } };
  const draft = { ...base, id: 'l-draft', company: 'Bolt South Africa', contactName: 'Naledi', email: 'n@x.co', emailStatus: 'Draft', emailDraft: { subject: 'Bolt + Literacy', body: 'Picture the first day of term.' } };
  const quiet = { ...base, id: 'l-quiet', company: 'Quiet Ltd', contactName: 'Q', email: 'q@x.co', emailStatus: 'Sent', stage: 'Won' };
  t.state.data = { ...t.state.data, leads: [replied, draft, quiet], candidates: [{ id: 'c1', company: 'Pool Co', status: 'New candidate', contactCheck: { status: 'unchecked', issues: [] }, createdAt: now, updatedAt: now }], partners: [{ id: 'pt1', company: 'Quiet Ltd', status: 'Active', amount: 1 }], bookings: [{ id: 'bk1', leadId: 'l-quiet', organization: 'Quiet Ltd', contactName: 'Q', status: 'Requested', date: '2026-11-03', time: '10:00', createdAt: now }], projects: [{ id: 'p1', name: 'Literacy', funding: { fundingGap: 1 } }], messages: [], emailEvents: [], activities: [], mailboxes: [], settings: {}, stages: ['New', 'Contacted', 'Won', 'Not proceeding'], staff: [] };
  t.state.auth = { authenticated: true, username: 'nandi@chelo', displayName: 'Nandi M', role: 'admin', isRoot: true, approvalPolicy: 'single', csrfToken: 'x' };
  t.state.ix.data = { me: 'u1', staff: [], mailboxes: [], unrouted: { open: 0, unread: 0 }, folders: { mine: 0, mineUnread: 0, unassigned: 0, all: 1 }, statuses: { open: 1 }, mentions: [], conversations: [{ id: 'cv1', leadId: 'l-replied', company: 'Umoya Holdings', subject: 'Re: Umoya', status: 'open', unread: false, lastActivityAt: now }] };
}

test('sidebar has the surviving sections and none of the retired ones', () => {
  const { t, html } = boot(); fixtures(t); t.renderApp();
  for (const v of ['inbox', 'workbench', 'overview', 'projects', 'prospects', 'briefings', 'sent', 'partners', 'ops', 'settings']) assert.match(html.app, new RegExp(`data-view="${v}"`), `nav has ${v}`);
  for (const v of ['discover', 'pipeline', 'analytics', 'deliverability', 'data', 'proposals']) assert.doesNotMatch(html.app, new RegExp(`class="nav-item[^"]*" data-view="${v}"`), `nav lacks ${v}`);
});

test('retired view names redirect to their merged home', () => {
  const { t } = boot(); fixtures(t);
  t.setView('discover'); assert.equal(t.state.view, 'workbench'); assert.equal(t.state.wb.intake, 'pool');
  t.setView('pipeline'); assert.equal(t.state.view, 'prospects'); assert.equal(t.state.prospectsMode, 'board');
  t.setView('proposals'); assert.equal(t.state.view, 'prospects');
  for (const [old, tab] of [['analytics', 'analytics'], ['deliverability', 'deliverability'], ['data', 'data']]) { t.setView(old); assert.equal(t.state.view, 'ops'); assert.equal(t.state.ops.tab, tab); }
});

test('every surviving desktop view renders without throwing', () => {
  const { t, html } = boot(); fixtures(t);
  for (const v of ['overview', 'workbench', 'inbox', 'projects', 'prospects', 'briefings', 'sent', 'partners', 'ops', 'settings']) {
    t.state.view = v; t.renderApp();
    assert.ok(html.app.length > 500, `${v} rendered`);
    assert.doesNotMatch(html.app, /class="eyebrow"/, `${v} has no eyebrow`);
  }
});

test('Prospects: table ⇄ board toggle replaces the Pipeline page', async () => {
  const { t, html } = boot(); fixtures(t);
  t.state.view = 'prospects'; t.renderApp();
  assert.match(html.app, /class="view-toggle"/); assert.match(html.app, /<table class="table">/);
  assert.doesNotMatch(html.app, /data-action="new-lead"/, 'no second intake door');
  await t.dispatchAction({ dataset: { action: 'prospects-mode', mode: 'board' } });
  assert.match(html.app, /id="kanban-board"/);
});

test('Workbench: local pool & CSV tab replaces Discover; replies point to the Inbox', async () => {
  const { t, html } = boot(); fixtures(t);
  t.state.view = 'workbench'; t.renderApp();
  assert.match(html.app, /data-action="wb-intake" data-intake="pool"/);
  await t.dispatchAction({ dataset: { action: 'wb-intake', intake: 'pool' } });
  assert.match(html.app, /Pool Co/); assert.match(html.app, /data-action="candidate-import"/);
  t.state.wb.selectedId = 'l-replied'; t.state.wb.filter = 'replied'; t.renderApp();
  assert.match(html.app, /Handle in Inbox/); assert.doesNotMatch(html.app, /id="triage-redirect-name"/, 'triage form lives in the Inbox only');
});

test('Ops: Health / Deliverability / Analytics / Data quality tabs', async () => {
  const { t, html } = boot(); fixtures(t);
  t.state.view = 'ops'; t.renderApp();
  assert.match(html.app, /data-action="ops-tab" data-tab="deliverability"/);
  for (const tab of ['deliverability', 'analytics', 'data', 'health']) { await t.dispatchAction({ dataset: { action: 'ops-tab', tab } }); assert.ok(html.app.length > 500, tab); }
  t.state.ops.tab = 'analytics'; t.renderApp(); assert.match(html.app, /id="analytics-range"/);
  // Non-root staff: Ops shows as "Analytics" with the engine tabs hidden; redirects from retired engine views land on Analytics.
  t.state.auth.isRoot = false; t.setView('deliverability');
  assert.equal(t.state.view, 'ops'); assert.equal(t.state.ops.tab, 'analytics');
  assert.doesNotMatch(html.app, /data-tab="health"|data-tab="deliverability"|data-tab="data"/);
  assert.match(html.app, /<h1>Results<\/h1>/);
});

test('Inbox: Approvals tab is the desktop twin of the phone tab and includes briefing requests', async () => {
  const { t, html } = boot(); fixtures(t);
  const items = t.approvalItems();
  assert.equal(items.map(i => i.kind).sort().join(','), 'booking,draft');
  t.state.view = 'inbox'; t.renderApp();
  assert.match(html.app, /data-action="ix-mode" data-mode="approvals"/);
  await t.dispatchAction({ dataset: { action: 'ix-mode', mode: 'approvals' } });
  assert.match(html.app, /Bolt South Africa/); assert.match(html.app, /Confirm a briefing time/);
  await t.dispatchAction({ dataset: { action: 'ix-goto-workbench', id: 'l-draft' } });
  assert.equal(t.state.view, 'workbench'); assert.equal(t.state.wb.selectedId, 'l-draft');
});

test('Preview before send: workbench and approvals open one screen with email + PDF + checks + the single next action', async () => {
  const { t, html } = boot(); fixtures(t);
  t.state.view = 'workbench'; t.state.wb.selectedId = 'l-draft'; t.renderApp();
  assert.match(html.app, /data-action="wb-send-all" data-id="l-draft"/, 'the one button opens the preview');
  assert.match(html.app, /Who they are/); assert.match(html.app, /What we.{1,6}ll send/); assert.doesNotMatch(html.app, /class="wb-step /, 'no stepper');
  // simulate the API answer and render the full-width review page
  t.state.view = 'review'; t.state.review = { id: 'l-draft', step: 0, loading: false, error: '', returnView: 'workbench', cache: {} }; t.state.review.cache[0] = { leadId: 'l-draft', step: 0, from: { name: 'Nandi', email: 'n@cheloapp.com' }, to: { name: 'Naledi', email: 'n@x.co' }, subject: 'Bolt + Literacy', text: 'Hi', html: '<!doctype html><html><body><p>Hi</p></body></html>', links: [{ url: 'https://x/track/cta/abc', kind: 'cta' }], attachments: [], proposal: null, steps: [], status: { email: 'Draft', sequence: null, approvalPolicy: 'single' }, checks: [{ id: 'to', ok: true, label: 'Recipient', detail: 'n@x.co' }, { id: 'cta', ok: true, label: 'Reply button present', detail: '' }], ready: true };
  t.renderApp();
  assert.match(html.app, /Read before sending/); assert.match(html.app, /class="sp-frame"/); assert.match(html.app, /srcdoc="/);
  assert.match(html.app, /No proposal PDF yet/); assert.match(html.app, /class="sp-checks"/);
  assert.match(html.app, /data-action="email-approve" data-id="l-draft"/, 'single primary action for a draft');
  assert.doesNotMatch(html.app, /data-action="send-smtp"/);
  t.state.review.cache[0].status.email = 'Approved'; t.renderApp();
  assert.match(html.app, /data-action="send-smtp"/); assert.doesNotMatch(html.app, /data-action="email-approve"/);
  t.state.review.cache[0].proposal = { url: '/api/leads/l-draft/proposal/preview', download: '/api/leads/l-draft/proposal/download' }; t.renderApp();
  assert.match(html.app, /class="sp-pdf-frame"[^>]*src="\/api\/leads\/l-draft\/proposal\/preview/);
});

test('every data-action button in the UI has a click handler (dead-button guard)', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const src = ['app.js', 'inbox.js', 'mobile.js'].map(f => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8')).join('\n');
  const used = new Set([...src.matchAll(/data-action=\\?"([a-z0-9-]+)"/g)].map(m => m[1]));
  const handled = new Set([...src.matchAll(/action\s*===\s*'([a-z0-9-]+)'/g)].map(m => m[1]));
  for (const m of src.matchAll(/\[((?:'[a-z0-9-]+',?\s*)+)\]\.includes\(action\)/g)) for (const a of m[1].matchAll(/'([a-z0-9-]+)'/g)) handled.add(a[1]);
  for (const m of src.matchAll(/closest\('\[data-action="([a-z0-9-]+)"\]'\)/g)) handled.add(m[1]);
  const dead = [...used].filter(a => !handled.has(a));
  assert.deepEqual(dead, [], `buttons with no handler: ${dead.join(', ')}`);
  // Prefix routing in dispatchAction must forward every family that wbAction serves.
  const dispatch = src.slice(src.indexOf('async function dispatchAction'), src.indexOf('async function dispatchAction') + 1500);
  assert.match(dispatch, /seq-/, 'seq-* actions (Send & follow up, Stop follow-ups) must reach wbAction');
});

test('v70: each desk shows only its own sections, its own add action, and cannot open another desk\'s views', () => {
  const { t, html } = boot(); fixtures(t);
  const catalogue = [
    { id: 'csi', label: 'CSI', targetLabel: 'Funders' }, { id: 'marketing', label: 'Marketing', targetLabel: 'Shows & outlets' },
    { id: 'schools', label: 'Schools', targetLabel: 'Schools & districts' }, { id: 'suppliers', label: 'Suppliers', targetLabel: 'Suppliers' }
  ];
  t.state.auth = { ...t.state.auth, desks: ['csi', 'marketing', 'schools', 'suppliers'], deskCatalogue: catalogue };
  const nav = () => [...html.app.matchAll(/class="nav-item[^"]*" data-view="([a-z-]+)"/g)].map(m => m[1]);
  const desk = id => t.ls.setItem('chelo-desk', id);
  // marketing
  desk('marketing'); t.setView('prospects'); t.renderApp();
  assert.ok(nav().includes('prospects') && !nav().includes('partners') && !nav().includes('briefings') && !nav().includes('overview'), `marketing nav: ${nav()}`);
  assert.match(html.app, /Media kit/); assert.match(html.app, /Add show or outlet/); assert.doesNotMatch(html.app, /Add a funder/);
  t.setView('partners'); assert.equal(t.state.view, 'workbench', 'marketing cannot open Partners');
  // schools
  desk('schools'); t.setView('briefings'); t.renderApp();
  assert.ok(!nav().includes('partners') && nav().includes('briefings'), `schools nav: ${nav()}`);
  assert.match(html.app, />Calls</); assert.doesNotMatch(html.app, /Add a funder/);
  t.setView('prospects'); t.renderApp(); assert.match(html.app, /Find a school/);
  // suppliers
  desk('suppliers'); t.setView('prospects'); t.renderApp();
  assert.ok(!nav().includes('inbox') && !nav().includes('briefings') && !nav().includes('partners') && nav().includes('projects'), `suppliers nav: ${nav()}`);
  assert.match(html.app, />Jobs</); assert.match(html.app, /Copy sign-up link/); assert.match(html.app, /<th>Vetting<\/th><th>Documents<\/th><th>Jobs<\/th>/);
  t.setView('overview'); assert.equal(t.state.view, 'workbench');
  // csi unchanged
  desk('csi'); t.setView('prospects'); t.renderApp();
  assert.ok(nav().includes('partners') && nav().includes('overview'), `csi nav: ${nav()}`); assert.match(html.app, /Add a funder/);
});
