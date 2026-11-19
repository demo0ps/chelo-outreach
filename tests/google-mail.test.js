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
