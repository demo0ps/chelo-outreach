const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOps, rollup } = require('../lib/observability');

const now = new Date('2026-10-25T08:00:00Z');
const iso = d => new Date(now.getTime() - d * 86400e3).toISOString();

test('observability: checks rank by severity, overall status follows the worst, every check carries a fix', () => {
  const ops = buildOps({
    mailboxes: [
      { id: 'm1', fromEmail: 'nandi@chelo.org', status: 'active', health: { status: 'ok' }, breaker: { tripped: false, sampled: true, rates: { hardBounce: 0.03, complaint: 0 } }, today: { used: 20, cap: 20 } },
      { id: 'm2', fromEmail: 'thabo@chelo.org', status: 'paused', pausedReason: 'breaker', health: { status: 'needs-work', issues: [{ title: 'DMARC missing', fix: 'Add a DMARC TXT record.' }] }, breaker: { tripped: true, reason: 'hard bounce 6% over 7d' } }
    ],
    queue: { queued: 5, dead: 2 }, workerHealthy: false, serverless: true, series: [{ day: '2026-10-24', sent: 10, dead: 1 }],
    sequences: { running: 3, pendingApproval: 1, failed: 0, stoppedByReply: 2 },
    triage: { open: 2, overdue: 1, medianHandleHours: 5 }, inboundConfigured: true,
    data: { graded: 10, gradeA: 4, reverifyDue: 3, mergeReviewsOpen: 1 }, catalogue: { total: 336, imported: 336, visible: 120, awaitingContact: 216, mailboxes: { toSearch: 40 } },
    ephemeralHost: true, durable: false, cron: { 'send-tick': { at: iso(2) }, 'data-tick': null }, approvalPolicy: 'four-eyes', aiConfigured: false, recentFailures: [{ summary: 'Send failed permanently (permanent): 550' }],
    funnel: { added: 100, contactable: 80, drafted: 60, sent: 50, replied: 10, interested: 4, meeting: 2, won: 1 }
  }, now);
  assert.equal(ops.status, 'critical');
  const ids = ops.checks.map(c => c.id);
  for (const id of ['breaker-m2', 'sla-overdue', 'storage', 'rates-m1', 'dead-letter', 'worker', 'cap-m1', 'cron-send-tick', 'cron-data-tick', 'cat-mailboxes', 'errors']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('four-eyes') && !ids.includes('no-mailbox') && !ids.includes('inbound'));
  for (let i = 1; i < ops.checks.length; i++) assert.ok(['critical', 'warn', 'info', 'ok'].indexOf(ops.checks[i - 1].status) <= ['critical', 'warn', 'info', 'ok'].indexOf(ops.checks[i].status), 'sorted by severity');
  assert.ok(ops.checks.every(c => c.fix && c.title && c.area));
  assert.equal(ops.kpis.replyRatePct, 20); assert.equal(ops.kpis.meetingRatePct, 4); assert.equal(ops.kpis.bounce14dPct, 9.1);
  assert.equal(ops.funnel[1].ofPrev, 80); assert.equal(ops.funnel[7].ofTop, 1);
  assert.equal(ops.counts.critical, 3);
  // healthy workspace
  const ok = buildOps({ mailboxes: [{ id: 'm', fromEmail: 'a@b.org', status: 'active', health: { status: 'ok' }, breaker: {}, today: { used: 1, cap: 10 } }], queue: {}, workerHealthy: true, inboundConfigured: true, approvalPolicy: 'four-eyes', aiConfigured: true, durable: true, cron: { 'send-tick': { at: iso(0.1) }, 'data-tick': { at: iso(0.5) } }, catalogue: { total: 336, imported: 336, mailboxes: { toSearch: 0 } } }, now);
  assert.equal(ok.status, 'healthy'); assert.equal(ok.counts.critical + ok.counts.warn, 0);
  assert.equal(buildOps({ mailboxes: [] }, now).checks[0].id, 'no-mailbox');
});

test('observability: rollup derives the 30-day funnel, sequence and reply-SLA numbers from raw lead records', () => {
  const leads = [
    { id: 1, createdAt: iso(5), contactCheck: { status: 'ready' }, emailDraft: {}, firstSentAt: iso(4), triage: { category: 'interested', handled: true, receivedAt: iso(3), handledAt: iso(2.5), dueAt: iso(2) }, sequence: { status: 'stopped', stoppedReason: 'Human reply received' }, stage: 'Meeting' },
    { id: 2, createdAt: iso(10), contactCheck: { status: 'needs-clarification' } },
    { id: 3, createdAt: iso(40), firstSentAt: iso(1), triage: { category: 'not-now', handled: false, receivedAt: iso(1), dueAt: iso(0.5) }, sequence: { status: 'running', steps: [{ status: 'sent' }, { status: 'queued' }] } },
    { id: 4, createdAt: iso(2), isDemo: true, firstSentAt: iso(1) },
    { id: 5, createdAt: iso(3), firstSentAt: iso(2), triage: { category: 'automatic', handled: false, receivedAt: iso(2), dueAt: iso(-1) }, sequence: { status: 'pending-approval', steps: [{ status: 'failed' }] } },
    { id: 6, createdAt: iso(60), stage: 'Won', wonAt: iso(1) }
  ];
  const r = rollup(leads, [{ createdAt: iso(1), status: 'Confirmed' }, { createdAt: iso(1), status: 'Declined' }], now);
  assert.deepEqual(r.funnel, { added: 3, contactable: 1, drafted: 2, sent: 3, replied: 2, interested: 1, meeting: 1, won: 1 });
  assert.equal(r.sequences.running, 1); assert.equal(r.sequences.pendingApproval, 1); assert.equal(r.sequences.stoppedByReply, 1); assert.equal(r.sequences.failed, 1);
  assert.equal(r.triage.open, 2); assert.equal(r.triage.overdue, 1); assert.equal(r.triage.medianHandleHours, 12); assert.deepEqual(r.triage.byCategory, { 'not-now': 1, automatic: 1 });
});
