const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { discover, dnsAdvice, providerFromMx, candidatesFor } = require('../lib/mail-autodiscover');
const createSendEngine = require('../lib/send-engine');

const googleResolver = { resolveMx: async () => [{ exchange: 'smtp.google.com', priority: 1 }] };
const selfHostedResolver = { resolveMx: async d => [{ exchange: `mx.${d}`, priority: 10 }] };
const okImap = async () => ({ ok: true });

test('autodiscover: Google Workspace MX → gmail servers, login proven, DNS advice names Google', async () => {
  const verified = [];
  const r = await discover({
    email: 'Partnerships@CheloApp.com', password: 'app-pass',
    resolver: googleResolver,
    smtpVerify: async c => { verified.push(`${c.host}:${c.port}:${c.username}`); },
    imapCheck: okImap
  });
  assert.equal(r.provider, 'google');
  assert.equal(r.email, 'partnerships@cheloapp.com');
  assert.deepEqual(r.smtp, { host: 'smtp.gmail.com', port: 465, secure: true });
  assert.deepEqual(r.imap, { host: 'imap.gmail.com', port: 993 });
  assert.equal(verified[0], 'smtp.gmail.com:465:partnerships@cheloapp.com');
  assert.equal(r.authRefused, false);
  assert.match(r.summary, /Google/);
  const dns = dnsAdvice(r.domain, r.provider);
  assert.ok(dns.records.some(x => x.type === 'TXT' && /include:_spf\.google\.com/.test(x.value)));
  assert.ok(dns.records.some(x => /_dmarc/.test(x.name)));
});

test('autodiscover: self-hosted tries mail.<domain> first, then the MX host, then the bare domain', async () => {
  const tried = [];
  const r = await discover({
    email: 'csi@example.org', password: 'x',
    resolver: selfHostedResolver,
    smtpVerify: async c => { tried.push(c.host); if (c.host !== 'example.org') throw new Error('ECONNRESET'); },
    imapCheck: async c => ({ ok: c.host === 'mx.example.org' })
  });
  assert.equal(r.provider, 'self-hosted');
  assert.equal(tried[0], 'mail.example.org');
  assert.ok(tried.includes('mx.example.org'));
  assert.equal(r.smtp.host, 'example.org');
  assert.equal(r.imap.host, 'mx.example.org');
  assert.ok(r.tried.smtp.filter(t => !t.ok).length >= 2);
});

test('autodiscover: an authentication refusal stops the search and says so plainly', async () => {
  let calls = 0;
  const r = await discover({
    email: 'a@example.org', password: 'wrong',
    resolver: selfHostedResolver,
    smtpVerify: async () => { calls++; const e = new Error('Invalid login'); e.response = '535 5.7.8 Username and Password not accepted'; throw e; },
    imapCheck: async () => ({ ok: false, auth: true, error: 'AUTHENTICATIONFAILED' })
  });
  assert.equal(calls, 1, 'stops after the first auth refusal');
  assert.equal(r.smtp, null);
  assert.equal(r.authRefused, true);
  assert.match(r.summary, /password/i);
});

test('autodiscover: slow servers time out instead of hanging; bad input rejected', async () => {
  const r = await discover({
    email: 'a@example.org', password: 'x', timeoutMs: 20,
    resolver: { resolveMx: async () => { throw new Error('ENOTFOUND'); } },
    smtpVerify: () => new Promise(() => {}),
    imapCheck: async () => ({ ok: false, error: 'timeout' })
  });
  assert.equal(r.smtp, null);
  assert.ok(r.tried.smtp.every(t => !t.ok));
  await assert.rejects(() => discover({ email: 'nope', password: 'x', smtpVerify: async () => {} }), /full email address/);
  await assert.rejects(() => discover({ email: 'a@b.co', password: '', smtpVerify: async () => {} }), /password/);
});

test('autodiscover helpers: provider detection and candidate order', () => {
  assert.equal(providerFromMx([{ exchange: 'aspmx.l.google.com' }]), 'google');
  assert.equal(providerFromMx([{ exchange: 'x-com.mail.protection.outlook.com' }]), 'microsoft');
  assert.equal(providerFromMx([{ exchange: 'mx.zoho.com' }]), 'zoho');
  assert.equal(providerFromMx([]), 'self-hosted');
  const c = candidatesFor('cheloapp.com', 'microsoft', []);
  assert.equal(c.smtp[0].host, 'smtp.office365.com');
  assert.equal(c.imap[0].host, 'outlook.office365.com');
});

test('send engine: per-mailbox IMAP settings persist, default to the SMTP password, and record sync results', () => {
  const conn = new DatabaseSync(':memory:');
  const clock = { t: new Date('2026-10-26T08:00:00Z') };
  const engine = createSendEngine({ conn, encryptSecret: v => ({ v }), decryptSecret: r => r.v, isSuppressed: () => false, now: () => clock.t, random: () => 0.5, transportFactory: () => ({ sendMail: async () => ({}) }) });
  const m = engine.saveMailbox({ fromEmail: 'partnerships@cheloapp.com', host: 'smtp.gmail.com', port: 465, secure: true, username: 'partnerships@cheloapp.com', password: 'app-pass' }, { actor: 'test' });
  assert.equal(engine.getMailbox(m.id).imap, null);
  engine.setMailboxImap(m.id, { host: 'imap.gmail.com', port: 993 });
  const pub = engine.getMailbox(m.id);
  assert.deepEqual({ host: pub.imap.host, port: pub.imap.port, username: pub.imap.username, hasPassword: pub.imap.hasPassword }, { host: 'imap.gmail.com', port: 993, username: 'partnerships@cheloapp.com', hasPassword: false });
  assert.equal(pub.imap.password, undefined, 'no secret without secrets:true');
  const secret = engine.getMailbox(m.id, { secrets: true });
  assert.equal(secret.imap.password, 'app-pass', 'falls back to the SMTP password');
  engine.setMailboxImap(m.id, { host: 'imap.gmail.com', port: 993, password: 'other' });
  assert.equal(engine.getMailbox(m.id, { secrets: true }).imap.password, 'other');
  engine.setMailboxHealth(m.id, { status: 'ok' }); engine.setMailboxStatus(m.id, 'paused', 'test'); engine.setMailboxStatus(m.id, 'active'); // row updates must tolerate the imap_json column
  assert.equal(engine.getMailbox(m.id).imap.host, 'imap.gmail.com');
  engine.recordImapSync(m.id, { ok: true, checked: 3, matched: 1 });
  const after = engine.getMailbox(m.id);
  assert.equal(after.imap.lastSyncAt, clock.t.toISOString());
  assert.equal(after.imap.lastSync.checked, 3);
  // Migration is idempotent on an existing DB (column already present).
  createSendEngine({ conn, encryptSecret: v => ({ v }), decryptSecret: r => r.v, isSuppressed: () => false, now: () => clock.t, transportFactory: () => ({}) });
  engine.setMailboxImap(m.id, null);
  assert.equal(engine.getMailbox(m.id).imap, null);
  assert.throws(() => engine.setMailboxImap(m.id, { port: 993 }), /IMAP host/);
});

test('send engine: approved email goes immediately inside the window; sendNow pushes a waiting job; closed window holds', async () => {
  const conn = new DatabaseSync(':memory:');
  const clock = { t: new Date('2026-11-19T07:40:00Z') }; // Thursday 09:40 SAST — window open
  const sent = [];
  const engine = createSendEngine({ conn, encryptSecret: v => ({ v }), decryptSecret: r => r.v, isSuppressed: () => false, now: () => clock.t, random: () => 0.9, transportFactory: () => ({ sendMail: async m => { sent.push(m); return { messageId: `<${sent.length}@t>`, accepted: [m.to], rejected: [] }; } }) });
  const m = engine.saveMailbox({ fromEmail: 'marketing@cheloapp.com', host: 'smtp.gmail.com', port: 465, secure: true, username: 'marketing@cheloapp.com', password: 'x' }, { actor: 'test' });
  assert.equal(engine.windowState().open, true);
  const first = engine.enqueue({ leadId: 'L1', to: 'a@example.org', subject: 'Hi', text: 'x', immediate: true });
  assert.equal(first.scheduledAt, clock.t.toISOString(), 'immediate: no gap or jitter');
  const second = engine.enqueue({ leadId: 'L2', to: 'b@example.org', subject: 'Hi', text: 'x', immediate: true });
  assert.ok(second.scheduledAt > clock.t.toISOString(), 'second email keeps spacing behind the first');
  const r = await engine.sendNow(second.id, { actor: 'test' });
  assert.equal(r.ok, true); assert.equal(r.job.status, 'sent'); assert.equal(sent.length, 1);
  // Closed window: Saturday
  clock.t = new Date('2026-11-21T10:00:00Z');
  const w = engine.windowState(); assert.equal(w.open, false); assert.match(w.nextOpen, /^2026-11-23T06:30/);
  const held = engine.enqueue({ leadId: 'L3', to: 'c@example.org', subject: 'Hi', text: 'x', immediate: true });
  assert.match(held.scheduledAt, /^2026-11-23T06:3/, 'held for Monday 08:30 SAST');
  const r2 = await engine.sendNow(held.id, { actor: 'test' });
  assert.equal(r2.ok, false); assert.match(r2.error, /window is closed/);
  assert.equal(engine.getJob(held.id).status, 'queued');
  assert.equal(m.id, engine.getJob(held.id).mailboxId);
});
