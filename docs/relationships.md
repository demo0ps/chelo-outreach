# Relationship memory + stewardship (Batch 5)

The pipeline wins the first cheque; relationship memory wins the second, third and fourth. Batch 5 adds an
organisation graph, a single timeline across every channel, people/pledge records, and stewardship cadences that
run on a calendar instead of in someone's head. Pure logic lives in `lib/relationships.js` (no I/O, fully tested);
`server.js` wires it to storage, auth, audit and the API.

## Data model (additive SQLite tables)

| table | one row per | key fields |
|---|---|---|
| `people` | person at a funder | `leadId`/`partnerId`, `name`, `title`, `role` (csi-lead, decision-maker, champion, introducer, finance, communications, other), `email` (masked in every API response; never sent to AI), `notes` |
| `touches` | human interaction not already recorded as mail/booking | `kind` (call, meeting, site-visit, event, report-sent, thank-you, note), `summary`, `at`, `personName`, `actor`, `nextDueAt` |
| `pledges` | commitment | `amount`, `period` (once / annual / multi-year), `pledgedAt`, `dueAt`, `renewalAt`, `receivedAt`, `status`, `projectId`, `reference` |
| `stewardship_tasks` | scheduled stewardship step | `partnerId`, `cadenceKey` (idempotency key), `kind`, `title`, `why`, `dueAt`, `status` (open / done / skipped), `doneAt`, `doneBy`, `note` |

New fields on leads and partners: `introducer`, `introducedVia`, `foundationName`, `parentCompany`; partners also get
`financialYearEnd` and `renewalAt`. A Won lead carries all of these onto the partner record; partner edits sync back.
`introducer` now scores full warmth in the Batch 4 fit model ("introduced by …").

## Org graph

`buildOrgGraph()` collapses leads, partners and candidates into organisation nodes keyed by **registrable domain**
(`website` or email domain; freemail domains are never keys) with a normalised-name fallback. Edges:

- `operates-foundation` — company → foundation, from `foundationName` / `parentCompany` names, or a shared domain
- `works-at` / `introduced` — person → organisation (role `introducer` uses `introduced`)
- `funds` / `considering` — organisation → verified project (Won/partner vs. still in pipeline)
- `pledged` → pledge node → `towards` → project

`neighbourhood(graph, id)` returns one organisation's foundations/parents, people, projects and pledges for the UI.

## Timeline, last touch, health

`timelineFor()` merges: prospect created, research brief, every sent email (first touch + sequence steps), opens /
clicks / bounces / opt-outs, triaged replies, briefings, manual touches, pledges (recorded + received), completed
stewardship tasks and the Won event — newest first. **Last touch** is the most recent genuine interaction (mail,
reply, meeting, call, visit, report, thank-you); opens and clicks are signals, not touches.

`relationshipHealth()`:

| status | rule |
|---|---|
| warm | touched within 30 days, nothing overdue |
| cooling | 31–90 days since touch, or no inbound engagement in 4 months, or a stewardship task overdue |
| cold | > 90 days or no touch ever |
| at-risk | any pledge past its due date without payment recorded |

`GET /api/relationships/:id/timeline.csv` exports the full ledger (audit entry `relationship.timeline_exported`).

## Stewardship cadence (`CADENCE`)

| key | when | why |
|---|---|---|
| `thank-you` | partnerSince + 2d | acknowledge within 48 h, name the introducer |
| `welcome-pack` | + 14d | impact plan + reporting calendar sets expectations |
| `site-visit` | + 60d | seeing the work is the strongest renewal predictor |
| `impact-update:n` | every 91d | traceable progress, spend-to-date, beneficiaries |
| `annual-report:n` | every 365d | spend summary usable in the partner's own B-BBEE / integrated report |
| `renewal:<date>` | renewal anchor − 120d | open the conversation while the next CSI budget is being set, not after allocation |
| `pledge-follow-up:<pledgeId>` | pledge `dueAt` + 7d while unpaid | retired automatically when the pledge is marked received |

Renewal anchor precedence: partner `renewalAt` → earliest future pledge `renewalAt` → last day of the partner's
financial-year-end month (Batch 4 FYE) → partnerSince + 1 year.

`planStewardship()` is deterministic; `reconcileTasks()` inserts only cadence keys that do not already exist, so
`stewardshipTick()` is safe to run on every partner edit, pledge, Won transition, the weekly `/api/cron/data-tick`
and the manual **Schedule stewardship** button. Completing a task writes a `touches` row, so stewardship shows up in
last-touch and the timeline. A manual touch with an agreed next step creates a dated task of its own.

## API

| route | purpose |
|---|---|
| `GET /api/relationships` | summary: partner health counts, stewardship queue (open/overdue/this week), pledge totals, renewals ≤ 120d, graph stats, partners sorted by health then next due |
| `GET /api/relationships/:id` | full view for a lead **or** partner id: health, last touch/inbound, next due, renewal, people (masked email), touches, pledges + totals, tasks, graph neighbourhood, timeline |
| `GET /api/relationships/:id/timeline.csv` | export |
| `POST /api/relationships/:id/people` · `PATCH/DELETE …/people/:pid` | people; role `introducer` backfills the record's `introducer` |
| `POST /api/relationships/:id/touches` | log a touch; optional `nextDueAt` + `nextAction` schedules a task |
| `POST /api/relationships/:id/pledges` · `PATCH …/pledges/:pid` | record / update; `received` retires its follow-up task; partner `amount` becomes the sum of live pledges |
| `POST /api/stewardship/tick` | plan for all active partners (idempotent) |
| `POST /api/stewardship/tasks/:id {action: done|skip|snooze, note?, days?}` | work the queue |

All mutations are audited (`relationship.*`, `stewardship.*`). POPIA: people emails are stored for staff use only,
masked on output, and are never part of any AI or research payload.

## UI

- **Relationships** (formerly Partners): metric strip, stewardship queue with Done / +7d / Skip, partner cards
  showing health, last touch, next due, renewal and pledged·received, sorted by health then next due.
- **Relationship modal** (from a card, the queue, or *Relationship memory* on any prospect): Timeline (with inline
  touch logging), People, Pledges, Stewardship, Org graph; CSV export in the footer.
- Prospect form and partner form capture introducer, how the door opened, foundation / parent links, FYE and
  renewal date.

## Limits / next

- The graph links foundations by name or domain; it does not yet crawl group structures from the web.
- Stewardship tasks are prompts; sending the actual thank-you / report still goes through the human-approved email flow.
- Batch 6 (observability) will surface stewardship SLA and health drift on the single ops dashboard.
