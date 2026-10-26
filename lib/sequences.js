'use strict';
// Sequence plans: first touch + in-thread follow-ups, approved once, auto-sent by the send engine,
// halted the moment a human replies. Pure planning/template logic — no I/O.
const crypto = require('node:crypto');

const DEFAULT_OFFSETS = [0, 3, 4, 5]; // business days after the previous step
const MAX_STEPS = 6;

function addBusinessDays(date, count) {
  const d = new Date(date); let added = 0;
  while (added < count) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) added += 1; }
  return d;
}
function firstName(name) { const n = String(name || '').trim().split(/\s+/)[0]; return n || 'there'; }
function clamp(text, max) { const t = String(text || '').replace(/\s+/g, ' ').trim(); return t.length > max ? `${t.slice(0, max - 1).trim()}…` : t; }

// Follow-up angles. Each adds ONE new thing; none repeats the first email.
function followUpTemplates({ lead, links, project, facts = [], step }) {
  const name = firstName(lead.contactName);
  const projectName = project?.name || lead.project || 'the Chelo project we proposed';
  const outcome = project?.outcomes?.[0] || project?.summary || '';
  const fact = facts[0] || '';
  const closing = `Kind regards,\nChelo Partnerships Team`;
  const optOut = `If you prefer not to receive further outreach, opt out here: ${links.optOut}`;
  const cta = `Yes — choose a time: ${links.booking}`;
  const variants = {
    2: {
      subject: 'Re: {subject}',
      body: `Hi ${name},\n\nFollowing up on my earlier note about ${projectName}.${fact ? ` I noticed that ${clamp(fact, 180).replace(/^[A-Z]/, c => c.toLowerCase())} — that focus is exactly where this project delivers.` : ''}${outcome ? ` One concrete outcome: ${clamp(outcome, 200)}` : ''}\n\nA 20-minute video briefing is the easiest way to see whether it fits your CSI priorities. No preparation is needed, and there is no commitment to proceed.\n\n${cta}\n\n${closing}\n\n${optOut}`
    },
    3: {
      subject: 'Re: {subject}',
      body: `Hi ${name},\n\nOne short question so I do not keep guessing: which education or community-impact priorities matter most to your team this year?\n\nIf ${projectName} is not the right fit, a one-line reply pointing me to the right person or priority would be genuinely helpful.\n\n${cta}\n\n${closing}\n\n${optOut}`
    },
    4: {
      subject: 'Re: {subject}',
      body: `Hi ${name},\n\nI will close this thread here so it does not clutter your inbox. ${projectName} remains open to a partner${project?.province ? ` in ${project.province}` : ''}, and Chelo reports progress to every funder with traceable, verified milestones.\n\nIf timing changes, replying to this email is all it takes — Chelo will confirm a briefing time personally.\n\n${cta}\n\n${closing}\n\n${optOut}`
    }
  };
  const base = variants[Math.min(step, 4)] || variants[4];
  return { subject: base.subject, body: base.body };
}

function buildPlan({ lead, links, project, facts = [], offsets = DEFAULT_OFFSETS, now = new Date(), ladder = null }) {
  if (!lead.emailDraft || !lead.emailDraft.subject || !lead.emailDraft.body) throw new Error('Draft the first email before building a sequence.');
  const steps = [];
  const initialSubject = String(lead.emailDraft.subject).replace(/^(re|fwd?):\s*/i, '').trim();
  for (let i = 0; i < Math.min(offsets.length, MAX_STEPS); i += 1) {
    const n = i + 1;
    if (n === 1) { steps.push({ n, kind: 'initial', offsetDays: 0, subject: initialSubject, body: lead.emailDraft.body, status: 'planned' }); continue; }
    const t = ladder ? ladder(n) : followUpTemplates({ lead, links, project, facts, step: n });
    steps.push({ n, kind: 'follow-up', offsetDays: offsets[i], subject: t.subject.replace('{subject}', initialSubject), body: t.body, status: 'planned' });
  }
  return { id: `seq_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`, status: 'draft', createdAt: now.toISOString(), updatedAt: now.toISOString(), steps, approval: null, stoppedReason: '', stoppedAt: '', threadMessageId: '' };
}

// Deterministic content digest over every step (used for the single approval / 4-eyes countersign).
function planDigest(sequence, lead) {
  const h = crypto.createHash('sha256');
  h.update(JSON.stringify({ to: String(lead.email || '').toLowerCase(), project: lead.project || '', amount: Number(lead.amount || 0), steps: sequence.steps.map(s => ({ n: s.n, offsetDays: s.offsetDays, subject: s.subject, body: s.body })) }));
  return h.digest('hex');
}

function applyStepEdits(sequence, edits = []) {
  if (!['draft', 'pending-approval'].includes(sequence.status)) throw new Error('Only unapproved sequences can be edited.');
  for (const edit of edits) {
    const step = sequence.steps.find(s => s.n === Number(edit.n)); if (!step) continue;
    if (edit.subject !== undefined) step.subject = String(edit.subject).replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
    if (edit.body !== undefined) step.body = String(edit.body).slice(0, 8000);
    if (edit.offsetDays !== undefined && step.n > 1) step.offsetDays = Math.min(30, Math.max(1, Number(edit.offsetDays) || step.offsetDays));
    if (edit.enabled === false && step.n > 1) step.status = 'skipped';
    if (edit.enabled === true && step.status === 'skipped') step.status = 'planned';
  }
  sequence.updatedAt = new Date().toISOString();
  return sequence;
}

function nextPlannedStep(sequence) { return sequence.steps.find(s => s.status === 'planned'); }
function activeSteps(sequence) { return sequence.steps.filter(s => s.status !== 'skipped'); }
function scheduleFor(sequence, step, from) {
  // Follow-ups are offset in business days from the previous *sent* step (or from approval for step 1).
  const prev = sequence.steps.filter(s => s.n < step.n && s.sentAt).pop();
  const base = prev ? new Date(prev.sentAt) : new Date(from);
  return step.n === 1 ? new Date(from) : addBusinessDays(base, step.offsetDays);
}

const STOP_REASONS = { replied: 'Human reply received', bounced: 'Address bounced', 'opted-out': 'Recipient opted out', manual: 'Stopped by staff', 'do-not-contact': 'Do-not-contact', completed: 'All steps sent' };
function stop(sequence, reason, at = new Date()) {
  if (!sequence || ['stopped', 'completed'].includes(sequence.status)) return sequence;
  for (const s of sequence.steps) if (['planned', 'queued'].includes(s.status)) s.status = 'cancelled';
  sequence.status = reason === 'completed' ? 'completed' : 'stopped';
  sequence.stoppedReason = STOP_REASONS[reason] || String(reason);
  sequence.stoppedAt = at.toISOString(); sequence.updatedAt = at.toISOString();
  return sequence;
}

function summary(sequence) {
  if (!sequence) return null;
  const steps = sequence.steps;
  return { id: sequence.id, status: sequence.status, total: activeSteps(sequence).length, sent: steps.filter(s => s.status === 'sent').length, next: nextPlannedStep(sequence)?.n || null, nextAt: steps.find(s => s.status === 'queued')?.scheduledFor || null, stoppedReason: sequence.stoppedReason };
}

module.exports = { buildPlan, planDigest, applyStepEdits, nextPlannedStep, activeSteps, scheduleFor, stop, summary, followUpTemplates, addBusinessDays, DEFAULT_OFFSETS, STOP_REASONS };
