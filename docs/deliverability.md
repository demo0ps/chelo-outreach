# Deliverability & sending engine (Batch 1)

The engine moves **already-approved** emails safely. It never composes copy and never sends without a staff approval upstream.

## Components
| Module | Responsibility |
|---|---|
| `lib/domain-health.js` | SPF / DKIM (selector probe) / DMARC / MX checks for the sending domain, with plain-English fixes. Cached 6h, re-checked every 12h by the worker. A `fail` status auto-pauses the mailbox. |
| `lib/send-engine.js` | Mailbox registry (encrypted SMTP credentials), per-mailbox daily caps with week-by-week **ramp**, business-hours window + minimum gap + jitter (Africa/Johannesburg by default), durable SQLite queue (`send_jobs`, `send_attempts`, `delivery_signals`), retry with backoff, error classification (permanent / rate-limited / auth / transient), workspace-wide **suppression gate**, per-mailbox **circuit breaker**. |
| `server.js` | `/api/deliverability/*` routes, `send-email` → queue, hooks that record sent messages / quarantine rejected addresses / log pauses, in-process worker (`SEND_TICK_SECONDS`), `/api/cron/send-tick` for serverless hosts, `List-Unsubscribe` + RFC 8058 one-click headers, open-tracking pixel **off by default**. |

## Lifecycle of one email
1. Staff approve (and countersign if 4-eyes) → **Queue & send**.
2. Gate: do-not-contact / suppression list / verifier `invalid`/`undeliverable` → refused (409).
3. Mailbox selection: active mailbox with the most remaining capacity today (or the one requested).
4. Slot: next time inside the window on an allowed day, after the last scheduled send + gap + jitter, respecting today's effective cap (ramp-aware). Spills to the next allowed day when full.
5. Worker: claims due jobs, re-checks suppression and cap, sends over SMTP with `List-Unsubscribe` headers.
6. Outcomes: `sent` → message recorded, lead status *Sent*; `5xx`/user-unknown → `dead`, lead quarantined (`mailboxCheck: undeliverable`), hard-bounce signal; auth failure → mailbox paused, job `held`; transient → retry (1m, 5m, 30m, 2h, 6h) then `dead`.
7. Breaker (7-day window per mailbox): hard-bounce ≥ 2 %, complaint/unsubscribe ≥ 0.1 %, soft-bounce ≥ 8 % (after 20 attempts), or ≥ 2 hard bounces at ≥ 20 % early on → mailbox **auto-paused**. Staff resume explicitly.

## Operating guidance
* Keep Google Workspace / Microsoft 365 mailboxes at 20–40 cold sends/day; add mailboxes instead of raising caps.
* Ramp defaults: 5 → 10 → 15 → 20 per day for weeks 1–4, then the configured cap.
* Fix every `needs-work`/`fail` on SPF, DKIM, DMARC before sending; the card tells you the exact record to publish.
* Replies are the health metric; opens are off by default (pixel hurts placement and is a POPIA grey area).
* Serverless hosts (Vercel) have no background worker: due jobs are attempted on the sending request, on **Process queue now**, or via the daily cron (`CRON_SECRET`). Use the Docker deployment for real scheduled sending.
