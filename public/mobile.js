/* Chelo — mobile companion (G8). Plain responsive web, no PWA.
 * Phone (≤720px) gets a reduced app: Inbox · Approvals · Leads · More, bottom tab bar.
 * Desktop-only features (Workbench stepper, Ops, Deliverability, Data quality, Analytics, Discover, Settings) are hidden entirely.
 * Reuses app.js state, API, actions (email-approve/countersign/return, seq-*, triage-apply, confirm/decline-booking, logout). */
(function () {
  const PHONE_QUERY = '(max-width: 720px)';
  const mq = window.matchMedia(PHONE_QUERY);
  window.isPhone = () => mq.matches && !location.pathname.startsWith('/book/') && !location.pathname.startsWith('/p/') && !location.pathname.startsWith('/opt-out/');
  mq.addEventListener('change', () => { if (state.auth?.authenticated) renderApp(); });
  const BUILD = (document.querySelector('script[src*="mobile.js"]')?.getAttribute('src') || '').split('v=')[1] || 'dev';
  state.m = { tab: 'approvals', leadId: null, q: '', partnerId: null, section: null };

  const when = iso => { if (!iso) return ''; const d = new Date(iso); const days = Math.round((Date.now() - d) / 86400000); if (days === 0) return d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }); if (days === 1) return 'yesterday'; if (days < 7) return `${days}d ago`; return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }); };
  const leadsSorted = () => state.data.leads.slice().sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0));

  // ---- queues ----------------------------------------------------------------------------------
  function inboxItems() {
    const items = [];
    for (const l of state.data.leads) {
      if (l.triage && !l.triage.handled) items.push({ kind: 'reply', at: l.triage.receivedAt || l.repliedAt || l.updatedAt, lead: l, overdue: l.triage.dueAt && Date.parse(l.triage.dueAt) < Date.now() });
      else if (String(l.emailStatus || '').startsWith('Failed') || l.flow?.status === 'blocked') items.push({ kind: 'failed', at: l.updatedAt, lead: l });
    }
    for (const b of state.data.bookings.filter(b => b.status === 'Requested')) items.push({ kind: 'booking', at: b.createdAt, booking: b, lead: state.data.leads.find(l => l.id === b.leadId) });
    return items.sort((a, b) => (b.overdue ? 1 : 0) - (a.overdue ? 1 : 0) || Date.parse(b.at || 0) - Date.parse(a.at || 0));
  }
  function approvalItems() {
    const items = [];
    for (const l of state.data.leads) {
      if (l.doNotContact) continue;
      const seq = l.sequence;
      if (seq && seq.status === 'pending-approval') items.push({ kind: 'countersign-plan', lead: l, at: seq.approval?.firstApprovedAt || l.updatedAt });
      else if (seq && seq.status === 'draft') items.push({ kind: 'plan', lead: l, at: seq.builtAt || l.updatedAt });
      else if (l.emailStatus === 'Pending second approval') items.push({ kind: 'countersign-email', lead: l, at: l.updatedAt });
      else if (l.emailDraft && ['Draft', 'None', undefined, ''].includes(l.emailStatus) && !seq) items.push({ kind: 'draft', lead: l, at: l.emailDraft.generatedAt || l.updatedAt });
      else if (l.research && l.research.status === 'pending-review') items.push({ kind: 'research', lead: l, at: l.research.fetchedAt || l.updatedAt });
    }
    return items.sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0));
  }
  function notifications() {
    const n = [];
    const inbox = inboxItems(); const appr = approvalItems();
    const overdue = inbox.filter(i => i.overdue).length; if (overdue) n.push({ tone: 'danger', icon: 'clock', text: `${overdue} repl${overdue === 1 ? 'y is' : 'ies are'} past the response SLA`, tab: 'inbox' });
    const replies = inbox.filter(i => i.kind === 'reply').length; if (replies) n.push({ tone: 'info', icon: 'mail', text: `${replies} human repl${replies === 1 ? 'y' : 'ies'} waiting for triage`, tab: 'inbox' });
    const bookings = inbox.filter(i => i.kind === 'booking').length; if (bookings) n.push({ tone: 'info', icon: 'calendar', text: `${bookings} briefing request${bookings === 1 ? '' : 's'} to confirm`, tab: 'inbox' });
    const failed = inbox.filter(i => i.kind === 'failed').length; if (failed) n.push({ tone: 'warn', icon: 'xCircle', text: `${failed} send${failed === 1 ? '' : 's'} failed or blocked`, tab: 'inbox' });
    const cs = appr.filter(i => i.kind.startsWith('countersign')).length; if (cs) n.push({ tone: 'warn', icon: 'shield', text: `${cs} item${cs === 1 ? '' : 's'} need${cs === 1 ? 's' : ''} a 4-eyes countersignature`, tab: 'approvals' });
    const plans = appr.filter(i => ['plan', 'draft'].includes(i.kind)).length; if (plans) n.push({ tone: 'info', icon: 'send', text: `${plans} draft${plans === 1 ? '' : 's'}/plan${plans === 1 ? '' : 's'} ready to approve`, tab: 'approvals' });
    const paused = (state.data.mailboxes || []).filter(m => m.status === 'paused').length; if (paused) n.push({ tone: 'danger', icon: 'shield', text: `${paused} mailbox${paused === 1 ? '' : 'es'} auto-paused by the circuit breaker — review on desktop`, tab: null });
    const dueSoon = (state.rel.summary?.stewardship?.queue || []).filter(t => t.overdue).length; if (dueSoon) n.push({ tone: 'warn', icon: 'partners', text: `${dueSoon} stewardship touch${dueSoon === 1 ? '' : 'es'} overdue`, tab: 'more', section: 'relationships' });
    return n;
  }

  // ---- shell -----------------------------------------------------------------------------------
  const TABS = [['inbox', 'Inbox', 'mail'], ['approvals', 'Approvals', 'checkCircle'], ['leads', 'Leads', 'prospects'], ['more', 'More', 'dots']];
  function tabBar() {
    const counts = { inbox: inboxItems().length, approvals: approvalItems().length, leads: 0, more: notifications().filter(n => n.tone === 'danger').length };
    return `<nav class="m-tabs" aria-label="Sections">${TABS.map(([id, label, icon]) => `<button type="button" class="m-tab ${state.m.tab === id ? 'is-active' : ''}" data-action="m-tab" data-tab="${id}" aria-current="${state.m.tab === id ? 'page' : 'false'}"><span class="m-tab-icon">${svgIcon(icon)}${counts[id] ? `<span class="m-badge">${counts[id] > 99 ? '99+' : counts[id]}</span>` : ''}</span><span>${label}</span></button>`).join('')}</nav>`;
  }
  function header(title, { back = null, sub = '' } = {}) {
    return `<header class="m-head">${back ? `<button type="button" class="m-back" data-action="m-back" aria-label="Back">${svgIcon('back')}</button>` : `<span class="m-brand"><img src="/brand/chelo-mark.svg" alt="" width="26" height="26" /></span>`}<div class="m-head-text"><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div><span class="avatar m-avatar" title="${esc(state.auth.displayName || state.auth.username || '')}">${initials(state.auth.displayName || state.auth.username || 'C')}</span></header>`;
  }
  const empty = (icon, text) => `<div class="m-empty">${svgIcon(icon)}<p>${esc(text)}</p></div>`;
  const leadMeta = l => [l.contactName, l.sector, l.province].filter(Boolean).join(' · ');

  // ---- Inbox -----------------------------------------------------------------------------------
  function inboxView() {
    const items = inboxItems();
    const rows = items.map(i => {
      if (i.kind === 'booking') { const b = i.booking; return `<button type="button" class="m-row" data-action="m-open-lead" data-id="${esc(b.leadId || '')}" data-booking="${esc(b.id)}"><span class="m-row-icon tone-info">${svgIcon('calendar')}</span><span class="m-row-main"><strong>${esc(b.organization || b.contactName)}</strong><span>Briefing requested · ${esc(b.date || '')} ${esc(b.time || '')}</span></span><small>${when(i.at)}</small></button>`; }
      const l = i.lead; const t = l.triage;
      if (i.kind === 'failed') return `<button type="button" class="m-row" data-action="m-open-lead" data-id="${esc(l.id)}"><span class="m-row-icon tone-warn">${svgIcon('xCircle')}</span><span class="m-row-main"><strong>${esc(l.company)}</strong><span>${esc(l.emailStatus || l.flow?.detail || 'Blocked')}</span></span><small>${when(i.at)}</small></button>`;
      const [label, icon] = TRIAGE_META[t.category] || TRIAGE_META.unclassified;
      return `<button type="button" class="m-row ${i.overdue ? 'is-overdue' : ''}" data-action="m-open-lead" data-id="${esc(l.id)}"><span class="m-row-icon tone-accent">${svgIcon(icon)}</span><span class="m-row-main"><strong>${esc(l.company)}</strong><span>${esc(t.excerpt || 'Human reply')}</span><em>Suggested: ${esc(label)}${i.overdue ? ' · overdue' : t.dueAt ? ` · respond by ${when(t.dueAt)}` : ''}</em></span><small>${when(i.at)}</small></button>`;
    }).join('');
    return `${header('Inbox', { sub: items.length ? `${items.length} item${items.length === 1 ? '' : 's'} need a human` : 'Nothing waiting — sequences are running themselves' })}<section class="m-list">${rows || empty('mail', 'No replies, failed sends or briefing requests right now.')}</section>`;
  }

  // ---- Approvals -------------------------------------------------------------------------------
  const KIND_META = { plan: ['Sequence plan', 'send', 'tone-accent'], 'countersign-plan': ['Countersign plan (4-eyes)', 'shield', 'tone-warn'], draft: ['First-touch draft', 'mail', 'tone-accent'], 'countersign-email': ['Countersign email (4-eyes)', 'shield', 'tone-warn'], research: ['Research brief to review', 'search', 'tone-info'] };
  function approvalsView() {
    const items = approvalItems();
    const rows = items.map(i => { const [label, icon, tone] = KIND_META[i.kind]; const l = i.lead; return `<button type="button" class="m-row" data-action="m-open-lead" data-id="${esc(l.id)}"><span class="m-row-icon ${tone}">${svgIcon(icon)}</span><span class="m-row-main"><strong>${esc(l.company)}</strong><span>${esc(label)}</span><em>${esc(l.emailDraft?.subject || l.project || '')}</em></span><small>${when(i.at)}</small></button>`; }).join('');
    const policy = state.auth.approvalPolicy || state.data.settings?.approvalPolicy || 'single';
    return `${header('Approvals', { sub: `${items.length} waiting · ${policy === 'four-eyes' ? 'strict 4-eyes' : '1-person approval'}` })}<section class="m-list">${rows || empty('checkCircle', 'Nothing to approve. New drafts and plans appear here the moment the engine prepares them.')}</section>`;
  }

  // ---- Leads -----------------------------------------------------------------------------------
  function leadsView() {
    const q = state.m.q.trim().toLowerCase();
    const list = leadsSorted().filter(l => !q || [l.company, l.contactName, l.sector, l.province, l.project, l.stage].join(' ').toLowerCase().includes(q)).slice(0, 80);
    const rows = list.map(l => `<button type="button" class="m-row" data-action="m-open-lead" data-id="${esc(l.id)}"><span class="m-row-avatar">${initials(l.company)}</span><span class="m-row-main"><strong>${esc(l.company)}</strong><span>${esc(leadMeta(l))}</span><em>${esc((WB_STATUS_META[wbStatusOf(l)] || [l.emailStatus || ''])[0])}${l.fit?.score != null ? ` · fit ${Math.round(l.fit.score * 100)}` : ''}</em></span>${stagePill(l.stage || 'New')}</button>`).join('');
    return `${header('Leads', { sub: `${state.data.leads.length} in the workspace` })}<div class="m-search">${svgIcon('search')}<input type="search" id="m-search" placeholder="Company, person, sector, province…" value="${esc(state.m.q)}" autocomplete="off" /></div><section class="m-list">${rows || empty('search', 'No leads match.')}</section>`;
  }
  function leadDetail(l) {
    const booking = state.data.bookings.filter(b => b.leadId === l.id).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    const bookingCard = booking ? `<section class="m-card"><h3>${svgIcon('calendar')}Briefing ${esc(booking.status.toLowerCase())}</h3><p>${esc(booking.date || '')} ${esc(booking.time || '')} SAST · ${esc(booking.videoPlatform || 'video')}</p>${booking.status === 'Requested' ? `<div class="m-actions"><button type="button" class="button button-primary" data-action="confirm-booking" data-id="${esc(booking.id)}">${svgIcon('check')}Confirm & send invite</button><button type="button" class="button button-ghost" data-action="decline-booking" data-id="${esc(booking.id)}">Decline</button></div>` : ''}</section>` : '';
    const research = l.research && l.research.status === 'pending-review' ? `<section class="m-card"><h3>${svgIcon('search')}Research brief awaiting review</h3><p class="subtle">${esc(l.research.brief?.funderMissionSummary || 'Open on desktop to review individual findings and citations.')}</p><p class="subtle">Review happens on desktop so citations can be checked side by side.</p></section>` : '';
    const d = l.emailDraft; const st = l.emailStatus || 'None';
    const draftCard = d && !l.sequence ? `<section class="m-card"><h3>${svgIcon('mail')}First-touch draft <span class="stage-pill ${st === 'Approved' ? 'pill-won' : 'pill-new'}">${esc(st)}</span></h3><div class="m-preview"><strong>${esc(d.subject || '')}</strong><pre>${esc(d.body || '')}</pre></div>${l.guardrail?.issues?.length ? `<ul class="m-guard">${l.guardrail.issues.slice(0, 5).map(i => `<li class="${i.severity}">${esc(i.type)}: “${esc(i.text)}”</li>`).join('')}</ul>` : ''}<input type="hidden" id="email-subject" value="${esc(d.subject || '')}" /><textarea id="email-body" hidden>${esc(d.body || '')}</textarea><div class="m-actions">${['Draft', 'None'].includes(st) ? `<button type="button" class="button button-primary" data-action="email-approve" data-id="${esc(l.id)}">${svgIcon('checkCircle')}Approve</button>` : ''}${st === 'Pending second approval' ? `<button type="button" class="button button-primary" data-action="email-countersign" data-id="${esc(l.id)}">${svgIcon('shield')}Countersign</button>` : ''}${['Approved', 'Pending second approval'].includes(st) ? `<button type="button" class="button button-ghost" data-action="email-return" data-id="${esc(l.id)}">${svgIcon('back')}Reject → draft</button>` : ''}${st === 'Approved' ? `<button type="button" class="button button-secondary" data-action="send-smtp" data-id="${esc(l.id)}">${svgIcon('send')}Queue & send</button>` : ''}</div></section>` : '';
    const seqCard = l.sequence ? `<section class="m-card m-seq">${wbSequencePanel(l)}</section>` : '';
    const triageCard = l.triage && !l.triage.handled ? `<section class="m-card m-triage">${wbTriageCard(l)}</section>` : '';
    const acts = (state.data.activities || []).filter(a => a.text.toLowerCase().includes(String(l.company || '').toLowerCase())).slice(0, 8);
    const timeline = acts.length ? `<section class="m-card"><h3>${svgIcon('clock')}Recent</h3><ul class="m-timeline">${acts.map(a => `<li><span>${when(a.createdAt)}</span>${esc(a.text)}</li>`).join('')}</ul></section>` : '';
    const facts = [['Stage', l.stage || 'New'], ['Status', (WB_STATUS_META[wbStatusOf(l)] || [l.emailStatus || '—'])[0]], ['Owner', l.owner || 'unassigned'], ['Project', l.project || state.data.projects.find(p => p.id === l.projectId)?.name || '—'], ['Ask', l.amount ? money(l.amount) : '—'], ['Fit', l.fit?.score != null ? `${Math.round(l.fit.score * 100)} · ${l.fit.window?.label || ''}` : '—'], ['FYE', l.financialYearEnd || '—'], ['Email', l.email || 'awaiting contact'], ['Last touch', l.lastContactedAt ? when(l.lastContactedAt) : 'never']];
    return `${header(l.company, { back: true, sub: leadMeta(l) })}
      ${l.doNotContact ? '<div class="m-banner danger">Do not contact — suppressed workspace-wide.</div>' : ''}
      ${triageCard}${bookingCard}${seqCard}${draftCard}${research}
      <section class="m-card"><h3>${svgIcon('info')}Details</h3><dl class="m-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>${l.relationshipContext ? `<p class="subtle">Warm intro: ${esc(l.relationshipContext)}</p>` : ''}</section>
      ${timeline}
      <p class="m-foot-note">Editing, research review, discovery and ops live on desktop.</p>`;
  }

  // ---- More ------------------------------------------------------------------------------------
  function overviewLite() {
    const leads = state.data.leads; const active = getActiveLeads(); const partners = state.data.partners || [];
    const requests = state.data.bookings.filter(b => b.status === 'Requested').length;
    const cards = [['Open prospects', String(active.length), `${leads.length} total`, 'prospects'], ['Potential pipeline', money(getPipelineValue()), 'estimated ask value', 'trend'], ['Briefing requests', String(requests), requests ? 'awaiting confirmation' : 'none pending', 'calendar'], ['Active partners', String(partners.length), `${money(partners.reduce((n, p) => n + Number(p.amount || 0), 0))} won`, 'partners']];
    const stages = [['Prospects', leads.filter(l => !['Won', 'Not proceeding'].includes(l.stage)).length], ['In conversation', leads.filter(l => ['Contacted', 'Interested'].includes(l.stage)).length], ['Proposals out', leads.filter(l => l.stage === 'Proposal sent').length], ['Briefings', state.data.bookings.filter(b => ['Requested', 'Confirmed'].includes(b.status)).length], ['Sequences running', leads.filter(l => l.sequence?.status === 'running').length], ['Won', leads.filter(l => l.stage === 'Won').length]];
    const max = Math.max(1, ...stages.map(x => x[1]));
    return `${header('Overview', { back: true, sub: 'Snapshot · full analytics on desktop' })}
      <div class="m-kpis">${cards.map(([k, v, f, i]) => `<div class="m-kpi"><span class="m-kpi-icon">${svgIcon(i)}</span><span class="m-kpi-label">${esc(k)}</span><strong>${esc(v)}</strong><small>${esc(f)}</small></div>`).join('')}</div>
      <section class="m-card"><h3>${svgIcon('pipeline')}Pipeline pulse</h3><ul class="m-bars">${stages.map(([k, v]) => `<li><span>${esc(k)}</span><i style="width:${Math.round(v / max * 100)}%"></i><strong>${v}</strong></li>`).join('')}</ul></section>`;
  }
  function moreView() {
    if (state.m.section === 'overview') return overviewLite();
    if (state.m.section === 'relationships') return relationshipsLite();
    if (state.m.section === 'notifications') return notificationsView();
    const n = notifications(); const danger = n.filter(x => x.tone === 'danger').length;
    const row = (section, icon, title, sub, badge = '') => `<button type="button" class="m-row" data-action="m-section" data-section="${section}"><span class="m-row-icon tone-info">${svgIcon(icon)}</span><span class="m-row-main"><strong>${esc(title)}</strong><span>${esc(sub)}</span></span>${badge}</button>`;
    return `${header('More')}<section class="m-list">
      ${row('notifications', 'bell', 'Notifications', n.length ? `${n.length} signal${n.length === 1 ? '' : 's'}` : 'All quiet', danger ? `<span class="m-badge is-inline">${danger}</span>` : '')}
      ${row('relationships', 'partners', 'Relationships', 'Won partners · last touch · next due')}
      ${row('overview', 'overview', 'Overview', 'Prospects · pipeline · briefings · partners')}
    </section>
    <section class="m-card"><h3>${svgIcon('prospects')}${esc(state.auth.displayName || state.auth.username || '')}</h3><p class="subtle">${esc(roleLabel(state.auth.role))} · ${state.auth.approvalPolicy === 'four-eyes' ? 'strict 4-eyes' : '1-person approval'}</p><div class="m-actions"><button type="button" class="button button-secondary" data-action="m-refresh">${svgIcon('refresh')}Refresh</button>${state.auth.openAccessDemo ? '' : `<button type="button" class="button button-ghost" data-action="logout">${svgIcon('logout')}Sign out</button>`}</div></section>
    <p class="m-foot-note">Ops, deliverability, data quality, analytics, discovery and settings are desktop-only.<br>Build ${esc(BUILD)} · phone layout</p>`;
  }
  function notificationsView() {
    const n = notifications();
    return `${header('Notifications', { back: true })}<section class="m-list">${n.length ? n.map(x => `<button type="button" class="m-row" data-action="m-goto" data-tab="${esc(x.tab || '')}" data-section="${esc(x.section || '')}" ${x.tab ? '' : 'disabled'}><span class="m-row-icon tone-${x.tone === 'danger' ? 'warn' : x.tone}">${svgIcon(x.icon)}</span><span class="m-row-main"><strong>${esc(x.text)}</strong></span></button>`).join('') : empty('bell', 'Nothing needs you right now.')}</section>`;
  }
  function relationshipsLite() {
    const r = state.rel.summary;
    if (!r) { loadRelationships(); return `${header('Relationships', { back: true })}${empty('partners', state.rel.error || 'Loading…')}`; }
    if (state.m.partnerId) {
      const p = r.partners.find(x => x.id === state.m.partnerId);
      if (!p) { state.m.partnerId = null; return relationshipsLite(); }
      const tasks = (r.stewardship.queue || []).filter(t => t.partnerId === p.id);
      return `${header(p.company, { back: true, sub: `owner ${p.owner || 'unassigned'}${p.introducer ? ` · via ${p.introducer}` : ''}` })}
        <section class="m-card"><dl class="m-facts"><div><dt>Last touch</dt><dd>${p.lastTouch ? `${when(p.lastTouch.at)} · ${esc(p.lastTouch.title)}` : 'never'}</dd></div><div><dt>Next due</dt><dd>${p.nextDue ? esc(relDate(p.nextDue)) : '—'}</dd></div><div><dt>Health</dt><dd>${esc(p.health?.status || '—')}</dd></div><div><dt>People</dt><dd>${p.people}</dd></div><div><dt>Pledged</dt><dd>${p.pledgeTotals?.pledged != null ? money(p.pledgeTotals.pledged) : money(p.amount)}</dd></div><div><dt>Renewal</dt><dd>${p.renewal?.at ? esc(relDate(p.renewal.at)) : '—'}</dd></div></dl></section>
        ${tasks.length ? `<section class="m-card"><h3>${svgIcon('clock')}Stewardship</h3><ul class="m-timeline">${tasks.map(t => `<li class="${t.overdue ? 'is-overdue' : ''}"><span>${esc(relDate(t.dueAt))}</span>${esc(t.title)}</li>`).join('')}</ul></section>` : ''}
        <p class="m-foot-note">Logging touches, pledges and people happens on desktop.</p>`;
    }
    const q = state.m.q.trim().toLowerCase();
    const partners = r.partners.filter(p => !q || [p.company, p.owner, p.introducer].join(' ').toLowerCase().includes(q));
    return `${header('Relationships', { back: true, sub: `${r.partners.length} won partner${r.partners.length === 1 ? '' : 's'}` })}<div class="m-search">${svgIcon('search')}<input type="search" id="m-search" placeholder="Partner, owner, introducer…" value="${esc(state.m.q)}" autocomplete="off" /></div><section class="m-list">${partners.length ? partners.map(p => `<button type="button" class="m-row" data-action="m-open-partner" data-id="${esc(p.id)}"><span class="m-row-avatar">${initials(p.company)}</span><span class="m-row-main"><strong>${esc(p.company)}</strong><span>Last touch ${p.lastTouch ? when(p.lastTouch.at) : 'never'}${p.nextDue ? ` · next ${esc(relDate(p.nextDue))}` : ''}</span></span>${p.nextDue && Date.parse(p.nextDue) < Date.now() ? '<span class="m-badge is-inline">due</span>' : `<span class="stage-pill ${p.health?.status === 'warm' ? 'pill-won' : p.health?.status === 'at-risk' ? 'pill-not-proceeding' : 'pill-new'}">${esc(p.health?.status || '')}</span>`}</button>`).join('') : empty('partners', 'No won partners yet.')}</section>`;
  }

  // ---- render + actions ------------------------------------------------------------------------
  window.renderMobileApp = function renderMobileApp() {
    const app = $('#app');
    let body;
    if (state.m.leadId) { const l = getLead(state.m.leadId); body = l ? leadDetail(l) : (state.m.leadId = null, inboxView()); }
    else body = state.m.tab === 'approvals' ? approvalsView() : state.m.tab === 'leads' ? leadsView() : state.m.tab === 'more' ? moreView() : inboxView();
    app.innerHTML = `<div class="m-shell">${state.auth.demoAccess ? '<div class="m-banner">Demo admin · sample data only</div>' : ''}<main class="m-main">${body}</main>${tabBar()}</div>`;
    $('#modal-root').innerHTML = renderModal();
  };
  window.mobileAction = async function mobileAction(action, button) {
    if (action === 'm-tab') { state.m.tab = button.dataset.tab; state.m.leadId = null; state.m.section = null; state.m.partnerId = null; state.m.q = ''; if (state.m.tab === 'more') loadRelationships(); renderApp(); window.scrollTo(0, 0); return true; }
    if (action === 'm-open-lead') { if (button.dataset.id) { state.m.leadId = button.dataset.id; renderApp(); window.scrollTo(0, 0); } else toast('This booking is not linked to a lead.'); return true; }
    if (action === 'm-back') { if (state.m.leadId) state.m.leadId = null; else if (state.m.partnerId) state.m.partnerId = null; else state.m.section = null; renderApp(); return true; }
    if (action === 'm-section') { state.m.section = button.dataset.section; state.m.q = ''; if (state.m.section === 'relationships') loadRelationships(); renderApp(); return true; }
    if (action === 'm-goto') { state.m.tab = button.dataset.tab || 'inbox'; state.m.section = button.dataset.section || null; state.m.leadId = null; renderApp(); return true; }
    if (action === 'm-open-partner') { state.m.partnerId = button.dataset.id; renderApp(); return true; }
    if (action === 'm-refresh') { await refresh(); toast('Refreshed.'); return true; }
    return false;
  };
  // If app.js already painted the desktop shell before this file ran, repaint in phone mode.
  if (state.auth?.authenticated && window.isPhone()) { try { renderApp(); } catch (e) { console.error('mobile repaint failed', e); } }
  document.addEventListener('input', event => {
    if (event.target && event.target.id === 'm-search' && window.isPhone()) { state.m.q = event.target.value; const pos = event.target.selectionStart; renderApp(); const el = $('#m-search'); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) { /* ignore */ } } }
  });
})();
