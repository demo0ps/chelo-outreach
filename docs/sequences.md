# Batch 2 — Follow-up sequences & reply triage

Builds on the Batch 1 send engine (`docs/deliverability.md`). Goal: 42% of replies come from follow-ups, so every first touch becomes a short, in-thread plan that staff approve **once**; any human reply halts the plan before anyone looks at it.

## Sequence plan (`lib/sequences.js`)

| Step | Default timing | Content |
|---|---|---|
| 1 First touch | next free slot after approval | the approved workbench draft (edited in step 4) |
| 2 Follow-up 1 | +3 business days | one approved research fact tied to the matched project |
| 3 Follow-up 2 | +4 business days | a single question (is CSI handled elsewhere? right time of year?) |
| 4 Break-up | +5 business days | polite close, permission to park, opt-out link |

* Follow-ups reuse `Re: <subject>` and are sent with `In-Reply-To` / `References` set to the Message-ID of step 1, so they land in the same thread.
* Scheduling goes through the Batch 1 slot planner (`earliest` → SA business hours, Tue–Thu bias, jitter, mailbox cap/ramp), so a step planned for a Friday send rolls to Tuesday.
* Every follow-up carries the public opt-out link; `List-Unsubscribe` headers remain on every message.
* Staff can toggle steps on/off, change offsets, and edit follow-up subject/body while the plan is `draft`. Any edit changes the plan digest, which voids a first (4-eyes) approval.

### Lifecycle

`draft → pending-approval (4-eyes only) → running → completed | stopped`

* `POST /api/leads/:id/sequence/build` — builds from the lead's draft + approved research + matched project (409 if a plan is running).
* `PATCH /api/leads/:id/sequence` `{steps:[{n, enabled, offsetDays, subject, body}]}` — draft only.
* `POST /api/leads/:id/sequence/approve` `{steps?, confirmSecond?}` — applies last-minute edits, records approval (single or two different signers per workspace policy), queues step 1 and ticks the engine.
* `POST /api/leads/:id/sequence/stop` — cancels queued jobs and remaining steps.
* Automatic advancement happens in the send-engine `onSent` hook: when step *n* is confirmed sent the next enabled step is enqueued for `sentAt + offset business days`. Dead-letter / permanent failure stops the plan.

### Hard stops (no human action required)

| Signal | Effect |
|---|---|
| Human reply (webhook or IMAP) | queued job cancelled, remaining steps `cancelled`, `stoppedReason = Human reply received`, triage item opened |
| Opt-out reply (`unsubscribe`, `remove me`, `stop emailing`…) | as above **plus** immediate workspace-wide suppression, triage auto-handled |
| Hard bounce / dead-letter | plan stopped, suppression per Batch 1 |
| Public opt-out link clicked | plan stopped |
| Staff "Do not contact" / "Mark replied" | plan stopped |
| Auto-reply (OOO, `Auto-Submitted`, `Precedence: bulk`, no-reply sender, "Automatic reply:" subject) | **nothing** — logged as `auto_reply`, not engagement, plan continues |

## Reply triage (`lib/reply-triage.js`)

Rules-first classifier (no AI, nothing leaves the server) over subject + text + headers:

| Bucket | Suggested action | SLA |
|---|---|---|
| interested | reply personally, offer briefing times | 4 h |
| not-now | pause, resurface on the date parsed from the reply (`March 2027`, `in 6 weeks`, `Q1`) | 24 h |
| wrong-person | capture the redirect (name + title parsed from the reply) as a **candidate** linked to the original lead; no email is invented | 24 h |
| opt-out | suppressed immediately, workspace-wide | 1 h |
| automatic | ignored | — |
| unclassified | read and categorise | 8 h |

* `GET /api/triage` returns the open queue sorted overdue-first; the Workbench nav badge and the "Replied · triage" filter use it.
* `POST /api/leads/:id/triage` `{category, redirectName?, redirectTitle?, resumeOn?, note?}` applies the outcome: `interested` → stage Interested + next action; `not-now` → `lead.resumeOn`; `wrong-person` → candidate `{source:'redirect', fromLeadId}`; `opt-out` → suppression; all write `reply.triaged` audit entries.
* Source step/sequence are preserved on the lead (`triage.sequenceStep`) so reply attribution survives.

## UI (Workbench)

* Step 5 is now **Review & approve sequence**: build → per-step timeline with include/offset toggles and editable follow-up copy → *Approve plan & start* (or countersign) → live status per step; single-send remains under a collapsed "Send a single email instead".
* Step 6 shows the **triage card** when a human reply arrives: suggested bucket with confidence, excerpt, SLA countdown (turns red when overdue), redirect/resume inputs pre-filled from the parsed reply, and the five action buttons.
* Workbench lists gain the `Replied · triage` and `In sequence` chips.

## Tests

`tests/sequences.test.js` — planner (timing, digest, stop semantics), classifier (all buckets, header-based auto detection, redirect/resume extraction, SLA), and an end-to-end API run: build → edit → approve → step 1 queued; auto-reply ignored; human reply halts + opens triage; wrong-person → candidate; not-now → resume date; opt-out → suppression.
