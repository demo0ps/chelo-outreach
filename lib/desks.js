'use strict';
// Four desks, one engine. A desk is a lens on the same records: each target (lead) has a `kind`, each kind belongs to
// one desk, each staff account holds one or more desks. Admins and root hold all four.
//
//   csi        → funders           (today's Chelo)
//   marketing  → media             (shows, podcasts, outlets, producers)      — Release 2
//   schools    → schools           (DBE list: province → district → school)   — Release 3
//   suppliers  → suppliers         (vetted suppliers, quotes)                  — Release 4

const DESKS = [
  { id: 'csi', label: 'CSI', title: 'CSI desk', targetLabel: 'Funders', targetSingular: 'funder', kind: 'funder', todoBlurb: 'Funders that need you. Chelo checks the email address, researches them and writes the first draft — you read it and press Send.' },
  { id: 'marketing', label: 'Marketing', title: 'Marketing desk', targetLabel: 'Shows & outlets', targetSingular: 'show or outlet', kind: 'media', todoBlurb: 'TV, radio, podcasts and outlets that should hear about Chelo. Chelo finds the newsroom mailbox, reads what they covered and writes the pitch — you approve and press Send.' },
  { id: 'schools', label: 'Schools', title: 'Schools desk', targetLabel: 'Schools & districts', targetSingular: 'school', kind: 'school', todoBlurb: 'Districts and schools to bring onto Chelo. Work province → district → school; book the 15-minute call with the principal.' },
  { id: 'suppliers', label: 'Suppliers', title: 'Suppliers desk', targetLabel: 'Suppliers', targetSingular: 'supplier', kind: 'supplier', todoBlurb: 'Vetted suppliers who quote on school needs. Broadcast a need, shortlist, sign.' }
];
const BY_ID = Object.fromEntries(DESKS.map(d => [d.id, d]));
const KIND_TO_DESK = Object.fromEntries(DESKS.map(d => [d.kind, d.id]));
const DEFAULT_DESK = 'csi';
const ALL_IDS = DESKS.map(d => d.id);

function isDesk(id) { return Boolean(BY_ID[id]); }
function cleanDesks(list) { const set = new Set([].concat(list || []).map(v => String(v || '').trim().toLowerCase()).filter(isDesk)); const out = ALL_IDS.filter(id => set.has(id)); return out.length ? out : [DEFAULT_DESK]; } // catalogue order, so the 'first desk' is always the same
/** Desks a user may work: stored list, or all four for admins/root. */
function desksOf(user) { if (!user) return [DEFAULT_DESK]; if (user.isRoot || user.coRoot || user.role === 'admin') return [...ALL_IDS]; return cleanDesks(user.desks); }
function sessionDesks(session) { if (!session) return [DEFAULT_DESK]; if (session.demoAccess || session.isRoot || ['admin', 'reviewer'].includes(session.role)) return [...ALL_IDS]; return cleanDesks(session.desks); }
/** Resolve the desk for a request: requested (header/query) if allowed, else the first the person holds. */
function resolveDesk(session, requested) { const allowed = sessionDesks(session); const want = String(requested || '').trim().toLowerCase(); return allowed.includes(want) ? want : allowed[0]; }
function kindOfLead(lead) { return lead?.kind && KIND_TO_DESK[lead.kind] ? lead.kind : 'funder'; }
function deskOfLead(lead) { return KIND_TO_DESK[kindOfLead(lead)]; }
function kindForDesk(desk) { return BY_ID[desk]?.kind || 'funder'; }
function describe(desk) { return BY_ID[desk] || BY_ID[DEFAULT_DESK]; }

module.exports = { DESKS, ALL_IDS, DEFAULT_DESK, isDesk, cleanDesks, desksOf, sessionDesks, resolveDesk, kindOfLead, deskOfLead, kindForDesk, describe };
