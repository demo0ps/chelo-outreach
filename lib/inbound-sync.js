const crypto = require('node:crypto');
const tls = require('node:tls');

function verifyWebhookSignature(rawBody, signatureHeader, secret) {
  if (!secret || !signatureHeader) return false;
  const cleanSig = String(signatureHeader).trim().replace(/^sha256=/i, '');
  const expected = crypto.createHmac('sha256', String(secret)).update(String(rawBody || ''), 'utf8').digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(cleanSig, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Normalizes generic, Postmark, Resend, or SendGrid inbound/bounce webhook shapes.
function normalizeInboundEvent(payload = {}) {
  const rawType = String(payload.type || payload.RecordType || payload.event || '').toLowerCase();
  const email = String(
    payload.email
    || payload.Email
    || payload.from
    || payload.FromFull?.Email
    || (Array.isArray(payload.data?.to) ? payload.data.to[0] : payload.data?.email)
    || ''
  ).replace(/^.*<([^>]+)>.*$/, '$1').trim().toLowerCase();

  const subject = String(payload.subject || payload.Subject || payload.data?.subject || '').trim();
  const reason = String(payload.reason || payload.Description || payload.data?.bounce?.message || payload.diagnosticCode || '').trim();
  const providerMessageId = String(payload.messageId || payload.MessageID || payload.inReplyTo || payload.data?.email_id || '').trim();
  const text = String(payload.text || payload.TextBody || payload.StrippedTextReply || payload.data?.text || payload.body || '').slice(0, 6000);
  const headerSource = payload.headers || payload.Headers || payload.data?.headers || {};
  const headers = Array.isArray(headerSource) ? headerSource.map(h => `${h.Name || h.name || ''}: ${h.Value || h.value || ''}`).join('\n') : typeof headerSource === 'string' ? headerSource : Object.entries(headerSource).map(([k, v]) => `${k}: ${v}`).join('\n');

  if (/bounce|dropped| suppressed|failed/i.test(rawType) || payload.bounceType) {
    const subType = String(payload.bounceType || payload.Type || payload.data?.bounce?.type || 'hard').toLowerCase();
    const hard = !/soft|transient|defer/i.test(subType);
    return { kind: hard ? 'hard_bounce' : 'soft_bounce', email, subject, reason: reason || 'Delivery bounce reported by mail relay.', providerMessageId, text, headers };
  }
  if (/reply|inbound|received/i.test(rawType)) {
    return { kind: 'reply', email, subject, reason, providerMessageId, text, headers };
  }
  return { kind: 'unknown', email, subject, reason, providerMessageId, text, headers };
}

function applyInboundSignal({ db, configStore, addEmailEvent, addActivity, saveDb, normalized, source = 'webhook' }) {
  if (!normalized.email && !normalized.providerMessageId) {
    return { matched: false, message: 'No recipient email or message ID in inbound event.' };
  }
  let matchedMessage = null;
  if (normalized.providerMessageId) {
    matchedMessage = db.messages.find(m => m.providerMessageId && m.providerMessageId === normalized.providerMessageId);
  }
  const lead = matchedMessage
    ? db.leads.find(l => l.id === matchedMessage.leadId)
    : db.leads.find(l => String(l.email || '').trim().toLowerCase() === normalized.email);

  if (!lead) {
    return { matched: false, kind: normalized.kind, message: 'No matching pipeline prospect found for inbound event.' };
  }

  const initialMsg = db.messages.find(m => m.leadId === lead.id && m.kind === 'initial' && m.sentAt && ['Sent', 'Confirmed by staff'].includes(m.status));
  const now = new Date().toISOString();

  if (normalized.kind === 'hard_bounce') {
    lead.emailStatus = 'Bounced (hard)';
    lead.followUpEmailStatus = 'Stopped (hard bounce)';
    lead.followUpAt = null;
    lead.followUpStep = 0;
    lead.nextAction = 'Verify an updated point-of-contact email before further outreach';
    lead.contactCheck = {
      status: 'invalid',
      emailStatus: 'invalid',
      reason: `Hard bounce reported (${source}): ${normalized.reason || 'mailbox rejected delivery'}`.slice(0, 240),
      issues: ['Mailbox hard-bounced on delivery'],
      checkedAt: now
    };
    lead.updatedAt = now;
    addEmailEvent(lead.id, 'bounce', (matchedMessage || initialMsg)?.id || null, source);
    addActivity(`Hard bounce detected for ${lead.company}; follow-ups halted`, 'email', source);
    configStore.recordAudit({
      actor: source,
      action: 'email.hard_bounce',
      entityType: 'lead',
      entityId: lead.id,
      summary: `Hard bounce recorded for ${lead.company}; contact intake marked invalid and follow-ups cancelled`
    });
    saveDb();
    return { matched: true, leadId: lead.id, kind: 'hard_bounce', message: `Hard bounce recorded for ${lead.company}; follow-ups cancelled.` };
  }

  if (normalized.kind === 'soft_bounce') {
    lead.updatedAt = now;
    addEmailEvent(lead.id, 'bounce_soft', (matchedMessage || initialMsg)?.id || null, source);
    configStore.recordAudit({
      actor: source,
      action: 'email.soft_bounce',
      entityType: 'lead',
      entityId: lead.id,
      summary: `Transient/soft bounce reported for ${lead.company}`
    });
    saveDb();
    return { matched: true, leadId: lead.id, kind: 'soft_bounce', message: `Soft bounce logged for ${lead.company}.` };
  }

  if (normalized.kind === 'reply') {
    lead.replyAt = now;
    lead.followUpAt = null;
    lead.followUpStep = 0;
    lead.emailStatus = `Replied (${source})`;
    lead.nextAction = 'Review inbound reply and respond personally';
    if (lead.stage === 'Contacted') lead.stage = 'Interested';
    lead.updatedAt = now;
    addEmailEvent(lead.id, 'reply', initialMsg?.id || null, source);
    addActivity(`Inbound reply detected from ${lead.company}`, 'email', source);
    configStore.recordAudit({
      actor: source,
      action: 'email.inbound_reply',
      entityType: 'lead',
      entityId: lead.id,
      summary: `Inbound reply detected for ${lead.company}; scheduled follow-ups cancelled`
    });
    saveDb();
    return { matched: true, leadId: lead.id, kind: 'reply', message: `Reply recorded for ${lead.company}; scheduled follow-ups cancelled.` };
  }

  return { matched: false, kind: normalized.kind, message: 'Unhandled inbound event type.' };
}

// Lightweight zero-dependency TLS IMAP check for recent UNSEEN bounce/reply headers.
function checkImapInbox(imapConfig = {}) {
  return new Promise((resolve, reject) => {
    const host = String(imapConfig.host || '').trim();
    const port = Number(imapConfig.port || 993);
    const user = String(imapConfig.username || '').trim();
    const pass = String(imapConfig.password || '');
    if (!host || !user || !pass) return reject(new Error('Configure IMAP host, username and password in Settings first.'));

    const q = v => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    const socket = tls.connect({ host, port, servername: host, minVersion: 'TLSv1.2', timeout: 12000 });
    let buffer = '';
    let step = 0;
    const signals = [];
    const finish = (err, data) => {
      try { socket.end(); socket.destroy(); } catch {}
      if (err) reject(err);
      else resolve(data);
    };

    socket.setTimeout(12000, () => finish(new Error('IMAP connection timed out.')));
    socket.on('error', err => finish(new Error(`IMAP connection failed: ${err.message}`)));
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      if (step === 0 && /\* OK/i.test(buffer)) {
        step = 1; buffer = '';
        socket.write(`A1 LOGIN ${q(user)} ${q(pass)}\r\n`);
      } else if (step === 1 && /A1 (OK|NO|BAD)/i.test(buffer)) {
        if (!/A1 OK/i.test(buffer)) return finish(new Error('IMAP authentication failed. Check username or app password.'));
        step = 2; buffer = '';
        socket.write('A2 SELECT INBOX\r\n');
      } else if (step === 2 && /A2 (OK|NO|BAD)/i.test(buffer)) {
        if (!/A2 OK/i.test(buffer)) return finish(new Error('IMAP could not select INBOX.'));
        step = 3; buffer = '';
        socket.write('A3 SEARCH UNSEEN\r\n');
      } else if (step === 3 && /A3 (OK|NO|BAD)/i.test(buffer)) {
        const searchLine = buffer.match(/\* SEARCH([^\r\n]*)/i);
        const ids = (searchLine?.[1] || '').trim().split(/\s+/).filter(Boolean).slice(-25);
        if (!ids.length) {
          step = 5; buffer = '';
          socket.write('A5 LOGOUT\r\n');
          return finish(null, { checked: 0, signals: [] });
        }
        step = 4; buffer = '';
        socket.write(`A4 FETCH ${ids.join(',')} (BODY.PEEK[HEADER.FIELDS (FROM SUBJECT TO X-FAILED-RECIPIENTS AUTO-SUBMITTED PRECEDENCE X-AUTOREPLY X-AUTORESPOND X-AUTO-RESPONSE-SUPPRESS IN-REPLY-TO)])\r\n`);
      } else if (step === 4 && /A4 (OK|NO|BAD)/i.test(buffer)) {
        const blocks = buffer.split(/\*\s+\d+\s+FETCH/i).slice(1);
        for (const block of blocks) {
          const from = (block.match(/^From:\s*(.+)$/im)?.[1] || '').trim();
          const subject = (block.match(/^Subject:\s*(.+)$/im)?.[1] || '').trim();
          const failed = (block.match(/^X-Failed-Recipients:\s*(.+)$/im)?.[1] || '').trim();
          const fromEmail = from.replace(/^.*<([^>]+)>.*$/, '$1').trim().toLowerCase();
          if (/mailer-daemon|postmaster|mail delivery/i.test(from) || /undeliverable|delivery status notification|failure notice/i.test(subject)) {
            if (failed) signals.push({ kind: 'hard_bounce', email: failed.toLowerCase(), subject, reason: subject });
          } else if (fromEmail) {
            signals.push({ kind: 'reply', email: fromEmail, subject, reason: '', headers: block.replace(/^[^\n]*\n/, '').trim(), text: '' });
          }
        }
        step = 5; buffer = '';
        socket.write('A5 LOGOUT\r\n');
        return finish(null, { checked: blocks.length, signals });
      }
    });
  });
}

function buildFollowUpDigest(leads = [], now = new Date()) {
  const nowMs = now.getTime();
  const dueNow = [];
  const upcoming = [];
  for (const lead of leads) {
    if (!lead.followUpAt || lead.doNotContact || ['Won', 'Not proceeding'].includes(lead.stage)) continue;
    const dueMs = Date.parse(lead.followUpAt);
    if (!Number.isFinite(dueMs)) continue;
    const item = {
      leadId: lead.id,
      company: lead.company,
      contactName: lead.contactName,
      email: lead.email,
      owner: lead.owner || 'Unassigned',
      step: Number(lead.followUpStep || 1),
      followUpAt: lead.followUpAt,
      followUpEmailStatus: lead.followUpEmailStatus || 'Not drafted',
      overdueDays: Math.max(0, Math.floor((nowMs - dueMs) / 86400000))
    };
    if (dueMs <= nowMs) dueNow.push(item);
    else upcoming.push(item);
  }
  dueNow.sort((a, b) => Date.parse(a.followUpAt) - Date.parse(b.followUpAt));
  upcoming.sort((a, b) => Date.parse(a.followUpAt) - Date.parse(b.followUpAt));
  return { generatedAt: now.toISOString(), dueCount: dueNow.length, upcomingCount: upcoming.length, dueNow, upcoming };
}

module.exports = {
  verifyWebhookSignature,
  normalizeInboundEvent,
  applyInboundSignal,
  checkImapInbox,
  buildFollowUpDigest
};
