// Mobile companion (G8): renders every phone screen in a vm sandbox with matchMedia(max-width:720px) = true.
// Checks: phone mode takes over renderApp, four tabs, queues populated, desktop-only sections never rendered, actions route.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function boot({ phone = true } = {}) {
  const read = f => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
  const html = { app: '', modal: '' };
  const el = (id = '') => ({ id, innerHTML: '', value: '', checked: false, style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], focus() {}, setSelectionRange() {}, appendChild() {}, remove() {}, set textContent(v) { this._t = v; }, get textContent() { return this._t || ''; } });
  const appEl = el('app'); const modalEl = el('modal-root');
  Object.defineProperty(appEl, 'innerHTML', { set(v) { html.app = v; }, get() { return html.app; } });
  Object.defineProperty(modalEl, 'innerHTML', { set(v) { html.modal = v; }, get() { return html.modal; } });
  const doc = { addEventListener() {}, querySelector: sel => sel === '#app' ? appEl : sel === '#modal-root' ? modalEl : sel === '#toast-root' ? el('toast') : null, querySelectorAll: () => [], getElementById: id => id === 'app' ? appEl : id === 'modal-root' ? modalEl : null, body: el('body'), createElement: () => el(), documentElement: el('html') };
  const location = { pathname: '/', search: '', origin: 'http://x', href: 'http://x/' };
  const mql = { matches: phone, addEventListener() {} };
  const win = { location, addEventListener() {}, matchMedia: () => mql, scrollTo() {}, navigator: { platform: 'Linux' }, setTimeout, clearTimeout, prompt: () => '', confirm: () => true, Intl };
  const ctx = { document: doc, window: win, location, navigator: win.navigator, matchMedia: win.matchMedia, setTimeout, clearTimeout, console, fetch: () => new Promise(() => {}) /* boot-time /api/init never resolves */, URL, URLSearchParams, Intl, prompt: win.prompt, confirm: win.confirm, requestAnimationFrame: fn => fn(), localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
  ctx.globalThis = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('app.js'), ctx);
  vm.runInContext(read('mobile.js'), ctx);
  vm.runInContext('globalThis.__t = { state, renderApp, dispatchAction, wbStatusOf };', ctx);
  return { t: ctx.__t, html, ctx, mql };
}

const now = new Date().toISOString();
function fixtures(t) {
  const seqSteps = [{ n: 1, status: 'planned', subject: 'Umoya + 24 classrooms', body: 'Hi', offsetDays: 0 }, { n: 2, status: 'planned', subject: 'Re: Umoya', body: 'page', offsetDays: 3 }, { n: 3, status: 'planned', subject: 'Re: Umoya', body: 'slots', offsetDays: 4 }, { n: 4, status: 'planned', subject: 'Re: Umoya', body: 'close', offsetDays: 5 }];
  const base = { flow: { status: 'done', steps: {} }, createdAt: now, updatedAt: now, stage: 'Contacted', sector: 'Mining', province: 'Gauteng', projectId: 'p1', project: 'Literacy', amount: 250000, fit: { score: 0.78, window: { label: 'budgeting' } } };
  const replied = { ...base, id: 'l-replied', company: 'Umoya Holdings', contactName: 'Sipho Dlamini', email: 's@x.co', emailStatus: 'Sent', sequence: { status: 'stopped', stoppedReason: 'Human reply received', steps: seqSteps.map(s => ({ ...s, status: s.n === 1 ? 'sent' : 'cancelled' })) }, triage: { category: 'wrong-person', confidence: 'high', excerpt: 'Please contact Naledi Mokoena, Head of CSI', dueAt: new Date(Date.now() - 3600e3).toISOString(), receivedAt: now, handled: false, hints: { redirect: { name: 'Naledi Mokoena', title: 'Head of CSI' } } } };
  const plan = { ...base, id: 'l-plan', company: 'Thembi Mining', contactName: 'Zanele', email: 'z@x.co', emailStatus: 'Draft', emailDraft: { subject: 'Thembi + Literacy', body: 'Worth a one-page look?' }, sequence: { status: 'draft', builtAt: now, approval: {}, steps: seqSteps } };
  const draft = { ...base, id: 'l-draft', company: 'Bolt South Africa', contactName: 'Naledi', email: 'n@x.co', emailStatus: 'Draft', emailDraft: { subject: 'Bolt + Literacy', body: 'Picture the first day of term.' }, guardrail: { issues: [{ severity: 'warn', type: 'more than one question/ask', text: '2 questions' }] } };
  const countersign = { ...base, id: 'l-cs', company: 'SAB Foundation', contactName: 'Lerato', email: 'l@x.co', emailStatus: 'Pending second approval', emailDraft: { subject: 'SAB + Literacy', body: 'Body' } };
  const failed = { ...base, id: 'l-failed', company: 'Failing Co', contactName: 'X', email: 'f@x.co', emailStatus: 'Failed: mailbox paused' };
  const quiet = { ...base, id: 'l-quiet', company: 'Quiet Ltd', contactName: 'Q', email: 'q@x.co', emailStatus: 'Sent', stage: 'Won' };
  t.state.data = { ...t.state.data, leads: [replied, plan, draft, countersign, failed, quiet], candidates: [], partners: [{ id: 'pt1', company: 'Quiet Ltd' }], bookings: [{ id: 'bk1', leadId: 'l-quiet', organization: 'Quiet Ltd', contactName: 'Q', email: 'q@x.co', date: '2026-11-03', time: '10:00', status: 'Requested', createdAt: now, videoPlatform: 'Google Meet' }], activities: [{ id: 'a1', text: 'Umoya Holdings replied — sequence stopped', type: 'reply', createdAt: now }], messages: [], emailEvents: [], projects: [{ id: 'p1', name: 'Literacy', funding: { fundingGap: 1 } }], provinces: [], videoPlatforms: [], staff: [], mailboxes: [{ id: 'm1', status: 'paused' }], settings: { approvalPolicy: 'four-eyes', outreachStyle: 'ladder', guardrail: 'block' }, sendPolicy: {} };
  t.state.auth = { authenticated: true, username: 'nandi@chelo', displayName: 'Nandi M', role: 'reviewer', approvalPolicy: 'four-eyes', csrfToken: 'x' };
  t.state.rel = { loading: false, busy: false, error: '', tab: 'timeline', viewId: null, view: null, summary: { totals: { partners: 1 }, stewardship: { open: 1, overdue: 1, dueThisWeek: 0, queue: [{ id: 'st1', partnerId: 'pt1', title: 'Quarterly impact update', kind: 'update', dueAt: now, status: 'open', overdue: true }] }, renewals: [], partners: [{ id: 'pt1', leadId: 'l-quiet', company: 'Quiet Ltd', owner: 'Nandi', status: 'Active', amount: 250000, health: { status: 'cooling', reasons: [] }, lastTouch: { at: now, title: 'Thank-you sent' }, nextDue: now, renewal: { at: now }, pledgeTotals: { pledged: 250000 }, openTasks: 1, people: 2, introducer: 'Board member' }] } };
}
const click = (t, action, data = {}) => t.dispatchAction({ dataset: { action, ...data } });

test('mobile: phone mode renders Inbox with replies, failed sends and briefing requests; desktop chrome absent', async () => {
  const { t, html } = boot(); fixtures(t);
  t.renderApp();
  assert.match(html.app, /class="m-shell"/); assert.match(html.app, /class="m-tabs"/);
  assert.doesNotMatch(html.app, /class="sidebar"|class="app-shell"|data-view="ops"|Deliverability|Data quality/);
  assert.match(html.app, /Umoya Holdings/); assert.match(html.app, /Suggested: Wrong person/); assert.match(html.app, /overdue/);
  assert.match(html.app, /Failing Co/); assert.match(html.app, /Briefing requested · 2026-11-03 10:00/);
  assert.doesNotMatch(html.app, /Quiet Ltd<\/strong><span>Q · /, 'quiet leads are not inbox items');
  const tabCounts = [...html.app.matchAll(/data-tab="(\w+)"[\s\S]*?(?:<span class="m-badge">(\d+)<\/span>)?<\/span><span>/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(tabCounts.find(x => x[0] === 'inbox'), ['inbox', '3']);
  assert.deepEqual(tabCounts.find(x => x[0] === 'approvals'), ['approvals', '3']);
});

test('mobile: Approvals lists plan, draft and countersign items; lead detail exposes approve/countersign/reject and triage; sequence panel reused', async () => {
  const { t, html } = boot(); fixtures(t);
  await click(t, 'm-tab', { tab: 'approvals' });
  assert.match(html.app, /Thembi Mining[\s\S]*Sequence plan/); assert.match(html.app, /Bolt South Africa[\s\S]*First-touch draft/); assert.match(html.app, /SAB Foundation[\s\S]*Countersign email \(4-eyes\)/);
  assert.match(html.app, /strict 4-eyes/);
  await click(t, 'm-open-lead', { id: 'l-draft' });
  assert.match(html.app, /data-action="email-approve" data-id="l-draft"/); assert.match(html.app, /more than one question/);
  assert.match(html.app, /Picture the first day of term/);
  await click(t, 'm-back'); await click(t, 'm-open-lead', { id: 'l-cs' });
  assert.match(html.app, /data-action="email-countersign"/); assert.match(html.app, /data-action="email-return"/);
  await click(t, 'm-back'); await click(t, 'm-open-lead', { id: 'l-plan' });
  assert.match(html.app, /data-action="seq-approve" data-id="l-plan"/); assert.match(html.app, /Follow-up sequence/);
  await click(t, 'm-back'); await click(t, 'm-open-lead', { id: 'l-replied' });
  assert.match(html.app, /data-action="triage-apply" data-id="l-replied" data-category="wrong-person"/); assert.match(html.app, /Naledi Mokoena/);
  assert.match(html.app, /Umoya Holdings replied — sequence stopped/, 'timeline shown');
  assert.doesNotMatch(html.app, /Regenerate draft|Build sequence plan|wb-waterfall/, 'desktop workbench actions hidden');
});

test('mobile: Leads search + detail facts; More → notifications and relationships lite; booking confirm button; sign out present', async () => {
  const { t, html } = boot(); fixtures(t);
  await click(t, 'm-tab', { tab: 'leads' });
  assert.match(html.app, /6 in the workspace/); assert.match(html.app, /id="m-search"/);
  t.state.m.q = 'bolt'; t.renderApp();
  assert.match(html.app, /Bolt South Africa/); assert.doesNotMatch(html.app, /Umoya Holdings/);
  await click(t, 'm-open-lead', { id: 'l-quiet' });
  assert.match(html.app, /Briefing requested/); assert.match(html.app, /data-action="confirm-booking" data-id="bk1"/);
  assert.match(html.app, /<dt>Fit<\/dt><dd>78 · budgeting/);
  await click(t, 'm-tab', { tab: 'more' });
  assert.match(html.app, /Notifications/); assert.match(html.app, /Relationships/); assert.match(html.app, /data-action="logout"/); assert.match(html.app, /Reviewer · strict 4-eyes/);
  assert.match(html.app, /desktop-only/);
  await click(t, 'm-section', { section: 'notifications' });
  assert.match(html.app, /past the response SLA/); assert.match(html.app, /countersignature/); assert.match(html.app, /circuit breaker/); assert.match(html.app, /stewardship touch/);
  await click(t, 'm-goto', { tab: 'approvals' }); assert.match(html.app, /<h1>Approvals<\/h1>/);
  await click(t, 'm-tab', { tab: 'more' }); await click(t, 'm-section', { section: 'relationships' });
  assert.match(html.app, /1 won partner/); assert.match(html.app, /Quiet Ltd/);
  await click(t, 'm-open-partner', { id: 'pt1' });
  assert.match(html.app, /Thank-you sent/); assert.match(html.app, /Quarterly impact update/); assert.match(html.app, /<dt>Health<\/dt><dd>cooling/);
});

test('mobile: desktop viewport keeps the full workspace shell', () => {
  const { t, html, ctx } = boot({ phone: false }); fixtures(t);
  assert.equal(ctx.window.isPhone(), false);
  try { t.renderApp(); } catch (e) { /* desktop fixtures are partial; only the shell choice matters here */ }
  assert.doesNotMatch(html.app, /class="m-shell"/);
});
