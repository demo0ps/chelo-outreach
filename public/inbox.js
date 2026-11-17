/* Chelo Communication Center — shared Inbox (desktop three-pane + phone two-pane).
 * Folders: per mailbox (unread badges) · Mine · Unassigned · All. Statuses: open · pending · snoozed · resolved.
 * Thread = sent outreach + inbound replies + staff replies + private notes (@mentions). Lead panel on the right. */
(function () {
  const IX = state.ix = { data: null, loading: false, mode: 'conversations', folder: 'mine', status: 'open', q: '', convId: null, thread: null, threadLoading: false, composer: 'reply', members: null, error: '' };
  const S = { open: ['Open', 'pill-interested'], pending: ['Pending', 'pill-researched'], snoozed: ['Snoozed', 'pill-contacted'], resolved: ['Resolved', 'pill-won'] };
  const when = iso => { if (!iso) return ''; const d = new Date(iso); const days = Math.floor((Date.now() - d) / 86400000); if (days <= 0) return d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }); if (days === 1) return 'yesterday'; if (days < 7) return `${days}d`; return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }); };
  const staffName = uid => (IX.data?.staff || []).find(u => u.id === uid)?.displayName || (uid ? 'Teammate' : 'Unassigned');
  const initials = name => String(name || '?').split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();

  async function load({ silent = false } = {}) {
    if (!silent) { IX.loading = true; renderApp(); }
    try { IX.data = await API('/api/inbox'); IX.error = ''; }
    catch (err) { IX.error = err.message || 'Could not load the inbox.'; }
    IX.loading = false;
    if (IX.convId && !IX.data?.conversations.some(c => c.id === IX.convId)) { IX.convId = null; IX.thread = null; }
    renderApp();
  }
  async function openConv(id) {
    IX.convId = id; IX.threadLoading = true; IX.thread = null; renderApp();
    try { IX.thread = await API(`/api/inbox/conversations/${encodeURIComponent(id)}`); } catch (err) { toast(err.message, true); IX.convId = null; }
    IX.threadLoading = false;
    const c = IX.data?.conversations.find(x => x.id === id); if (c) c.unread = false;
    renderApp();
  }
  window.inboxUnreadCount = () => IX.data ? (IX.data.folders.mineUnread + (IX.data.mentions || []).length) : 0;
  window.inboxLoad = load;

  function filtered() {
    const d = IX.data; if (!d) return [];
    let list = d.conversations;
    if (IX.folder === 'mine') list = list.filter(c => c.assigneeId === d.me);
    else if (IX.folder === 'unassigned') list = list.filter(c => !c.assigneeId);
    else if (IX.folder.startsWith('box:')) list = list.filter(c => c.mailboxId === IX.folder.slice(4));
    else if (IX.folder === 'unrouted') list = list.filter(c => !c.mailboxId);
    if (IX.status !== 'all') list = list.filter(c => c.status === IX.status);
    const q = IX.q.trim().toLowerCase();
    if (q) list = list.filter(c => [c.company, c.contactName, c.subject, c.preview?.text].join(' ').toLowerCase().includes(q));
    return list;
  }

  // ---- panes ----
  function folderPane() {
    const d = IX.data;
    const item = (key, label, icon, count, unread) => `<button type="button" class="ix-folder ${IX.folder === key ? 'is-active' : ''}" data-action="ix-folder" data-folder="${esc(key)}"><span class="ix-folder-icon">${svgIcon(icon)}</span><span class="ix-folder-label">${esc(label)}</span>${unread ? `<span class="ix-badge">${unread}</span>` : count ? `<span class="ix-count">${count}</span>` : ''}</button>`;
    const boxes = d.mailboxes.map(m => item(`box:${m.id}`, m.label || m.fromEmail, 'mail', m.open, m.unread)).join('');
    return `<aside class="ix-folders">
      <div class="ix-folders-head"><h2>Inbox</h2><button type="button" class="icon-button" data-action="ix-refresh" title="Refresh">${svgIcon('refresh')}</button></div>
      <div class="ix-folder-group"><div class="ix-folder-caption">Conversations</div>
        ${item('mine', 'Mine', 'users', d.folders.mine, d.folders.mineUnread)}
        ${item('unassigned', 'Unassigned', 'bell', d.folders.unassigned, 0)}
        ${item('all', 'All', 'grid', d.folders.all, 0)}
      </div>
      <div class="ix-folder-group"><div class="ix-folder-caption">Inboxes ${d.canManageMembers ? `<button type="button" class="ix-manage" data-action="ix-members-open">${svgIcon('settings')} Members</button>` : ''}</div>
        ${boxes || `<p class="subtle ix-empty-note">No mailboxes yet. ${d.canManageMembers ? 'Add staff mailboxes under Deliverability.' : 'Ask the root account to add mailboxes.'}</p>`}
        ${d.unrouted.open || d.unrouted.unread ? item('unrouted', 'Unrouted', 'info', d.unrouted.open, d.unrouted.unread) : ''}
      </div>
      ${(d.mentions || []).length ? `<div class="ix-folder-group"><div class="ix-folder-caption">Mentions</div>${d.mentions.slice(0, 5).map(m => `<button type="button" class="ix-mention" data-action="ix-open" data-id="${esc(m.conversationId)}"><strong>${esc(m.author)}</strong> ${esc(m.text.slice(0, 70))}</button>`).join('')}</div>` : ''}
    </aside>`;
  }
  function listPane() {
    const list = filtered();
    const tabs = [['open', 'Open'], ['pending', 'Pending'], ['snoozed', 'Snoozed'], ['resolved', 'Resolved'], ['all', 'All']].map(([k, l]) => `<button type="button" class="ix-tab ${IX.status === k ? 'is-active' : ''}" data-action="ix-status-filter" data-status="${k}">${l}${k !== 'all' && IX.data.statuses[k] ? ` <span>${IX.data.statuses[k]}</span>` : ''}</button>`).join('');
    const rows = list.map(c => {
      const box = IX.data.mailboxes.find(m => m.id === c.mailboxId);
      return `<button type="button" class="ix-row ${c.id === IX.convId ? 'is-active' : ''} ${c.unread ? 'is-unread' : ''}" data-action="ix-open" data-id="${esc(c.id)}">
        <span class="ix-avatar">${esc(initials(c.contactName || c.company))}</span>
        <span class="ix-row-main"><span class="ix-row-top"><strong>${esc(c.company)}</strong><time>${esc(when(c.lastActivityAt))}</time></span>
          <span class="ix-row-sub">${esc(c.contactName || c.contactEmail || '')}${c.subject ? ` · ${esc(c.subject)}` : ''}</span>
          <span class="ix-row-preview">${c.preview ? `${c.preview.kind === 'note' ? '📝 ' : c.preview.kind === 'outbound' ? '↩ ' : ''}${esc(c.preview.text)}` : ''}</span>
          <span class="ix-row-meta">${box ? `<span class="ix-chip">${esc(box.label || box.fromEmail)}</span>` : '<span class="ix-chip">Unrouted</span>'}${c.assigneeId ? `<span class="ix-chip ix-chip-person">${esc(staffName(c.assigneeId))}</span>` : '<span class="ix-chip ix-chip-warn">Unassigned</span>'}${c.pendingCountersign ? '<span class="ix-chip ix-chip-warn">Needs countersign</span>' : ''}${c.triageCategory && c.triageCategory !== 'unclassified' ? `<span class="ix-chip">${esc(typeof wbTriageLabel === 'function' ? wbTriageLabel(c.triageCategory) : c.triageCategory)}</span>` : ''}</span>
        </span></button>`;
    }).join('');
    return `<section class="ix-list">
      <div class="ix-list-head"><label class="input-search">${svgIcon('search')}<input id="ix-search" type="search" value="${esc(IX.q)}" placeholder="Search company, contact, subject…" /></label></div>
      <div class="ix-tabs">${tabs}</div>
      <div class="ix-rows">${rows || `<div class="ix-empty">${svgIcon('mail')}<p>${IX.status === 'open' ? 'No open conversations here. Replies from funders land in this list the moment they arrive.' : 'Nothing in this view.'}</p></div>`}</div>
    </section>`;
  }
  function threadPane() {
    if (!IX.convId) return `<section class="ix-thread ix-thread-empty"><div class="ix-empty">${svgIcon('reply')}<h3>Select a conversation</h3><p>Every funder reply is one thread: what we sent, what they answered, our replies, and private team notes.</p></div></section>`;
    if (IX.threadLoading || !IX.thread) return `<section class="ix-thread"><div class="ix-empty"><p>Loading conversation…</p></div></section>`;
    const { conversation: c, messages, lead } = IX.thread;
    const me = IX.data.me;
    const [sLabel, sPill] = S[c.status] || S.open;
    const assignOpts = `<option value="">Unassigned</option>${IX.data.staff.map(u => `<option value="${esc(u.id)}" ${c.assigneeId === u.id ? 'selected' : ''}>${esc(u.displayName)}</option>`).join('')}`;
    const bubble = m => {
      if (m.kind === 'event') return `<div class="ix-event">${esc(m.text)} · <span>${esc(m.author || '')}</span> · ${esc(when(m.createdAt))}</div>`;
      const cls = m.kind === 'inbound' ? 'is-inbound' : m.kind === 'note' ? 'is-note' : 'is-outbound';
      const status = m.kind === 'outbound' ? `<span class="ix-msg-status ${m.status === 'failed' ? 'is-bad' : ''}">${m.status === 'awaiting-countersign' ? 'awaiting countersignature' : m.status === 'queued' ? 'queued to send' : m.status === 'sent' ? 'sent' : m.status === 'failed' ? `failed — ${esc(m.error || '')}` : esc(m.status || '')}</span>` : m.kind === 'sent' ? `<span class="ix-msg-status">sent${m.sequenceStep ? ` · step ${m.sequenceStep}` : ''}</span>` : '';
      const countersign = m.kind === 'outbound' && m.status === 'awaiting-countersign' && m.firstApproverId !== me ? `<button type="button" class="button button-primary button-small" data-action="ix-countersign" data-id="${esc(m.id)}">${svgIcon('shield')} Countersign & send</button>` : m.kind === 'outbound' && m.status === 'awaiting-countersign' ? '<span class="subtle">A different teammate must countersign (4-eyes).</span>' : '';
      return `<article class="ix-msg ${cls} ${m.mentionedMe ? 'is-mentioned' : ''}"><header><span class="ix-avatar ix-avatar-sm">${esc(initials(m.author))}</span><strong>${esc(m.author || '')}</strong>${m.kind === 'note' ? '<span class="ix-chip ix-chip-note">Private note</span>' : ''}${m.subject && m.kind !== 'note' ? `<span class="ix-msg-subject">${esc(m.subject)}</span>` : ''}<time>${esc(new Date(m.createdAt).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }))}</time></header><div class="ix-msg-body">${esc(m.text || '').replace(/\n/g, '<br>')}</div>${status || countersign ? `<footer>${status}${countersign}</footer>` : ''}</article>`;
    };
    const canReply = lead && !lead.doNotContact && lead.email;
    const composer = `<div class="ix-composer">
      <div class="ix-composer-tabs"><button type="button" class="ix-tab ${IX.composer === 'reply' ? 'is-active' : ''}" data-action="ix-composer" data-mode="reply">${svgIcon('reply')} Reply</button><button type="button" class="ix-tab ${IX.composer === 'note' ? 'is-active' : ''}" data-action="ix-composer" data-mode="note">${svgIcon('edit')} Private note</button></div>
      ${IX.composer === 'reply'
        ? (canReply ? `<textarea id="ix-reply" class="form-control" rows="5" placeholder="Reply to ${esc(c.contactName || c.company)} from ${esc(IX.data.mailboxes.find(m => m.id === c.mailboxId)?.fromEmail || 'the inbox mailbox')}…"></textarea><div class="ix-composer-actions"><span class="subtle">${IX.data.approvalPolicy === 'four-eyes' ? 'Strict 4-eyes: a teammate countersigns before it sends.' : 'Sends from the conversation’s mailbox, in-thread.'}</span><button type="button" class="button button-primary" data-action="ix-send-reply">${svgIcon('send')} ${IX.data.approvalPolicy === 'four-eyes' ? 'Submit for countersign' : 'Send reply'}</button></div>` : `<p class="subtle">${lead?.doNotContact ? 'This contact opted out — replies are blocked.' : 'No email address on this prospect.'}</p>`)
        : `<textarea id="ix-note" class="form-control" rows="4" placeholder="Visible to the team only. Mention a teammate with @Name — e.g. @${esc(IX.data.staff.find(u => u.id !== me)?.displayName || 'Thandi')}"></textarea><div class="ix-composer-actions"><span class="subtle">Notes never leave the workspace.</span><button type="button" class="button button-secondary" data-action="ix-add-note">${svgIcon('edit')} Add note</button></div>`}
    </div>`;
    const snooze = c.status === 'snoozed' && c.snoozedUntil ? ` until ${new Date(c.snoozedUntil).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}` : '';
    return `<section class="ix-thread">
      <header class="ix-thread-head">
        <div><h2>${esc(c.company)}</h2><p class="subtle">${esc(c.contactName || '')}${c.contactEmail ? ` · ${esc(c.contactEmail)}` : ''} · <span class="stage-pill ${sPill}">${sLabel}${esc(snooze)}</span></p></div>
        <div class="ix-thread-actions">
          <label class="ix-assign">${svgIcon('users')}<select id="ix-assignee" data-action-change="ix-assign">${assignOpts}</select></label>
          ${c.status !== 'open' ? `<button type="button" class="button button-secondary button-small" data-action="ix-status" data-status="open">${svgIcon('play')} Reopen</button>` : ''}
          ${c.status !== 'pending' ? `<button type="button" class="button button-secondary button-small" data-action="ix-status" data-status="pending" title="Waiting on the funder">${svgIcon('clock')} Pending</button>` : ''}
          ${c.status !== 'snoozed' ? `<button type="button" class="button button-secondary button-small" data-action="ix-snooze">${svgIcon('bell')} Snooze</button>` : ''}
          ${c.status !== 'resolved' ? `<button type="button" class="button button-primary button-small" data-action="ix-status" data-status="resolved">${svgIcon('check')} Resolve</button>` : ''}
        </div>
      </header>
      <div class="ix-messages" id="ix-messages">${messages.map(bubble).join('') || '<div class="ix-empty"><p>No messages yet.</p></div>'}</div>
      ${composer}
    </section>`;
  }
  function leadPane() {
    if (!IX.convId || !IX.thread?.lead) return '<aside class="ix-lead"></aside>';
    const l = IX.thread.lead; const c = IX.thread.conversation;
    const t = l.triage;
    const triage = t && !t.handled ? `<div class="ix-lead-block"><h4>Triage this reply</h4><p class="subtle">Classification: <strong>${esc(typeof wbTriageLabel === 'function' ? wbTriageLabel(t.category) : t.category)}</strong> (${esc(t.confidence || 'low')} confidence)${t.dueAt ? ` · respond by ${new Date(t.dueAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}` : ''}</p>
      <div class="ix-triage">${['interested', 'not-now', 'wrong-person', 'opt-out'].map(cat => `<button type="button" class="button ${cat === t.category ? 'button-primary' : 'button-secondary'} button-small" data-action="ix-triage" data-category="${cat}">${esc(typeof wbTriageLabel === 'function' ? wbTriageLabel(cat) : cat)}</button>`).join('')}</div>
      <input id="ix-triage-extra" class="form-control" placeholder="Wrong person → their name · Not now → resume date YYYY-MM-DD" /></div>` : t ? `<div class="ix-lead-block"><h4>Triage</h4><p class="subtle">Handled as <strong>${esc(typeof wbTriageLabel === 'function' ? wbTriageLabel(t.category) : t.category)}</strong> by ${esc(t.handledBy || 'staff')}</p></div>` : '';
    const project = (state.data.projects || []).find(p => p.id === l.projectId);
    return `<aside class="ix-lead">
      <div class="ix-lead-block"><div class="ix-lead-head"><span class="ix-avatar ix-avatar-lg">${esc(initials(l.contactName || l.company))}</span><div><h3>${esc(l.contactName || '—')}</h3><p class="subtle">${esc(l.title || '')}${l.title && l.company ? ' · ' : ''}${esc(l.company)}</p></div></div>
        <dl class="ix-dl">${[['Email', l.email], ['Phone', l.phone], ['Sector', l.sector], ['Province', l.province], ['Stage', l.stage], ['Owner', l.owner], ['Fit', l.fit?.score != null ? `${l.fit.score}/100` : ''], ['Project', project?.name], ['Next action', l.nextAction]].filter(([, v]) => v).map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
        <div class="ix-lead-actions"><button type="button" class="button button-secondary button-small" data-open-lead="${esc(l.id)}">${svgIcon('external')} Open prospect</button><button type="button" class="button button-secondary button-small" data-action="ix-goto-workbench" data-id="${esc(l.id)}">${svgIcon('wand')} Workbench</button></div>
      </div>
      ${triage}
      <div class="ix-lead-block"><h4>Conversation</h4><dl class="ix-dl">${[['Inbox', IX.data.mailboxes.find(m => m.id === c.mailboxId)?.label || 'Unrouted'], ['Assignee', staffName(c.assigneeId)], ['Opened', new Date(c.createdAt).toLocaleDateString('en-ZA', { dateStyle: 'medium' })], ['Last activity', new Date(c.lastActivityAt).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })]].map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></div>
    </aside>`;
  }
  function membersModal() {
    const d = IX.data; if (!d || !IX.members) return '';
    return `<div class="modal ix-members-modal"><div class="modal-head"><h2>${svgIcon('users')} Inbox members</h2><button type="button" class="icon-button" data-action="ix-members-close">${svgIcon('close')}</button></div>
      <p class="subtle">Members see and are assigned that inbox’s conversations. An inbox with no members is visible to everyone. Root and full-access accounts always see every inbox.</p>
      ${d.mailboxes.map(m => `<div class="ix-members-row"><div><strong>${esc(m.label || m.fromEmail)}</strong><span class="company-secondary">${esc(m.fromEmail)}</span></div><div class="ix-members-checks">${d.staff.map(u => `<label class="checkbox-label"><input type="checkbox" data-member-box="${esc(m.id)}" value="${esc(u.id)}" ${(IX.members[m.id] || m.members || []).includes(u.id) ? 'checked' : ''} /> ${esc(u.displayName)}</label>`).join('')}</div><button type="button" class="button button-secondary button-small" data-action="ix-members-save" data-box="${esc(m.id)}">${svgIcon('save')} Save</button></div>`).join('') || '<p class="subtle">Add a staff mailbox under Deliverability first.</p>'}
    </div>`;
  }

  window.inboxView = function inboxView() {
    if (!IX.data && !IX.loading && !IX.error) load();
    if (IX.error) return `<div class="panel"><div class="panel-empty">${esc(IX.error)} <button type="button" class="button button-secondary button-small" data-action="ix-refresh">Retry</button></div></div>`;
    if (!IX.data) return `<div class="panel"><div class="panel-empty">Loading inbox…</div></div>`;
    const appr = typeof approvalItems === 'function' ? approvalItems() : [];
    const modeBar = `<div class="settings-tabs ix-mode" role="tablist"><button type="button" role="tab" class="settings-tab ${IX.mode !== 'approvals' ? 'active' : ''}" data-action="ix-mode" data-mode="conversations" aria-selected="${IX.mode !== 'approvals'}">${svgIcon('reply')} Conversations${window.inboxUnreadCount() ? ` <span class="nav-count">${window.inboxUnreadCount()}</span>` : ''}</button><button type="button" role="tab" class="settings-tab ${IX.mode === 'approvals' ? 'active' : ''}" data-action="ix-mode" data-mode="approvals" aria-selected="${IX.mode === 'approvals'}">${svgIcon('checkCircle')} Approvals${appr.length ? ` <span class="nav-count">${appr.length}</span>` : ''}</button></div>`;
    if (IX.mode === 'approvals') return modeBar + approvalsPane(appr);
    return `${modeBar}<div class="ix-shell">${folderPane()}${listPane()}${threadPane()}${leadPane()}</div>${IX.members ? `<div class="modal-backdrop" id="ix-members-backdrop">${membersModal()}</div>` : ''}`;
  };
  // Everything waiting on a person: drafts, sequence plans, 4-eyes countersigns, research briefs, briefing requests.
  function approvalsPane(items) {
    const policy = state.auth.approvalPolicy || state.data.settings?.approvalPolicy || 'single';
    const rows = items.map(i => { const [label, icon, tone] = (typeof APPROVAL_KIND_META !== 'undefined' && APPROVAL_KIND_META[i.kind]) || [i.kind, 'info', 'tone-info']; const l = i.lead;
      const target = i.kind === 'booking' ? `data-view="briefings"` : ['draft', 'plan', 'countersign-email', 'countersign-plan'].includes(i.kind) ? `data-action="send-preview" data-id="${esc(l.id)}"` : `data-action="ix-goto-workbench" data-id="${esc(l.id)}"`;
      return `<button type="button" class="ix-row ix-approval" ${target}><span class="ix-avatar ${tone}">${svgIcon(icon)}</span><span class="ix-row-main"><span class="ix-row-top"><strong>${esc(l.company)}</strong><span class="ix-row-when">${when(i.at)}</span></span><span class="ix-row-preview">${esc(label)}${i.booking ? ` · ${esc(i.booking.date || '')} ${esc(i.booking.time || '')}` : ''}${l.contactName ? ` · ${esc(l.contactName)}` : ''}</span></span></button>`; }).join('');
    return `<section class="panel ix-approvals"><div class="panel-header"><div><h2 class="panel-title">Waiting on a person</h2><p class="panel-description">${items.length} item${items.length === 1 ? '' : 's'} · ${policy === 'four-eyes' ? 'strict 4-eyes' : '1-person approval'}. Opening an item takes you to the step where it is approved.</p></div></div>${rows || `<div class="panel-empty">Nothing to approve. New drafts, plans and briefing requests appear here the moment the engine prepares them.</div>`}</section>`;
  }

  // ---- phone (two-pane: list → thread) ----
  window.inboxMobileView = function inboxMobileView() {
    if (!IX.data && !IX.loading && !IX.error) load();
    if (!IX.data) return `<div class="m-empty"><p>${IX.error ? esc(IX.error) : 'Loading inbox…'}</p></div>`;
    if (IX.convId) {
      if (!IX.thread) return '<div class="m-empty"><p>Loading…</p></div>';
      const { conversation: c, messages, lead } = IX.thread; const me = IX.data.me;
      const items = messages.filter(m => m.kind !== 'event').map(m => `<article class="ix-msg ${m.kind === 'inbound' ? 'is-inbound' : m.kind === 'note' ? 'is-note' : 'is-outbound'}"><header><strong>${esc(m.author || '')}</strong><time>${esc(when(m.createdAt))}</time></header><div class="ix-msg-body">${esc(m.text || '').replace(/\n/g, '<br>')}</div>${m.kind === 'outbound' && m.status === 'awaiting-countersign' && m.firstApproverId !== me ? `<footer><button type="button" class="button button-primary button-small" data-action="ix-countersign" data-id="${esc(m.id)}">Countersign & send</button></footer>` : m.kind === 'outbound' ? `<footer><span class="ix-msg-status">${esc(m.status)}</span></footer>` : ''}</article>`).join('');
      return `<div class="ix-m-thread">
        <div class="ix-m-bar"><button type="button" class="m-back" data-action="ix-close">${svgIcon('back')}</button><div><strong>${esc(c.company)}</strong><span class="subtle">${esc(c.contactName || '')} · ${esc((S[c.status] || S.open)[0])}</span></div></div>
        <div class="ix-m-actions"><select id="ix-assignee" data-action-change="ix-assign"><option value="">Unassigned</option>${IX.data.staff.map(u => `<option value="${esc(u.id)}" ${c.assigneeId === u.id ? 'selected' : ''}>${esc(u.displayName)}</option>`).join('')}</select>${c.status !== 'resolved' ? `<button type="button" class="button button-primary button-small" data-action="ix-status" data-status="resolved">Resolve</button>` : `<button type="button" class="button button-secondary button-small" data-action="ix-status" data-status="open">Reopen</button>`}${c.status !== 'pending' && c.status !== 'resolved' ? `<button type="button" class="button button-secondary button-small" data-action="ix-status" data-status="pending">Pending</button>` : ''}</div>
        <div class="ix-messages">${items}</div>
        <div class="ix-composer"><div class="ix-composer-tabs"><button type="button" class="ix-tab ${IX.composer === 'reply' ? 'is-active' : ''}" data-action="ix-composer" data-mode="reply">Reply</button><button type="button" class="ix-tab ${IX.composer === 'note' ? 'is-active' : ''}" data-action="ix-composer" data-mode="note">Note</button></div>
          ${IX.composer === 'reply' ? (lead && lead.email && !lead.doNotContact ? `<textarea id="ix-reply" class="form-control" rows="4" placeholder="Reply…"></textarea><button type="button" class="button button-primary" data-action="ix-send-reply">${IX.data.approvalPolicy === 'four-eyes' ? 'Submit for countersign' : 'Send reply'}</button>` : '<p class="subtle">Replies blocked for this contact.</p>') : `<textarea id="ix-note" class="form-control" rows="3" placeholder="Private note · @Name to mention"></textarea><button type="button" class="button button-secondary" data-action="ix-add-note">Add note</button>`}
        </div></div>`;
    }
    const d = IX.data;
    const chips = [['mine', `Mine${d.folders.mineUnread ? ` · ${d.folders.mineUnread}` : ''}`], ['unassigned', 'Unassigned'], ['all', 'All'], ...d.mailboxes.map(m => [`box:${m.id}`, `${m.label || m.fromEmail}${m.unread ? ` · ${m.unread}` : ''}`])];
    const rows = filtered().map(c => `<button type="button" class="ix-row ${c.unread ? 'is-unread' : ''}" data-action="ix-open" data-id="${esc(c.id)}"><span class="ix-avatar">${esc(initials(c.contactName || c.company))}</span><span class="ix-row-main"><span class="ix-row-top"><strong>${esc(c.company)}</strong><time>${esc(when(c.lastActivityAt))}</time></span><span class="ix-row-preview">${esc(c.preview?.text || c.subject || '')}</span><span class="ix-row-meta"><span class="ix-chip">${esc(staffName(c.assigneeId))}</span><span class="ix-chip">${esc((S[c.status] || S.open)[0])}</span></span></span></button>`).join('');
    return `<div class="ix-m-list">
      <div class="ix-m-chips">${chips.map(([k, l]) => `<button type="button" class="ix-chip-btn ${IX.folder === k ? 'is-active' : ''}" data-action="ix-folder" data-folder="${esc(k)}">${esc(l)}</button>`).join('')}</div>
      <div class="ix-tabs">${[['open', 'Open'], ['pending', 'Pending'], ['snoozed', 'Snoozed'], ['resolved', 'Resolved']].map(([k, l]) => `<button type="button" class="ix-tab ${IX.status === k ? 'is-active' : ''}" data-action="ix-status-filter" data-status="${k}">${l}</button>`).join('')}</div>
      <div class="ix-rows">${rows || '<div class="m-empty"><p>Nothing here.</p></div>'}</div></div>`;
  };

  // ---- actions ----
  const convUrl = (sub = '') => `/api/inbox/conversations/${encodeURIComponent(IX.convId)}${sub ? `/${sub}` : ''}`;
  async function post(sub, body, okMsg) {
    try { const r = await API(convUrl(sub), { method: 'POST', body: JSON.stringify(body || {}) }); if (okMsg) toast(okMsg); await load({ silent: true }); if (IX.convId) await openConv(IX.convId); return r; }
    catch (err) { toast(err.message, true); return null; }
  }
  window.inboxAction = async function inboxAction(action, button) {
    const ds = button.dataset;
    if (action === 'ix-refresh') { await load(); return true; }
    if (action === 'ix-mode') { IX.mode = ds.mode === 'approvals' ? 'approvals' : 'conversations'; if (state.view !== 'inbox') state.view = 'inbox'; renderApp(); return true; }
    if (action === 'ix-open-lead') {
      state.view = 'inbox'; IX.mode = 'conversations';
      if (!IX.data) { await load({ silent: true }); }
      const conv = (IX.data?.conversations || []).filter(c => c.leadId === ds.lead).sort((a, b) => (a.status === 'resolved') - (b.status === 'resolved') || String(b.lastActivityAt).localeCompare(String(a.lastActivityAt)))[0];
      if (!conv) { toast('No conversation for this organisation yet.', true); renderApp(); return true; }
      IX.folder = 'all'; IX.status = 'all'; await openConv(conv.id); return true;
    }
    if (action === 'ix-folder') { IX.folder = ds.folder; renderApp(); return true; }
    if (action === 'ix-status-filter') { IX.status = ds.status; renderApp(); return true; }
    if (action === 'ix-open') { if (state.view !== 'inbox' && !(typeof window.isPhone === 'function' && window.isPhone())) state.view = 'inbox'; await openConv(ds.id); return true; }
    if (action === 'ix-close') { IX.convId = null; IX.thread = null; renderApp(); return true; }
    if (action === 'ix-composer') { IX.composer = ds.mode; renderApp(); return true; }
    if (action === 'ix-status') { await post('status', { status: ds.status }, `Conversation ${ds.status === 'open' ? 'reopened' : ds.status}.`); return true; }
    if (action === 'ix-snooze') {
      const until = prompt('Snooze until (YYYY-MM-DD):', new Date(Date.now() + 7 * 86400e3).toISOString().slice(0, 10)); if (!until) return true;
      await post('status', { status: 'snoozed', snoozedUntil: `${until}T07:00:00.000Z` }, 'Snoozed — it reopens automatically on that morning.'); return true;
    }
    if (action === 'ix-send-reply') {
      const text = document.querySelector('#ix-reply')?.value.trim(); if (!text) { toast('Write a reply first.', true); return true; }
      const r = await post('reply', { text }); if (r) toast(r.message.status === 'awaiting-countersign' ? 'Submitted — a teammate must countersign before it sends.' : r.message.status === 'failed' ? `Could not queue: ${r.message.error}` : 'Reply queued from the inbox mailbox.', r?.message?.status === 'failed');
      return true;
    }
    if (action === 'ix-countersign') { await post(`reply/${encodeURIComponent(ds.id)}`, {}, 'Countersigned — reply queued.'); return true; }
    if (action === 'ix-add-note') { const text = document.querySelector('#ix-note')?.value.trim(); if (!text) { toast('Write a note first.', true); return true; } await post('note', { text }, 'Note added.'); return true; }
    if (action === 'ix-triage') {
      const extra = document.querySelector('#ix-triage-extra')?.value.trim() || '';
      const body = { category: ds.category };
      if (ds.category === 'wrong-person') { if (!extra) { toast('Type the right person’s name first.', true); return true; } body.redirectName = extra; }
      if (ds.category === 'not-now' && /^\d{4}-\d{2}-\d{2}$/.test(extra)) body.resumeOn = extra;
      if (ds.category === 'opt-out' && !confirm('Suppress this contact workspace-wide?')) return true;
      try { await API(`/api/leads/${encodeURIComponent(IX.thread.lead.id)}/triage`, { method: 'POST', body: JSON.stringify(body) }); toast('Triaged.'); await refresh(); await load({ silent: true }); await openConv(IX.convId); } catch (err) { toast(err.message, true); }
      return true;
    }
    if (action === 'ix-goto-workbench') { state.view = 'workbench'; state.wb.selectedId = ds.id; state.wb.filter = 'all'; renderApp(); return true; }
    if (action === 'ix-members-open') { IX.members = Object.fromEntries(IX.data.mailboxes.map(m => [m.id, m.members || []])); renderApp(); return true; }
    if (action === 'ix-members-close') { IX.members = null; renderApp(); return true; }
    if (action === 'ix-members-save') {
      const ids = [...document.querySelectorAll(`[data-member-box="${CSS.escape(ds.box)}"]:checked`)].map(i => i.value);
      try { await API(`/api/inbox/mailboxes/${encodeURIComponent(ds.box)}/members`, { method: 'PUT', body: JSON.stringify({ userIds: ids }) }); toast('Members saved.'); IX.members[ds.box] = ids; await load({ silent: true }); IX.members = Object.fromEntries(IX.data.mailboxes.map(m => [m.id, m.members || []])); renderApp(); } catch (err) { toast(err.message, true); }
      return true;
    }
    return false;
  };
  document.addEventListener('change', async event => {
    const sel = event.target.closest('[data-action-change="ix-assign"]'); if (!sel || !IX.convId) return;
    await post('assign', { userId: sel.value || null }, sel.value ? 'Assigned.' : 'Unassigned.');
  });
  document.addEventListener('input', event => { if (event.target.id === 'ix-search') { IX.q = event.target.value; const list = document.querySelector('.ix-list'); if (list) { list.outerHTML = listPane(); const i = document.querySelector('#ix-search'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } } } });
  // Light polling keeps badges fresh while the inbox is open.
  if (typeof setInterval === "function") setInterval(() => { if (document.visibilityState === 'visible' && state.auth?.authenticated && (state.view === 'inbox' || (state.m && state.m.tab === 'inbox'))) load({ silent: true }); }, 45000);
})();
