'use strict';
/**
 * Relationship memory + stewardship (Batch 5) — pure, deterministic, no I/O.
 *
 *  - Org graph: company → foundation → people → projects → pledges, keyed by registrable domain
 *    (falls back to a normalised company name) so leads, partners and candidates that belong to the
 *    same organisation collapse into one node.
 *  - Last touch / next due: derived from every channel we already record (sent mail, replies, opens,
 *    briefings, manual touches, stewardship tasks, pledges) — never typed twice.
 *  - Stewardship cadences for won partners: idempotent task generation keyed by `cadenceKey`, so a
 *    tick can run any number of times without duplicating work.
 *  - Exportable timeline: one chronological ledger across all sources (JSON or CSV).
 */
const DAY = 24 * 60 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const PEOPLE_ROLES = ['csi-lead', 'decision-maker', 'champion', 'introducer', 'finance', 'communications', 'other'];
const TOUCH_KINDS = ['call', 'meeting', 'site-visit', 'event', 'report-sent', 'thank-you', 'note'];
const PLEDGE_STATUSES = ['pledged', 'invoiced', 'received', 'overdue', 'cancelled'];
const PLEDGE_PERIODS = ['once', 'annual', 'multi-year'];

/**
 * Stewardship cadence for a won partner. Offsets are days from `partnerSince` unless `anchor` says otherwise.
 * Research (nonprofit stewardship + SA CSI practice): thank within 48h, show early proof of use within two
 * weeks, report quarterly, invite to see the work, and open the renewal conversation while the next CSI
 * budget is being set (FYE −4 months) rather than after it has been allocated.
 */
const CADENCE = [
  { key: 'thank-you', title: 'Send a personal thank-you', offsetDays: 2, anchor: 'since', kind: 'thank-you', once: true, why: 'Acknowledge the commitment within 48 hours; name the person who made it happen.' },
  { key: 'welcome-pack', title: 'Share the impact plan & reporting calendar', offsetDays: 14, anchor: 'since', kind: 'report-sent', once: true, why: 'Set expectations: what will be reported, when, and who the project contact is.' },
  { key: 'site-visit', title: 'Invite the partner to visit the project', offsetDays: 60, anchor: 'since', kind: 'site-visit', once: true, why: 'Seeing the work is the strongest predictor of renewal.' },
  { key: 'impact-update', title: 'Quarterly impact update', everyDays: 91, anchor: 'since', kind: 'report-sent', why: 'Traceable progress, spend-to-date and beneficiary numbers.' },
  { key: 'annual-report', title: 'Annual impact & spend report', everyDays: 365, anchor: 'since', kind: 'report-sent', why: 'Audited spend summary the partner can use in its own B-BBEE / integrated report.' },
  { key: 'renewal', title: 'Open the renewal conversation', anchor: 'renewal', offsetDays: -120, kind: 'meeting', why: 'Four months before the budget is set — not after it is allocated.' },
  { key: 'pledge-follow-up', title: 'Follow up on an outstanding pledge', anchor: 'pledge', offsetDays: 7, kind: 'call', why: 'Pledge due date passed without payment recorded.' }
];

function normaliseName(value) {
  return String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(pty|ltd|limited|proprietary|inc|incorporated|npc|npo|trust|foundation|holdings|group|sa|south africa|the)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
function registrableDomain(value) {
  let host = String(value || '').trim().toLowerCase();
  if (!host) return '';
  if (host.includes('@')) host = host.split('@').pop();
  host = host.replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#:]/)[0];
  if (!host.includes('.')) return '';
  const parts = host.split('.');
  const second = parts.slice(-2).join('.');
  if (parts.length >= 3 && /^(co|org|gov|ac|net|edu|web)\.[a-z]{2}$/.test(second)) return parts.slice(-3).join('.');
  return second;
}
/** Free mailbox providers must never collapse unrelated organisations into one node. */
const PUBLIC_DOMAINS = new Set(['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'live.com', 'me.com', 'protonmail.com', 'webmail.co.za', 'mweb.co.za', 'telkomsa.net', 'vodamail.co.za']);
function orgKey(record) {
  const dom = registrableDomain(record.website) || registrableDomain(record.email);
  if (dom && !PUBLIC_DOMAINS.has(dom)) return `d:${dom}`;
  const name = normaliseName(record.company || record.name);
  return name ? `n:${name}` : `id:${record.id}`;
}

/**
 * Build the organisation graph. Nodes: org, foundation, person, project, pledge. Edges typed.
 * A foundation is linked to its parent company when either side names the other
 * (`parentCompany` / `foundationName`) or when they share a registrable domain.
 */
function buildOrgGraph({ leads = [], partners = [], candidates = [], people = [], projects = [], pledges = [] } = {}) {
  const nodes = new Map(); const edges = [];
  const addNode = (id, node) => { if (!nodes.has(id)) nodes.set(id, { id, ...node }); return nodes.get(id); };
  const addEdge = (from, to, type) => { if (from && to && from !== to && !edges.some(e => e.from === from && e.to === to && e.type === type)) edges.push({ from, to, type }); };
  const byLead = new Map(partners.map(p => [p.leadId, p]));
  const orgOf = new Map(); // record id → org node id

  const fold = (record, source) => {
    const key = orgKey(record);
    const node = addNode(key, { type: 'org', label: record.company, kind: 'company', sector: record.sector || '', province: record.province || '', records: [], foundationName: '', parentCompany: '' });
    node.records.push({ id: record.id, source, stage: record.stage || record.status || '' });
    if (!node.sector && record.sector) node.sector = record.sector;
    if (record.foundationName) node.foundationName = record.foundationName;
    if (record.parentCompany) { node.parentCompany = record.parentCompany; node.kind = 'foundation'; }
    if (/foundation|trust|npc|fund\b/i.test(String(record.company || ''))) node.kind = 'foundation';
    if (source === 'partner' || record.stage === 'Won' || byLead.has(record.id)) node.partner = true;
    orgOf.set(record.id, key);
    if (record.introducer) node.introducer = record.introducer;
    return node;
  };
  leads.forEach(l => fold(l, 'lead'));
  partners.forEach(p => fold(p, 'partner'));
  candidates.filter(c => !c.promotedLeadId).forEach(c => fold(c, 'candidate'));

  // company ↔ foundation links by name
  const byName = new Map([...nodes.values()].filter(n => n.type === 'org').map(n => [normaliseName(n.label), n.id]));
  for (const node of nodes.values()) {
    if (node.type !== 'org') continue;
    if (node.foundationName) { const f = byName.get(normaliseName(node.foundationName)); if (f) { nodes.get(f).kind = 'foundation'; addEdge(node.id, f, 'operates-foundation'); } }
    if (node.parentCompany) { const c = byName.get(normaliseName(node.parentCompany)); if (c) addEdge(c, node.id, 'operates-foundation'); }
  }
  // projects (via leads/partners) and pledges
  const projectById = new Map(projects.map(p => [p.id, p]));
  const linkProject = (record) => {
    const org = orgOf.get(record.id); const project = record.projectId ? projectById.get(record.projectId) : null;
    if (!org || !project) return;
    addNode(`project:${project.id}`, { type: 'project', label: project.name, sector: project.sector || '', province: project.province || '' });
    addEdge(org, `project:${project.id}`, record.stage === 'Won' || byLead.has(record.id) || record.leadId ? 'funds' : 'considering');
  };
  leads.forEach(linkProject); partners.forEach(linkProject);
  for (const person of people) {
    const org = orgOf.get(person.leadId) || orgOf.get(person.partnerId);
    if (!org) continue;
    addNode(`person:${person.id}`, { type: 'person', label: person.name, title: person.title || '', role: person.role || 'other' });
    addEdge(`person:${person.id}`, org, person.role === 'introducer' ? 'introduced' : 'works-at');
  }
  for (const pledge of pledges) {
    const org = orgOf.get(pledge.partnerId) || orgOf.get(pledge.leadId);
    if (!org) continue;
    addNode(`pledge:${pledge.id}`, { type: 'pledge', label: `${pledge.period === 'annual' ? 'Annual' : pledge.period === 'multi-year' ? 'Multi-year' : 'Once-off'} pledge`, amount: Number(pledge.amount || 0), status: pledge.status });
    addEdge(org, `pledge:${pledge.id}`, 'pledged');
    if (pledge.projectId && projectById.has(pledge.projectId)) { addNode(`project:${pledge.projectId}`, { type: 'project', label: projectById.get(pledge.projectId).name }); addEdge(`pledge:${pledge.id}`, `project:${pledge.projectId}`, 'towards'); }
  }
  return { nodes: [...nodes.values()], edges, orgOf: Object.fromEntries(orgOf) };
}

/** Everything connected to one record's organisation node, flattened for the UI. */
function neighbourhood(graph, recordId) {
  const orgId = graph.orgOf[recordId]; if (!orgId) return null;
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const touching = graph.edges.filter(e => e.from === orgId || e.to === orgId);
  const pick = type => touching.map(e => byId.get(e.from === orgId ? e.to : e.from)).filter(n => n && n.type === type);
  const foundations = touching.filter(e => e.type === 'operates-foundation').map(e => ({ ...byId.get(e.from === orgId ? e.to : e.from), direction: e.from === orgId ? 'child' : 'parent' }));
  return { org: byId.get(orgId), foundations, people: pick('person'), projects: pick('project').map(p => ({ ...p, relation: touching.find(e => e.to === p.id)?.type })), pledges: pick('pledge') };
}

/* ------------------------------------------------------------------ timeline */
function timelineFor({ lead = null, partner = null, messages = [], emailEvents = [], bookings = [], touches = [], pledges = [], tasks = [], activities = [] } = {}) {
  const ids = new Set([lead?.id, partner?.id, partner?.leadId].filter(Boolean));
  const names = [lead?.company, partner?.company].filter(Boolean).map(n => n.toLowerCase());
  const rows = [];
  const push = (at, kind, title, detail = '', actor = '', ref = '') => { if (at) rows.push({ at: new Date(at).toISOString(), kind, title, detail: String(detail || '').slice(0, 240), actor: actor || '', ref }); };
  if (lead?.createdAt) push(lead.createdAt, 'created', 'Prospect added', lead.sourceName ? `Source: ${lead.sourceName}` : '', lead.owner || '');
  if (lead?.research?.generatedAt) push(lead.research.generatedAt, 'research', 'Funder research brief generated', lead.research.status ? `Status: ${lead.research.status}` : '');
  for (const m of messages.filter(m => ids.has(m.leadId))) push(m.sentAt || m.createdAt, 'email-out', m.kind === 'follow-up' || m.followUp ? `Follow-up sent${m.sequenceStep ? ` (step ${m.sequenceStep})` : ''}` : 'First-touch email sent', m.subject || '', m.sentBy || m.actor || '', m.id);
  for (const e of emailEvents.filter(e => ids.has(e.leadId))) {
    const label = { open: 'Email opened', click: 'Yes CTA clicked', reply: 'Reply received', bounce: 'Hard bounce', soft_bounce: 'Soft bounce', unsubscribe: 'Opted out', complaint: 'Spam complaint', briefing_request: 'Briefing requested', proposal_view: 'Proposal viewed' }[e.type] || e.type;
    push(e.occurredAt, e.type === 'reply' ? 'email-in' : 'signal', label, e.source && e.source !== 'first-party' ? `via ${e.source}` : '', '', e.id);
  }
  if (lead?.triage?.receivedAt) push(lead.triage.receivedAt, 'email-in', `Reply triaged: ${lead.triage.category}`, lead.triage.excerpt || '', lead.triage.handledBy || '');
  for (const b of bookings.filter(b => ids.has(b.leadId))) push(b.createdAt || `${b.date}T${b.time || '09:00'}:00`, 'meeting', `Briefing ${String(b.status || 'requested').toLowerCase()}`, [b.date, b.time, b.platform].filter(Boolean).join(' · '), '', b.id);
  for (const t of touches.filter(t => ids.has(t.leadId) || ids.has(t.partnerId))) push(t.at, t.kind, t.summary || t.kind, t.personName ? `with ${t.personName}` : '', t.actor || '', t.id);
  for (const p of pledges.filter(p => ids.has(p.partnerId) || ids.has(p.leadId))) {
    push(p.pledgedAt, 'pledge', `Pledge recorded · R${Number(p.amount || 0).toLocaleString('en-ZA')}`, `${p.period || 'once'}${p.dueAt ? ` · due ${String(p.dueAt).slice(0, 10)}` : ''}`, p.actor || '', p.id);
    if (p.receivedAt) push(p.receivedAt, 'pledge', `Funds received · R${Number(p.amount || 0).toLocaleString('en-ZA')}`, '', '', p.id);
  }
  for (const t of tasks.filter(t => ids.has(t.partnerId) || ids.has(t.leadId))) if (t.status === 'done') push(t.doneAt, 'stewardship', `Stewardship: ${t.title}`, t.note || '', t.doneBy || '', t.id);
  if (partner?.partnerSince) push(partner.partnerSince, 'won', 'Became a partner', partner.project || '', partner.owner || '');
  for (const a of activities) if (names.some(n => String(a.text || '').toLowerCase().includes(n)) && !/updated|moved to/.test(String(a.text))) push(a.createdAt, 'activity', a.text, '', '', a.id);
  rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return rows;
}
const TOUCH_KINDS_FOR_LAST = new Set(['email-out', 'email-in', 'meeting', 'call', 'site-visit', 'event', 'report-sent', 'thank-you', 'stewardship', 'won']);
function lastTouch(timeline) { return timeline.find(r => TOUCH_KINDS_FOR_LAST.has(r.kind)) || null; }
function lastInbound(timeline) { return timeline.find(r => ['email-in', 'meeting', 'call', 'site-visit'].includes(r.kind)) || null; }

function csvCell(v) { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function timelineCsv(rows, header = {}) {
  const lines = [['organisation', 'at', 'kind', 'title', 'detail', 'actor', 'ref'].join(',')];
  for (const r of rows) lines.push([header.organisation || '', r.at, r.kind, r.title, r.detail, r.actor, r.ref].map(csvCell).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

/* ------------------------------------------------------------------ stewardship */
function addDays(date, days) { return new Date(new Date(date).getTime() + days * DAY); }
function iso(d) { return new Date(d).toISOString(); }
function dateOnly(d) { return iso(d).slice(0, 10); }

/** Renewal anchor: explicit renewalAt > next pledge renewal > FYE-derived (budget set ~4 months before year-end) > partnerSince + 1y. */
function renewalAnchor(partner, pledges = [], now = new Date()) {
  if (partner.renewalAt) return { at: new Date(partner.renewalAt), basis: 'renewal date on record' };
  const next = pledges.filter(p => p.renewalAt && p.status !== 'cancelled').map(p => new Date(p.renewalAt)).filter(d => d > addDays(now, -30)).sort((a, b) => a - b)[0];
  if (next) return { at: next, basis: 'pledge renewal date' };
  const fye = Number(partner.financialYearEnd);
  if (Number.isInteger(fye) && fye >= 1 && fye <= 12) {
    let y = now.getUTCFullYear(); let at = new Date(Date.UTC(y, fye, 0)); // last day of FYE month
    if (at < addDays(now, 30)) at = new Date(Date.UTC(y + 1, fye, 0));
    return { at, basis: `financial year-end ${MONTHS[fye - 1]}` };
  }
  if (partner.partnerSince) { let at = addDays(partner.partnerSince, 365); while (at < addDays(now, 30)) at = addDays(at, 365); return { at, basis: 'one year after partnership started' }; }
  return null;
}

/**
 * Deterministic stewardship plan. Returns the tasks that SHOULD exist for the partner up to `horizonDays`
 * ahead; the caller inserts those whose cadenceKey is not already present (idempotent).
 */
function planStewardship(partner, { pledges = [], now = new Date(), horizonDays = 120 } = {}) {
  if (!partner || partner.status === 'Inactive' || !partner.partnerSince) return [];
  const since = new Date(partner.partnerSince); const horizon = addDays(now, horizonDays); const out = [];
  const emit = (c, dueAt, key, extra = {}) => { if (dueAt <= horizon || extra.ignoreHorizon) { const { ignoreHorizon, ...rest } = extra; out.push({ cadenceKey: key, kind: c.kind, title: c.title, why: c.why, dueAt: iso(dueAt), ...rest }); } };
  for (const c of CADENCE) {
    if (c.anchor === 'since' && c.once) { const due = addDays(since, c.offsetDays); if (due >= addDays(now, -365)) emit(c, due, `${c.key}`); }
    else if (c.anchor === 'since' && c.everyDays) {
      for (let n = 1; n <= 12; n++) { const due = addDays(since, n * c.everyDays); if (due > horizon) break; if (due < addDays(now, -180)) continue; emit(c, due, `${c.key}:${n}`); }
    } else if (c.anchor === 'renewal') {
      const r = renewalAnchor(partner, pledges, now); if (!r) continue;
      const due = addDays(r.at, c.offsetDays);
      if (due >= addDays(now, -60)) emit(c, due < now ? now : due, `${c.key}:${dateOnly(r.at)}`, { detail: `Renewal anchor: ${dateOnly(r.at)} (${r.basis})`, ignoreHorizon: true });
    } else if (c.anchor === 'pledge') {
      for (const p of pledges) {
        if (!p.dueAt || p.receivedAt || ['received', 'cancelled'].includes(p.status)) continue;
        const due = addDays(p.dueAt, c.offsetDays); if (due <= now || due <= horizon) emit(c, due < now ? now : due, `${c.key}:${p.id}`, { pledgeId: p.id, ignoreHorizon: true, detail: `R${Number(p.amount || 0).toLocaleString('en-ZA')} due ${dateOnly(p.dueAt)}` });
      }
    }
  }
  return out.sort((a, b) => (a.dueAt < b.dueAt ? -1 : 1));
}
function reconcileTasks(existing = [], planned = []) {
  const have = new Set(existing.map(t => t.cadenceKey));
  return planned.filter(p => !have.has(p.cadenceKey));
}

/** Relationship health from last touch recency, inbound engagement, open stewardship and pledge state. */
function relationshipHealth({ lastTouchAt = null, lastInboundAt = null, openTasks = [], overduePledges = 0, now = new Date() } = {}) {
  const days = lastTouchAt ? Math.floor((now - new Date(lastTouchAt)) / DAY) : null;
  const inboundDays = lastInboundAt ? Math.floor((now - new Date(lastInboundAt)) / DAY) : null;
  const overdueTasks = openTasks.filter(t => new Date(t.dueAt) < now).length;
  const reasons = [];
  let status = 'warm';
  if (days === null) { status = 'cold'; reasons.push('no recorded touch'); }
  else if (days > 90) { status = 'cold'; reasons.push(`${days} days since last touch`); }
  else if (days > 30) { status = 'cooling'; reasons.push(`${days} days since last touch`); }
  else reasons.push(`touched ${days} day${days === 1 ? '' : 's'} ago`);
  if (inboundDays !== null && inboundDays > 120) { if (status === 'warm') status = 'cooling'; reasons.push('no inbound engagement in 4 months'); }
  if (overdueTasks) { if (status !== 'cold') status = 'cooling'; reasons.push(`${overdueTasks} stewardship task${overdueTasks === 1 ? '' : 's'} overdue`); }
  if (overduePledges) { status = 'at-risk'; reasons.push(`${overduePledges} pledge${overduePledges === 1 ? '' : 's'} overdue`); }
  return { status, daysSinceTouch: days, reasons };
}
function nextDue(openTasks = []) { return openTasks.filter(t => t.status === 'open').map(t => t.dueAt).sort()[0] || null; }

function pledgeStatus(p, now = new Date()) {
  if (p.status === 'cancelled') return 'cancelled';
  if (p.receivedAt || p.status === 'received') return 'received';
  if (p.dueAt && new Date(p.dueAt) < now) return 'overdue';
  return p.status === 'invoiced' ? 'invoiced' : 'pledged';
}
function pledgeTotals(pledges = [], now = new Date()) {
  const t = { pledged: 0, received: 0, overdue: 0, outstanding: 0 };
  for (const p of pledges) { const s = pledgeStatus(p, now); const amt = Number(p.amount || 0); if (s === 'cancelled') continue; t.pledged += amt; if (s === 'received') t.received += amt; else { t.outstanding += amt; if (s === 'overdue') t.overdue += amt; } }
  return t;
}

module.exports = { CADENCE, PEOPLE_ROLES, TOUCH_KINDS, PLEDGE_STATUSES, PLEDGE_PERIODS, orgKey, registrableDomain, normaliseName, buildOrgGraph, neighbourhood, timelineFor, timelineCsv, lastTouch, lastInbound, planStewardship, reconcileTasks, renewalAnchor, relationshipHealth, nextDue, pledgeStatus, pledgeTotals };
