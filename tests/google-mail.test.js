const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const createGoogleMail = require('../lib/google-mail');
const createSendEngine = require('../lib/send-engine');

const cfg = { clientId: 'abc.apps.googleusercontent.com', clientSecret: 'shh', configured: true, hostedDomain: 'cheloapp.com' };
const idToken = payload => `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;
function fakeFetch(handlers) {
  const calls = [];
  const fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    for (const [pattern, fn] of handlers) if (pattern.test(url)) { const r = typeof fn === 'function' ? fn(url, opts) : fn; return { status: r.status || 200, ok: (r.status || 200) < 300, json: r.json, text: JSON.stringify(r.json) }; }
    return { status: 404, ok: false, json: { error: { message: `no handler for ${url}` } }, text: '' };
  };
  return { fetch, calls };
}

test('google: auth URL asks for send + read-only, offline consent, our callback, company domain; state is signed and expires', () => {
  const clock = { t: new Date('2026-11-19T09:00:00Z') };
  const g = createGoogleMail({ getConfig: () => cfg, signingKey: 'k', now: () => clock.t });
  const u = new URL(g.authUrl({ baseUrl: 'https://chelo-outreach.vercel.app/', actor: 'mk', loginHint: 'marketing@cheloapp.com' }));
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://chelo-outreach.vercel.app/api/oauth/google/callback');
  assert.match(u.searchParams.get('scope'), /gmail\.send/); assert.match(u.searchParams.get('scope'), /gmail\.readonly/);
  assert.ok(!/gmail\.modify|mail\.google\.com\//.test(u.searchParams.get('scope')), 'never asks for full mailbox control');
  assert.equal(u.searchParams.get('access_type'), 'offline'); assert.equal(u.searchParams.get('prompt'), 'consent'); assert.equal(u.searchParams.get('hd'), 'cheloapp.com');
  const state = u.searchParams.get('state');
  assert.equal(g.verifyState(state).actor, 'mk');
  assert.equal(g.verifyState(state.slice(0, -2) + 'xx'), null, 'tampered');
  clock.t = new Date('2026-11-19T09:20:00Z');
  assert.equal(g.verifyState(state), null, 'expired after 15 minutes');
  const other = createGoogleMail({ getConfig: () => cfg, signingKey: 'different' });
  assert.equal(other.verifyState(state), null, 'another key cannot forge');
  assert.throws(() => createGoogleMail({ getConfig: () => ({ configured: false }) }).authUrl({ baseUrl: 'x' }), /Settings → Google/);
});

test('google: code exchange returns the mailbox address and refresh token, and names any permission the user unticked', async () => {
  const { fetch } = fakeFetch([[/oauth2\.googleapis\.com\/token/, (url, o) => ({ json: { access_token: 'at', refresh_token: 'rt', expires_in: 3600, id_token: idToken({ email: 'Marketing@CheloApp.com', email_verified: true }), scope: /full/.test(o.body) ? 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly openid email' : 'https://www.googleapis.com/auth/gmail.send openid email' } })]]);
  const g = createGoogleMail({ getConfig: () => cfg, signingKey: 'k', fetch });
  const partial = await g.exchangeCode({ code: 'c1', baseUrl: 'https://x.test' });
  assert.equal(partial.email, 'marketing@cheloapp.com'); assert.equal(partial.refreshToken, 'rt');
  assert.deepEqual(partial.missing, ['Read email (read-only) to notice replies and bounces']);
  const ok = await g.exchangeCode({ code: 'full', baseUrl: 'https://x.test' });
  assert.deepEqual(ok.missing, []);
  const noRefresh = fakeFetch([[/token/, { json: { access_token: 'at', id_token: idToken({ email: 'a@b.c' }) } }]]);
  await assert.rejects(() => createGoogleMail({ getConfig: () => cfg, signingKey: 'k', fetch: noRefresh.fetch }).exchangeCode({ code: 'c', baseUrl: 'x' }), /long-lived token/);
});

test('google: sending builds a full MIME message with the PDF and posts it to Gmail; access token is refreshed once and cached', async () => {
  let refreshes = 0; let rawSeen = '';
  const { fetch, calls } = fakeFetch([
    [/oauth2\.googleapis\.com\/token/, () => { refreshes++; return { json: { access_token: `at${refreshes}`, expires_in: 3600 } }; }],
    [/messages\/send/, (url, o) => { rawSeen = Buffer.from(JSON.parse(o.body).raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); return { json: { id: 'gm1', threadId: 'th1' } }; }],
    [/profile/, { json: { emailAddress: 'marketing@cheloapp.com' } }]
  ]);
  const g = createGoogleMail({ getConfig: () => cfg, signingKey: 'k', fetch });
  const mailbox = { id: 'm1', fromEmail: 'marketing@cheloapp.com', fromName: 'Chelo', authType: 'google', refreshToken: 'rt' };
  const t = g.transport(mailbox);
  await t.verify();
  const info = await t.sendMail({ from: { name: 'Chelo Partnerships', address: 'marketing@cheloapp.com' }, to: 'csi@example.org', subject: 'Exploring Community Investment', text: 'Hello', html: '<p>Hello</p>', headers: { 'X-Chelo-Lead': 'L1', 'List-Unsubscribe': '<https://x/opt-out/t>' }, attachments: [{ filename: 'Chelo-proposal.pdf', content: Buffer.from('%PDF-1.4 fake'), contentType: 'application/pdf' }] });
  assert.deepEqual(info.accepted, ['csi@example.org']); assert.match(info.messageId, /^<.+@cheloapp\.com>$/); assert.equal(info.gmailId, 'gm1');
  assert.match(rawSeen, /^From: Chelo Partnerships <marketing@cheloapp\.com>/m);
  assert.match(rawSeen, /^X-Chelo-Lead: L1/m); assert.match(rawSeen, /^List-Unsubscribe: /m);
  assert.match(rawSeen, /Content-Type: application\/pdf; name=Chelo-proposal\.pdf/);
  assert.equal(refreshes, 1, 'one refresh for verify + send');
  assert.ok(calls.filter(c => /messages\/send/.test(c.url)).every(c => c.opts.headers.authorization === 'Bearer at1'));
});

test('google: a revoked connection is reported as disconnected and the engine pauses the mailbox asking for Reconnect', async () => {
  const { fetch } = fakeFetch([[/token/, { status: 400, json: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } }]]);
  const g = createGoogleMail({ getConfig: () => cfg, signingKey: 'k', fetch });
  const conn = new DatabaseSync(':memory:'); const clock = { t: new Date('2026-11-19T07:40:00Z') };
  const engine = createSendEngine({ conn, encryptSecret: v => ({ v }), decryptSecret: r => r.v, isSuppressed: () => false, now: () => clock.t, random: () => 0.5, transportFactory: m => g.transport(m) });
  const m = engine.connectGoogleMailbox({ email: 'Marketing@cheloapp.com', refreshToken: 'rt-old', actor: 'test' });
  assert.equal(m.authType, 'google'); assert.equal(m.host, 'gmail-api'); assert.equal(m.imap.host, 'gmail-api');
  const secret = engine.getMailbox(m.id, { secrets: true });
  assert.equal(secret.refreshToken, 'rt-old'); assert.equal(secret.password, '');
  assert.equal(engine.getMailbox(m.id).hasPassword, true, 'token present (never exposed)');
  const job = engine.enqueue({ leadId: 'L1', to: 'a@example.org', subject: 'Hi', text: 'x', immediate: true });
  const r = await engine.tick({ limit: 1, onlyJobId: job.id });
  const after = engine.getJob(job.id); const box = engine.getMailbox(m.id);
  assert.equal(after.status, 'held'); assert.equal(after.errorClass, 'auth');
  assert.equal(box.status, 'paused'); assert.match(box.pausedReason, /Google disconnected.*Reconnect/);
  // Reconnecting re-links the same mailbox (same id), replaces the token and resumes it.
  const again = engine.connectGoogleMailbox({ email: 'marketing@cheloapp.com', refreshToken: 'rt-new', actor: 'test' });
  assert.equal(again.id, m.id); assert.equal(again.status, 'active');
  assert.equal(engine.getMailbox(m.id, { secrets: true }).refreshToken, 'rt-new');
  assert.equal(r.ran, 1);
});

test('google: inbox read (metadata only) yields the same reply / bounce signals as IMAP and skips our own mail', async () => {
  const msgs = {
    a: { threadId: 't1', internalDate: '1763543000000', snippet: 'Thanks, let us talk next week', payload: { headers: [{ name: 'From', value: 'Thandi <thandi@example.org>' }, { name: 'Subject', value: 'Re: Exploring Community Investment' }, { name: 'In-Reply-To', value: '<x@cheloapp.com>' }] } },
    b: { threadId: 't2', internalDate: '1763543100000', payload: { headers: [{ name: 'From', value: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>' }, { name: 'Subject', value: 'Delivery Status Notification (Failure)' }, { name: 'X-Failed-Recipients', value: 'Gone@example.org' }] } },
    c: { threadId: 't3', internalDate: '1763543200000', payload: { headers: [{ name: 'From', value: 'marketing@cheloapp.com' }, { name: 'Subject', value: 'note to self' }] } }
  };
  const { fetch, calls } = fakeFetch([
    [/token/, { json: { access_token: 'at', expires_in: 3600 } }],
    [/messages\?/, { json: { messages: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] } }],
    [/messages\/([abc])\?/, url => ({ json: msgs[url.match(/messages\/([abc])/)[1]] })]
  ]);
  const g = createGoogleMail({ getConfig: () => cfg, signingKey: 'k', fetch });
  const r = await g.checkInbox({ id: 'm1', fromEmail: 'marketing@cheloapp.com', refreshToken: 'rt' }, { since: '2026-11-19T08:00:00Z' });
  assert.equal(r.checked, 3);
  assert.deepEqual(r.signals.map(s => [s.kind, s.email]), [['reply', 'thandi@example.org'], ['hard_bounce', 'gone@example.org']]);
  assert.equal(r.signals[0].text, 'Thanks, let us talk next week');
  assert.match(r.signals[0].headers, /in-reply-to: <x@cheloapp\.com>/);
  const list = calls.find(c => /messages\?/.test(c.url)).url;
  assert.match(decodeURIComponent(list), /in:inbox after:\d+ -from:me/);
  assert.ok(calls.filter(c => /messages\/[abc]\?/.test(c.url)).every(c => /format=metadata/.test(c.url)), 'never downloads bodies');
});

test('google settings: accepts pasted JSON, swapped fields and stray quotes; rejects a non-ID with a plain explanation', async () => {
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const { spawn } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chelo-g-')); const port = 3200 + Math.floor(Math.random() * 500);
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, DATA_DIR: dir, DEMO_OPEN_ACCESS: 'true', NODE_ENV: 'development', SMTP_PROBE_DISABLED: 'true', HOST: '127.0.0.1', PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => { let out = ''; const t = setTimeout(() => reject(new Error(out)), 15000); child.stdout.on('data', c => { out += c; if (/running at/.test(out)) { clearTimeout(t); resolve(); } }); child.stderr.on('data', c => { out += c; }); });
  try {
    const base = `http://127.0.0.1:${port}`;
    const st = await fetch(`${base}/api/auth/status`); const cookie = (st.headers.get('set-cookie') || '').split(';')[0]; const { csrfToken } = await st.json();
    const put = async body => { const r = await fetch(`${base}/api/settings/google`, { method: 'PUT', headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrfToken }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json() }; };
    const id = '123456789-abcdefg.apps.googleusercontent.com', secret = 'GOCSPX-abcdefghijklmnopqrstuvwxyz';
    let r = await put({ clientId: ` "${id}" \n`, clientSecret: `'${secret}'` }); assert.equal(r.status, 200); assert.equal(r.json.clientIdHint, `${id.slice(0, 14)}…`);
    r = await put({ clientId: secret, clientSecret: id }); assert.equal(r.status, 200, 'swapped fields are corrected');
    r = await put({ clientId: JSON.stringify({ web: { client_id: id, client_secret: secret, redirect_uris: ['x'] } }), clientSecret: '' }); assert.equal(r.status, 200, 'downloaded JSON accepted');
    r = await put({ clientId: `Client ID: ${id}`, clientSecret: secret }); assert.equal(r.status, 200, 'label prefix stripped');
    r = await put({ clientId: 'my-project-12345', clientSecret: secret }); assert.equal(r.status, 400); assert.match(r.json.error, /not a Google Client ID.*GOCSPX/);
  } finally { child.kill('SIGTERM'); }
});

test('mailbox ownership: each person sends from their own mailbox; shared mailboxes serve everyone else; follow-ups keep the first mailbox', () => {
  const conn = new DatabaseSync(':memory:');
  const clock = { t: new Date('2026-11-20T08:00:00Z') }; // 10:00 SAST, Friday
  const engine = createSendEngine({ conn, encryptSecret: v => ({ v }), decryptSecret: r => r.v, isSuppressed: () => false, now: () => clock.t, random: () => 0.5, transportFactory: () => ({ sendMail: async o => ({ messageId: 'x', accepted: [o.to], rejected: [] }) }) });
  const shared = engine.saveMailbox({ fromEmail: 'marketing@cheloapp.com', fromName: 'Chelo', host: 'smtp.gmail.com', port: 465, secure: true, username: 'marketing@cheloapp.com', password: 'p', rampEnabled: false }, { actor: 'test' });
  const thandi = engine.connectGoogleMailbox({ email: 'thandi@cheloapp.com', refreshToken: 'rt', owner: 'Thandi@cheloapp.com', actor: 'test' });
  assert.equal(thandi.owner, 'thandi@cheloapp.com'); assert.equal(engine.getMailbox(shared.id).owner, '');
  assert.equal(engine.actorLogin('Thandi M <thandi@cheloapp.com>'), 'thandi@cheloapp.com'); assert.equal(engine.actorLogin('sequence'), '');
  const own = engine.enqueue({ leadId: 'l1', to: 'a@funder.org', subject: 's', text: 't', requestedBy: 'Thandi M <thandi@cheloapp.com>' });
  assert.equal(own.mailboxId, thandi.id, 'approver with a mailbox sends from it');
  const other = engine.enqueue({ leadId: 'l2', to: 'b@funder.org', subject: 's', text: 't', requestedBy: 'Sipho <sipho@cheloapp.com>' });
  assert.equal(other.mailboxId, shared.id, 'someone without a mailbox falls back to the shared one, never a colleague\'s');
  const auto = engine.enqueue({ leadId: 'l1', to: 'a@funder.org', subject: 'Re: s', text: 't', requestedBy: 'sequence', mailboxId: own.mailboxId });
  assert.equal(auto.mailboxId, thandi.id, 'a follow-up pinned to the first mailbox stays there');
  engine.setMailboxOwner(shared.id, 'sipho@cheloapp.com');
  assert.ok(engine.pickMailbox('', { owner: 'nobody@cheloapp.com' }), 'with no shared mailbox left, any active one is used rather than failing');
});

test('sign in with google: identity-only URL; verified company account accepted; wrong domain / unverified refused', async () => {
  const clock = { t: new Date('2026-11-20T09:00:00Z') };
  const mk = (claims) => fakeFetch([[/oauth2\.googleapis\.com\/token/, { json: { access_token: 'at', id_token: idToken(claims), expires_in: 3600 } }]]);
  const url = new URL(createGoogleMail({ getConfig: () => cfg, signingKey: 'k', now: () => clock.t }).loginUrl({ baseUrl: 'https://communication.cheloapp.com' }));
  assert.equal(url.searchParams.get('redirect_uri'), 'https://communication.cheloapp.com/api/auth/google/callback');
  assert.match(url.searchParams.get('scope'), /^openid email profile .*gmail\.send.*gmail\.readonly/); assert.equal(url.searchParams.get('hd'), 'cheloapp.com'); assert.equal(url.searchParams.get('access_type'), 'offline'); assert.equal(url.searchParams.get('prompt'), 'select_account');
  assert.equal(new URL(createGoogleMail({ getConfig: () => cfg, signingKey: 'k', now: () => clock.t }).loginUrl({ baseUrl: 'https://x', consent: true })).searchParams.get('prompt'), 'consent');
  let f = mk({ aud: cfg.clientId, email: 'Thandi@cheloapp.com', email_verified: true, hd: 'cheloapp.com', name: 'Thandi M' });
  const who = await createGoogleMail({ getConfig: () => cfg, signingKey: 'k', now: () => clock.t, fetch: f.fetch }).exchangeLoginCode({ code: 'c', baseUrl: 'https://communication.cheloapp.com' });
  assert.deepEqual([who.email, who.name], ['thandi@cheloapp.com', 'Thandi M']); assert.equal(who.missing.length, 2, 'no gmail scopes in this fake → both reported missing');
  f = mk({ aud: cfg.clientId, email: 'someone@gmail.com', email_verified: true, name: 'X' });
  await assert.rejects(createGoogleMail({ getConfig: () => cfg, signingKey: 'k', now: () => clock.t, fetch: f.fetch }).exchangeLoginCode({ code: 'c', baseUrl: 'https://x' }), /not a cheloapp\.com account/);
  f = mk({ aud: cfg.clientId, email: 'thandi@cheloapp.com', email_verified: false, hd: 'cheloapp.com' });
  await assert.rejects(createGoogleMail({ getConfig: () => cfg, signingKey: 'k', now: () => clock.t, fetch: f.fetch }).exchangeLoginCode({ code: 'c', baseUrl: 'https://x' }), /did not confirm/);
  f = mk({ aud: 'other-app', email: 'thandi@cheloapp.com', email_verified: true, hd: 'cheloapp.com' });
  await assert.rejects(createGoogleMail({ getConfig: () => cfg, signingKey: 'k', now: () => clock.t, fetch: f.fetch }).exchangeLoginCode({ code: 'c', baseUrl: 'https://x' }), /different app/);
});

test('sign in with google end-to-end: first company user joins as staff, second visit reuses the account, password login still works, session is set', async () => {
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const http = require('node:http'); const { spawn } = require('node:child_process');
  const claims = { aud: '1-a.apps.googleusercontent.com', email: 'thandi@cheloapp.com', email_verified: true, hd: 'cheloapp.com', name: 'Thandi M' };
  const google = { scope: 'openid email profile https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly', refresh: 'rt-1', calls: 0 };
  const fakeGoogle = http.createServer((req, res) => { google.calls += 1; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ access_token: 'at', id_token: idToken(claims), expires_in: 3600, scope: google.scope, ...(google.refresh ? { refresh_token: google.refresh } : {}) })); });
  await new Promise(r => fakeGoogle.listen(0, '127.0.0.1', r)); const gport = fakeGoogle.address().port;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chelo-gl-')); const port = 3700 + Math.floor(Math.random() * 500);
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, DATA_DIR: dir, NODE_ENV: 'development', SMTP_PROBE_DISABLED: 'true', HOST: '127.0.0.1', PORT: String(port), GOOGLE_TOKEN_URL_OVERRIDE: `http://127.0.0.1:${gport}/token`, GOOGLE_CLIENT_ID: '1-a.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'GOCSPX-test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => { let out = ''; const t = setTimeout(() => reject(new Error(out)), 15000); child.stdout.on('data', c => { out += c; if (/running at/.test(out)) { clearTimeout(t); resolve(); } }); child.stderr.on('data', c => { out += c; }); });
  try {
    const base = `http://127.0.0.1:${port}`;
    const j = async (p, o) => { const r = await fetch(`${base}${p}`, { redirect: 'manual', ...o }); return { r, body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() }; };
    let s = await j('/api/auth/status'); assert.equal(s.body.setupRequired, true); assert.equal(Boolean(s.body.googleLogin), false, 'no Google button before the first admin exists');
    let st = (await j('/api/auth/google/start')); assert.equal(st.r.status, 409);
    const setup = await j('/api/auth/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'root@cheloapp.com', displayName: 'Root', password: 'correct-horse-battery-staple' }) }); assert.ok([200, 201].includes(setup.r.status));
    s = await j('/api/auth/status'); assert.equal(s.body.googleLogin, true); assert.equal(s.body.googleDomain, 'cheloapp.com');
    st = await j('/api/auth/google/start'); assert.equal(st.r.status, 302); const loc = new URL(st.r.headers.get('location')); assert.equal(loc.searchParams.get('redirect_uri'), `${base}/api/auth/google/callback`);
    const state = loc.searchParams.get('state');
    let cb = await j(`/api/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`); assert.equal(cb.r.status, 302); assert.equal(cb.r.headers.get('location'), '/?login=welcome&mailbox=connected&email=thandi%40cheloapp.com');
    const cookie = (cb.r.headers.get('set-cookie') || '').split(';')[0]; assert.ok(cookie, 'session cookie set');
    s = await j('/api/auth/status', { headers: { cookie } }); assert.equal(s.body.authenticated, true); assert.equal(s.body.username, 'thandi@cheloapp.com'); assert.equal(s.body.displayName, 'Thandi M'); assert.equal(s.body.role, 'owner'); assert.equal(s.body.isRoot, false);
    const me = await j('/api/me/mailboxes', { headers: { cookie } }); assert.equal(me.r.status, 200); assert.equal(me.body.login, 'thandi@cheloapp.com');
    assert.equal(me.body.mailboxes.length, 1, 'mailbox connected at sign-in'); assert.equal(me.body.mailboxes[0].fromEmail, 'thandi@cheloapp.com'); assert.equal(me.body.mailboxes[0].owner, 'thandi@cheloapp.com'); assert.equal(me.body.mailboxes[0].authType, 'google'); assert.equal(me.body.mailboxes[0].fromName, 'Thandi M');
    // Returning visit: Google gives no refresh token on select_account; mailbox already usable → straight in, no consent round-trip
    google.refresh = ''; const before = google.calls;
    cb = await j(`/api/auth/google/callback?code=abc&state=${encodeURIComponent(new URL((await j('/api/auth/google/start')).r.headers.get('location')).searchParams.get('state'))}`); assert.equal(cb.r.headers.get('location'), '/?login=ok&mailbox=ready&email=thandi%40cheloapp.com', 'second visit: no welcome, same account'); assert.equal(google.calls, before + 1);
    // Mailbox removed → next sign-in without a token bounces once to the consent screen, then connects
    const del = await j(`/api/me/mailboxes/${encodeURIComponent(me.body.mailboxes[0].id)}`, { method: 'DELETE', headers: { cookie, 'x-csrf-token': s.body.csrfToken } }); assert.equal(del.r.status, 200);
    cb = await j(`/api/auth/google/callback?code=abc&state=${encodeURIComponent(new URL((await j('/api/auth/google/start')).r.headers.get('location')).searchParams.get('state'))}`);
    const again = new URL(cb.r.headers.get('location')); assert.equal(again.hostname, 'accounts.google.com'); assert.equal(again.searchParams.get('prompt'), 'consent'); assert.equal(again.searchParams.get('login_hint'), 'thandi@cheloapp.com');
    google.refresh = 'rt-2';
    cb = await j(`/api/auth/google/callback?code=abc&state=${encodeURIComponent(again.searchParams.get('state'))}`); assert.equal(cb.r.headers.get('location'), '/?login=ok&mailbox=connected&email=thandi%40cheloapp.com');
    // Boxes unticked → sign-in refused with a plain message
    google.scope = 'openid email profile';
    cb = await j(`/api/auth/google/callback?code=abc&state=${encodeURIComponent(new URL((await j('/api/auth/google/start')).r.headers.get('location')).searchParams.get('state'))}`); assert.match(cb.r.headers.get('location'), /login=error.*both\+boxes\+ticked/); assert.equal(cb.r.headers.get('set-cookie'), null, 'no session when refused');
    google.scope = 'openid email profile https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly';
    const bad = await j('/api/auth/google/callback?code=abc&state=tampered'); assert.match(bad.r.headers.get('location'), /login=error/);
    const pw = await j('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'root@cheloapp.com', password: 'correct-horse-battery-staple' }) }); assert.equal(pw.r.status, 200, 'password login still works');
    const guess = await j('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'thandi@cheloapp.com', password: 'anything-at-all-12' }) }); assert.equal(guess.r.status, 401, 'google-created accounts have no guessable password');
  } finally { child.kill('SIGTERM'); fakeGoogle.close(); }
});
