'use strict';
/**
 * Chelo Communication Center — shared inbox (Chatwoot-inspired, zero-dependency).
 *
 * Model
 *  - Inbox       = a sending mailbox from the send engine (one per staff mailbox: partnerships@, emmaculate@, …).
 *  - Member      = staff user attached to an inbox (root/full-access manage membership; they always see every inbox).
 *  - Conversation= one thread per lead per inbox. Opened automatically by a human reply (webhook/IMAP/staff-logged).
 *                  Status: open · pending (waiting on the funder) · snoozed (until a date) · resolved.
 *                  Assignee: lead owner if they are a member of the inbox, otherwise round-robin among members.
 *  - Message     = inbound reply, outbound reply (staff), or private note (@mentions notify teammates).
 *
 * Persistence: plain arrays on the shared `db` (conversations, conversationMessages, inboxMembers) — the SQLite store
 * mirrors them into their own tables and the Supabase snapshot carries the SQLite file, so nothing new to configure.
 */

const STATUSES = ['open', 'pending', 'snoozed', 'resolved'];
const UNROUTED = '';

function createInbox({ db, saveDb, configStore, sendEngine, id, addActivity, now = () => new Date(), leadGate = () => true }) {
  for (const key of ['conversations', 'conversationMessages', 'inboxMembers']) if (!Array.isArray(db[key])) db[key] = [];

  const iso = () => now().toISOString();
  const norm = v => String(v || '').trim().toLowerCase();

  // ---------- inboxes & members ----------
  function mailboxes() {
    return (sendEngine ? sendEngine.listMailboxes() : []).map(m => ({ id: m.id, label: m.label || m.fromEmail, fromEmail: m.fromEmail, status: m.status }));
  }
  function membersOf(mailboxId) { return db.inboxMembers.filter(m => m.mailboxId === mailboxId).sort((a, b) => String(a.addedAt).localeCompare(String(b.addedAt))); }
  function isMember(userId, mailboxId) { return db.inboxMembers.some(m => m.mailboxId === mailboxId && m.userId === userId); }
  function setMembers(mailboxId, userIds, { actor = 'staff' } = {}) {
    if (!mailboxes().some(m => m.id === mailboxId)) throw new Error('Mailbox not found.');
    const users = configStore.listUsers().filter(u => u.active);
    const wanted = [...new Set((userIds || []).map(String))].filter(uid => users.some(u => u.id === uid));
    const existing = membersOf(mailboxId);
    const keep = existing.filter(m => wanted.includes(m.userId));
    const added = wanted.filter(uid => !existing.some(m => m.userId === uid)).map(uid => ({ id: id('ixm'), mailboxId, userId: uid, addedAt: iso(), addedBy: actor }));
    db.inboxMembers = db.inboxMembers.filter(m => m.mailboxId !== mailboxId).concat(keep, added);
    saveDb();
    return membersOf(mailboxId).map(m => m.userId);
  }

  // Visibility: root / full-access see all; members see their inboxes; an inbox with no members is open to every staff member;
  // anyone always sees conversations assigned to them; unrouted conversations are visible to all.
  function canSee(session, conv) {
    if (!session) return false;
    if (!leadGate(session, conv)) return false; // a reply belongs to its funder: no funder access, no reply
    if (session.desk && !conv.leadId && conv.mailboxId) { const mb = mailboxes().find(m => m.id === conv.mailboxId); if (mb?.desk && mb.desk !== session.desk) return false; } // unrouted mail follows its inbox's desk
    if (session.isRoot || session.demoAccess) return true;
    if (conv.assigneeId && conv.assigneeId === session.userId) return true;
    if (!conv.mailboxId) return true;
    const members = membersOf(conv.mailboxId);
    if (!members.length) return true;
    return members.some(m => m.userId === session.userId);
  }
  function visibleMailboxIds(session) {
    return mailboxes().filter(m => (!session.desk || !m.desk || m.desk === session.desk) && (session.isRoot || session.demoAccess || !membersOf(m.id).length || isMember(session.userId, m.id))).map(m => m.id); // R1: desk-tagged inboxes show on their desk only
  }

  // ---------- assignment ----------
  function ownerUser(lead) {
    if (!lead) return null;
    const users = configStore.listUsers().filter(u => u.active);
    if (lead.ownerId) { const u = users.find(x => x.id === lead.ownerId); if (u) return u; }
    const owner = norm(lead.owner);
    if (!owner) return null;
    return users.find(u => norm(u.displayName) === owner || norm(u.username) === owner || norm(u.displayName).startsWith(owner)) || null;
  }
  function pickAssignee(lead, mailboxId) {
    const members = membersOf(mailboxId);
    const owner = ownerUser(lead);
    if (owner && (!mailboxId || !members.length || members.some(m => m.userId === owner.id))) return owner.id;
    if (!members.length) return null;
    // Round-robin: continue after the most recently assigned member of this inbox.
    const recent = db.conversations.filter(c => c.mailboxId === mailboxId && c.assigneeId && c.assignedAt).sort((a, b) => String(b.assignedAt).localeCompare(String(a.assignedAt)))[0];
    const lastIdx = recent ? members.findIndex(m => m.userId === recent.assigneeId) : -1;
    return members[(lastIdx + 1) % members.length].userId;
  }

  // ---------- conversations ----------
  function findOpenForLead(leadId, mailboxId) {
    return db.conversations.find(c => c.leadId === leadId && (mailboxId ? c.mailboxId === mailboxId : true) && c.status !== 'resolved')
      || db.conversations.filter(c => c.leadId === leadId).sort((a, b) => String(b.lastActivityAt).localeCompare(String(a.lastActivityAt)))[0] || null;
  }
  function routeMailboxFor(lead, hint = '') {
    if (hint && mailboxes().some(m => m.id === hint)) return hint;
    const sent = (db.messages || []).filter(m => m.leadId === lead.id && m.mailboxId).sort((a, b) => String(b.sentAt).localeCompare(String(a.sentAt)))[0];
    if (sent && mailboxes().some(m => m.id === sent.mailboxId)) return sent.mailboxId;
    const active = mailboxes().filter(m => m.status === 'active');
    return active.length === 1 ? active[0].id : UNROUTED;
  }
  /** Open (or reopen) the conversation for a human reply and append the inbound message. */
  function recordInbound(lead, { subject = '', text = '', fromEmail = '', fromName = '', source = 'inbound', mailboxId = '', category = '', receivedAt = null } = {}) {
    const at = receivedAt || iso();
    const mbox = routeMailboxFor(lead, mailboxId);
    let conv = findOpenForLead(lead.id, mbox);
    if (!conv) {
      conv = { id: id('conv'), leadId: lead.id, mailboxId: mbox, company: lead.company, contactName: lead.contactName || '', contactEmail: lead.email || '', subject: subject || `Re: ${lead.company}`,
        status: 'open', assigneeId: null, assignedAt: null, snoozedUntil: null, createdAt: at, lastActivityAt: at, lastInboundAt: at, lastSeen: {}, statusChangedAt: at, triageCategory: category || '' };
      conv.assigneeId = pickAssignee(lead, mbox); if (conv.assigneeId) { conv.assignedAt = at; conv.assignedBy = 'auto'; }
      db.conversations.unshift(conv);
    } else {
      if (conv.status === 'resolved' || conv.status === 'snoozed' || conv.status === 'pending') { conv.status = 'open'; conv.statusChangedAt = at; conv.snoozedUntil = null; }
      if (subject && !conv.subject) conv.subject = subject;
      if (!conv.assigneeId) { conv.assigneeId = pickAssignee(lead, mbox); if (conv.assigneeId) { conv.assignedAt = at; conv.assignedBy = 'auto'; } }
      if (category) conv.triageCategory = category;
    }
    conv.lastActivityAt = at; conv.lastInboundAt = at; conv.lastSeen = {}; conv.waitingSince = at;
    const msg = { id: id('cmsg'), conversationId: conv.id, kind: 'inbound', author: fromName || lead.contactName || fromEmail || 'Funder', authorEmail: fromEmail || lead.email || '', subject: subject || '', text: String(text || '').slice(0, 20000), source, createdAt: at };
    db.conversationMessages.push(msg);
    saveDb();
    return { conversation: conv, message: msg };
  }

  function get(convId) { return db.conversations.find(c => c.id === convId) || null; }
  function touch(conv) { conv.lastActivityAt = iso(); }
  function markSeen(conv, userId) { if (!conv.lastSeen) conv.lastSeen = {}; conv.lastSeen[userId] = iso(); saveDb(); }
  function isUnreadFor(conv, userId) {
    if (!conv.lastInboundAt) return false;
    const seen = conv.lastSeen && conv.lastSeen[userId];
    return !seen || String(seen) < String(conv.lastInboundAt);
  }
  function setStatus(conv, status, { snoozedUntil = null, actor = 'staff', actorId = null } = {}) {
    if (!STATUSES.includes(status)) throw new Error('Status must be open, pending, snoozed or resolved.');
    const at = iso();
    if (status === 'snoozed') {
      const until = snoozedUntil ? new Date(snoozedUntil) : null;
      if (!until || Number.isNaN(until.getTime()) || until <= now()) throw new Error('Choose a future date to snooze until.');
      conv.snoozedUntil = until.toISOString();
    } else conv.snoozedUntil = null;
    conv.status = status; conv.statusChangedAt = at; conv.statusChangedBy = actor; touch(conv);
    if (status === 'resolved') conv.resolvedAt = at;
    db.conversationMessages.push({ id: id('cmsg'), conversationId: conv.id, kind: 'event', author: actor, authorId: actorId, text: status === 'snoozed' ? `Snoozed until ${conv.snoozedUntil.slice(0, 10)}` : `Marked ${status}`, createdAt: at });
    saveDb();
    return conv;
  }
  function assign(conv, userId, { actor = 'staff', actorId = null } = {}) {
    const at = iso();
    if (userId) { const u = configStore.listUsers().find(x => x.id === userId && x.active); if (!u) throw new Error('Staff account not found.'); }
    conv.assigneeId = userId || null; conv.assignedAt = userId ? at : null; conv.assignedBy = actor; touch(conv);
    const name = userId ? (configStore.listUsers().find(x => x.id === userId)?.displayName || 'teammate') : null;
    db.conversationMessages.push({ id: id('cmsg'), conversationId: conv.id, kind: 'event', author: actor, authorId: actorId, text: userId ? `Assigned to ${name}` : 'Unassigned', createdAt: at });
    saveDb();
    return conv;
  }
  /** Private note; @Display Name or @username mentions are resolved against active staff. */
  function addNote(conv, text, { actor = 'staff', actorId = null } = {}) {
    const clean = String(text || '').trim().slice(0, 5000);
    if (!clean) throw new Error('Write a note first.');
    const users = configStore.listUsers().filter(u => u.active);
    const mentions = [];
    for (const u of users) {
      const forms = [u.displayName, u.username, u.username.split('@')[0]].filter(Boolean);
      if (forms.some(f => new RegExp(`(^|\\s)@${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[\\s,.;:!?)])`, 'i').test(clean)) && u.id !== actorId) mentions.push(u.id);
    }
    const msg = { id: id('cmsg'), conversationId: conv.id, kind: 'note', author: actor, authorId: actorId, text: clean, mentions: [...new Set(mentions)], createdAt: iso(), seenBy: actorId ? [actorId] : [] };
    db.conversationMessages.push(msg); touch(conv); saveDb();
    return msg;
  }
  /** Outbound reply drafted by staff. Single-approver policy → queued immediately; four-eyes → waits for a second signer. */
  function draftReply(conv, lead, { text, subject = '', actor, actorId, origin = '' }) {
    const clean = String(text || '').trim().slice(0, 20000);
    if (!clean) throw new Error('Write a reply first.');
    if (!lead || !lead.email) throw new Error('This prospect has no email address.');
    if (lead.doNotContact) throw new Error('This contact opted out — replies are blocked.');
    const policy = configStore.getGovernanceConfig().approvalPolicy;
    const msg = { id: id('cmsg'), conversationId: conv.id, kind: 'outbound', author: actor, authorId: actorId, subject: subject || (conv.subject && /^re:/i.test(conv.subject) ? conv.subject : `Re: ${conv.subject || lead.company}`), text: clean, status: policy === 'four-eyes' ? 'awaiting-countersign' : 'queued', firstApprover: actor, firstApproverId: actorId, createdAt: iso() };
    db.conversationMessages.push(msg); touch(conv);
    if (msg.status === 'queued') sendReply(conv, lead, msg, { origin });
    conv.status = conv.status === 'resolved' ? 'pending' : 'pending'; conv.statusChangedAt = iso(); conv.waitingSince = null;
    saveDb();
    return msg;
  }
  function countersignReply(conv, lead, msgId, { actor, actorId, origin = '' }) {
    const msg = db.conversationMessages.find(m => m.id === msgId && m.conversationId === conv.id && m.kind === 'outbound');
    if (!msg) throw new Error('Reply not found.');
    if (msg.status !== 'awaiting-countersign') throw new Error('This reply does not need a countersignature.');
    if (msg.firstApproverId && msg.firstApproverId === actorId) throw new Error('Four-eyes: a different staff member must countersign this reply.');
    msg.secondApprover = actor; msg.secondApproverId = actorId; msg.status = 'queued';
    sendReply(conv, lead, msg, { origin }); touch(conv); saveDb();
    return msg;
  }
  function sendReply(conv, lead, msg, { origin = '' } = {}) {
    const threadId = lead.sequence?.threadMessageId || (db.messages || []).filter(m => m.leadId === lead.id && m.providerMessageId).sort((a, b) => String(b.sentAt).localeCompare(String(a.sentAt)))[0]?.providerMessageId || null;
    const headers = { 'X-Chelo-Lead': lead.id, 'X-Chelo-Conversation': conv.id };
    if (origin && lead.bookingToken) { headers['List-Unsubscribe'] = `<${origin}/opt-out/${encodeURIComponent(lead.bookingToken)}>`; headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'; }
    if (threadId) { headers['In-Reply-To'] = threadId; headers.References = threadId; }
    try {
      const job = sendEngine.enqueue({ leadId: lead.id, kind: 'reply', to: lead.email, subject: msg.subject, text: msg.text, html: `<pre style="font:inherit;white-space:pre-wrap">${msg.text.replace(/[<>&]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[ch])}</pre>`, headers, mailboxId: conv.mailboxId || '', requestedBy: msg.secondApprover || msg.firstApprover || 'staff', sendAt: iso(), meta: { conversationId: conv.id, replyMessageId: msg.id, actor: msg.firstApprover, company: lead.company } });
      msg.jobId = job.id; msg.mailboxId = job.mailboxId; msg.scheduledFor = job.scheduledAt;
      lead.lastRepliedByStaffAt = iso();
      if (addActivity) addActivity(`Reply to ${lead.company} queued from the inbox`, 'email', msg.secondApprover || msg.firstApprover);
    } catch (err) { msg.status = 'failed'; msg.error = String(err.message || err).slice(0, 240); }
  }
  function markReplySent(jobId, { providerMessageId = null, at = null } = {}) {
    const msg = db.conversationMessages.find(m => m.jobId === jobId && m.kind === 'outbound');
    if (!msg) return null;
    msg.status = 'sent'; msg.sentAt = at || iso(); if (providerMessageId) msg.providerMessageId = providerMessageId;
    const conv = get(msg.conversationId); if (conv) touch(conv);
    saveDb();
    return msg;
  }
  function markReplyFailed(jobId, error) {
    const msg = db.conversationMessages.find(m => m.jobId === jobId && m.kind === 'outbound');
    if (!msg) return null;
    msg.status = 'failed'; msg.error = String(error || 'send failed').slice(0, 240); saveDb();
    return msg;
  }

  // Snoozes expire lazily on read.
  function wake() {
    const t = iso(); let changed = false;
    for (const c of db.conversations) if (c.status === 'snoozed' && c.snoozedUntil && c.snoozedUntil <= t) { c.status = 'open'; c.snoozedUntil = null; c.statusChangedAt = t; c.lastActivityAt = t; changed = true; }
    if (changed) saveDb();
  }

  // ---------- read models ----------
  function messagesFor(conv) { return db.conversationMessages.filter(m => m.conversationId === conv.id).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))); }
  function preview(conv) {
    const last = messagesFor(conv).filter(m => m.kind !== 'event').slice(-1)[0];
    return last ? { kind: last.kind, text: String(last.text || '').replace(/\s+/g, ' ').slice(0, 140), at: last.createdAt, author: last.author } : null;
  }
  function summary(conv, session) {
    return { ...conv, unread: isUnreadFor(conv, session.userId), preview: preview(conv), pendingCountersign: db.conversationMessages.some(m => m.conversationId === conv.id && m.kind === 'outbound' && m.status === 'awaiting-countersign') };
  }
  function overview(session) {
    wake();
    const visible = db.conversations.filter(c => canSee(session, c));
    const conversations = visible.map(c => summary(c, session)).sort((a, b) => String(b.lastActivityAt).localeCompare(String(a.lastActivityAt)));
    const boxes = mailboxes().filter(m => visibleMailboxIds(session).includes(m.id)).map(m => ({ ...m, members: membersOf(m.id).map(x => x.userId), open: conversations.filter(c => c.mailboxId === m.id && c.status === 'open').length, unread: conversations.filter(c => c.mailboxId === m.id && c.unread && c.status !== 'resolved').length }));
    const unrouted = conversations.filter(c => !c.mailboxId);
    const mine = conversations.filter(c => c.assigneeId === session.userId && c.status !== 'resolved');
    const mentions = db.conversationMessages.filter(m => m.kind === 'note' && (m.mentions || []).includes(session.userId) && !(m.seenBy || []).includes(session.userId)).map(m => ({ id: m.id, conversationId: m.conversationId, author: m.author, text: m.text.slice(0, 160), createdAt: m.createdAt }));
    return {
      mailboxes: boxes,
      unrouted: { open: unrouted.filter(c => c.status === 'open').length, unread: unrouted.filter(c => c.unread && c.status !== 'resolved').length },
      folders: { mine: mine.length, mineUnread: mine.filter(c => c.unread).length, unassigned: conversations.filter(c => !c.assigneeId && c.status !== 'resolved').length, all: conversations.filter(c => c.status !== 'resolved').length },
      statuses: STATUSES.reduce((acc, s) => { acc[s] = conversations.filter(c => c.status === s).length; return acc; }, {}),
      conversations, mentions
    };
  }
  function thread(conv, session) {
    const sent = (db.messages || []).filter(m => m.leadId === conv.leadId && m.sentAt && ['Sent', 'Confirmed by staff', 'Sent (demo)'].includes(m.status)).map(m => ({ id: m.id, kind: 'sent', author: m.fromName || m.mailboxLabel || 'Chelo', subject: m.subject, text: m.body || m.text || '', createdAt: m.sentAt, sequenceStep: m.sequenceStep || null }));
    const own = messagesFor(conv).map(m => (m.kind === 'note' ? { ...m, seenBy: undefined, mentionedMe: (m.mentions || []).includes(session.userId) } : m));
    for (const m of messagesFor(conv)) if (m.kind === 'note' && (m.mentions || []).includes(session.userId) && !(m.seenBy || []).includes(session.userId)) { m.seenBy = [...(m.seenBy || []), session.userId]; }
    return [...sent, ...own].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  /** One-time/bootstrap: give every unhandled reply that predates the inbox a conversation. */
  // Mirror a triage decision onto the lead's conversation so the Inbox and the lead never disagree.
  // opt-out → resolved · not-now → snoozed until the resume date · wrong-person / interested → event note, stays open.
  function onTriage(lead, outcome, { actor = 'staff', actorId = null } = {}) {
    const conv = findOpenForLead(lead.id);
    if (!conv) return null;
    const category = outcome?.category || 'unclassified';
    const note = text => db.conversationMessages.push({ id: id('cmsg'), conversationId: conv.id, kind: 'event', author: actor, authorId: actorId, text, createdAt: iso() });
    if (category === 'opt-out' || category === 'automatic') { note(category === 'opt-out' ? `Triaged as opt-out by ${actor} — contact suppressed workspace-wide.` : `Marked as an automatic reply by ${actor}.`); if (conv.status !== 'resolved') setStatus(conv, 'resolved', { actor, actorId }); return conv; }
    if (category === 'not-now' && outcome.resumeOn) {
      const until = new Date(`${outcome.resumeOn}T07:00:00.000Z`);
      note(`Triaged as not now by ${actor} — resurfaces ${outcome.resumeOn}.`);
      if (until > now()) { try { setStatus(conv, 'snoozed', { snoozedUntil: until.toISOString(), actor, actorId }); return conv; } catch { /* fall through */ } }
      if (conv.status !== 'resolved') setStatus(conv, 'resolved', { actor, actorId });
      return conv;
    }
    if (category === 'wrong-person') note(`Triaged as wrong person by ${actor}${outcome.redirect?.name ? ` — redirected to ${outcome.redirect.name}` : ''}; candidate contact captured.`);
    else if (category === 'interested') note(`Triaged as interested by ${actor} — booking step is next.`);
    else note(`Triaged as ${category} by ${actor}.`);
    touch(conv); saveDb();
    return conv;
  }
  function backfill() {
    let created = 0;
    for (const lead of db.leads) {
      if (!lead.triage || db.conversations.some(c => c.leadId === lead.id)) continue;
      recordInbound(lead, { subject: lead.triage.subject || '', text: lead.triage.excerpt || '', source: lead.triage.source || 'inbound', category: lead.triage.category || '', receivedAt: lead.triage.receivedAt || lead.replyAt || lead.updatedAt || null });
      const conv = db.conversations.find(c => c.leadId === lead.id);
      if (conv && lead.triage.handled) { conv.status = 'resolved'; conv.resolvedAt = lead.triage.handledAt || conv.lastActivityAt; }
      created++;
    }
    if (created) saveDb();
    return created;
  }

  return { STATUSES, onTriage, mailboxes, membersOf, setMembers, isMember, canSee, pickAssignee, recordInbound, get, markSeen, setStatus, assign, addNote, draftReply, countersignReply, markReplySent, markReplyFailed, overview, thread, backfill, wake, messagesFor };
}

module.exports = { createInbox, STATUSES };
