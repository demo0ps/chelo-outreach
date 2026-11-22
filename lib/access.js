'use strict';
// Who may see which funder. Private by default for staff; admins and root see everything.
//
//   lead.ownerId     – staff account that created it (or was handed it by an admin)
//   lead.sharedWith  – [userId] invited to work on this one funder
//   project.team     – [userId] invited to everything linked to a Verified Project
//
// Everything that hangs off a funder (emails, replies, bookings, PDF, partner record) follows the funder's visibility,
// so callers scope *by lead id* with `visibleLeadIds` rather than re-implementing the rule per collection.

function userId(session) { return String(session?.userId || ''); }
// Reviewers (second-approver role) see everything too: they cannot edit, and 4-eyes approval needs them to open any funder.
function seesEverything(session) { return Boolean(session && (session.demoAccess || session.isRoot || ['admin', 'reviewer'].includes(session.role || 'admin'))); }

function projectTeams(projects = []) {
  const out = new Map();
  for (const p of projects) if (Array.isArray(p.team) && p.team.length) out.set(p.id, new Set(p.team.map(String)));
  return out;
}

/** Why this person may see the lead: 'all' | 'owner' | 'shared' | 'project' | '' (may not). */
function accessReason(session, lead, teams) {
  if (!session || !lead) return '';
  if (seesEverything(session)) return 'all';
  const me = userId(session); if (!me) return '';
  if (String(lead.ownerId || '') === me) return 'owner';
  if (Array.isArray(lead.sharedWith) && lead.sharedWith.map(String).includes(me)) return 'shared';
  if (lead.projectId && teams instanceof Map && teams.get(lead.projectId)?.has(me)) return 'project';
  return '';
}
function canSeeLead(session, lead, teams) { return Boolean(accessReason(session, lead, teams)); }
function filterLeads(session, leads, projects) { if (seesEverything(session)) return leads; const teams = projectTeams(projects); return leads.filter(l => canSeeLead(session, l, teams)); }
function visibleLeadIds(session, leads, projects) { return new Set(filterLeads(session, leads, projects).map(l => l.id)); }
/** Owner or admin may share / reassign. */
function canManageLead(session, lead) { return seesEverything(session) || (lead && String(lead.ownerId || '') === userId(session) && userId(session) !== ''); }

/** Keep ids unique, as strings, and only for known active users. */
function cleanUserIds(ids, users) {
  const known = new Set((users || []).filter(u => u.active !== false).map(u => String(u.id)));
  return [...new Set([].concat(ids || []).map(String).filter(id => known.has(id)))];
}

/** Boot-time: every lead gets an owner. Pre-existing funders go to the root account (admins see them anyway). */
function assignMissingOwners(leads, rootUserId) {
  let changed = 0;
  for (const l of leads) {
    if (!l.ownerId && rootUserId) { l.ownerId = String(rootUserId); changed += 1; }
    if (!Array.isArray(l.sharedWith)) { l.sharedWith = []; changed += 1; }
  }
  return changed;
}

module.exports = { seesEverything, projectTeams, accessReason, canSeeLead, filterLeads, visibleLeadIds, canManageLead, cleanUserIds, assignMissingOwners };
