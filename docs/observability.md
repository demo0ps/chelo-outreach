# Batch 6 — Observability (Ops dashboard)

One screen that answers three questions for a non-technical team: **Is anything broken? What is it costing us? What do I click next?**

## Where
Sidebar → **Ops** (badge = critical + warnings). `GET /api/ops` returns the same JSON (used by the page, handy for uptime monitors).

## What it shows
- **Status banner** — `healthy` / `attention` / `critical` = the worst open check.
- **Health checks**, ranked by severity, filterable by area (Sending · Sequences · Replies · Data · Platform). Every check has a title, the measured detail, a plain-English **Fix**, and an **Open** button to the view where the fix happens. Checks (`lib/observability.js`):
  - Sending: no mailbox / all paused; domain health blocked / needs-work / never checked; circuit breaker tripped; bounce >1% or complaints >0.1% once sampled; daily cap reached; dead-letter backlog; queue waiting with no recent worker/cron.
  - Sequences: plans awaiting approval; failed steps.
  - Replies: human replies past SLA (critical), open replies, inbound sync not configured.
  - Data: open merge reviews; re-verification overdue; discovered-funder catalogue not loaded / mailbox-search backlog.
  - Platform: no durable storage on Vercel; Supabase sync errors / conflicts; cron never ran or stale (>30h send-tick, >36h data-tick); single-approver mode; AI off (info); failure events in the audit log over 7 days.
- **KPIs** — sent 14d + dead/bounce %, reply rate, interested rate, meeting rate (all per first touch, 30d), replies waiting / past SLA, median reply-handling hours, sequences running / stopped by a reply, mailboxes active/paused, queued/dead, pipeline leads vs hidden awaiting contact, data grade A share.
- **Sends vs dead · 14 days** bars (from the send queue), **Funnel · 30 days** (added → contact-ready → drafted → sent → human reply → interested → meeting → won, each with % of previous), **Platform** facts (storage, worker mode, last cron runs, approval policy, inbound, AI).

## How it is computed
`server.js → opsSnapshot()` assembles live state (send-engine metrics, mailboxes with breaker + health, `rollup()` over leads/bookings for funnel/sequences/triage, data summary, catalogue status, remote-sync status, cron last-run from audit entries `cron.send-tick` / `cron.data-tick` — now recorded on every run) and hands it to the pure `buildOps()`; no new tables. Both cron handlers write an audit entry so "last ran" is truthful on serverless hosts.

## Tests
`tests/observability.test.js` — severity ranking, overall status, every check has a fix, KPI maths, healthy path, rollup funnel/sequence/SLA derivation from raw records. `tests/catalogue.test.js` — `/api/ops` end-to-end on a real server.
