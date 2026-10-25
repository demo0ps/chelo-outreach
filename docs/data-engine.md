# Batch 3 — Data engine

Bad data is the silent killer of outreach: duplicates embarrass staff, dead mailboxes burn sender reputation, and "who do we even write to?" stalls the workbench. Batch 3 puts identity resolution, freshness and a public-contact waterfall underneath everything (`lib/data-engine.js`, pure + unit-tested).

## 1. Identity resolution at ingest

Every record entering the workspace — Workbench add, web discovery add, CSV import, candidate promotion — is compared against pipeline, Discover and Partners **before** it is saved.

| Signal | Score | Level |
|---|---|---|
| same email address | 1.00 | exact |
| same registrable domain (`co.za`/`org.za` aware; freemail ignored) + similar name | 0.95 | exact |
| identical normalised name, nothing to disambiguate | 0.93 | exact |
| identical name but different corporate domains (Sasol vs Sasol Foundation) | 0.85 | likely |
| same domain, different name | 0.70 | likely |
| fuzzy name ≥ 80 % (Dice bigrams + token Jaccard + edit distance; legal suffixes stripped) | 0.75–0.85 | likely |
| fuzzy name ≥ 70 % | 0.63 | likely |

* **exact** → `409 {code:'duplicate', duplicates:[…]}`. The Workbench shows the match and offers *Add anyway*; the override (`allowDuplicate:true`) is still queued for review.
* **likely** → the record is created and a **merge review** is opened (`merge_reviews` table, additive migration).
* CSV import keeps its row-level exact checks and now queues fuzzy hits per imported row (`mergeReview:true` in the report).

### Merge-review queue — `GET /api/data`, `POST /api/data/merge-reviews/:id {action, primaryId?}`

* `merge` — primary = explicit choice, else the record that has been worked (sent / sequence / partner / research), else the older one. Empty fields on the primary are filled from the duplicate (`mergedFrom[]` records what was filled), notes are appended, email events / bookings / promoted candidates are re-pointed, the duplicate is removed. Candidates can never absorb a pipeline record.
* `keep` / `dismiss` — both records stay; the pair will not be re-queued.
* Every decision writes `data.merged` / `data.merge-review.*` audit entries.

## 2. Freshness & data quality

`dataQuality(record)` (attached to every lead as `lead.dataQuality`):

* **Freshness** (0–100): mailbox verification recency 55 %, research recency 25 %, last touch 20 %. Labels `fresh ≥70`, `ageing ≥40`, `stale`. Verification older than **90 days** (or never) sets `reverifyDue`.
* **Completeness**: company, contact, title, email, website, sector, province, source URL, project.
* **Verification**: deliverable 100 · catch-all 70 · unknown 50 · retry 40 · dead 0.
* Score = 40 % freshness + 30 % completeness + 30 % verification → grade A/B/C/D. Shown in Workbench step 1 and the new **Data quality** page.

**Automatic re-verification** — `POST /api/data/reverify {limit}` and the weekly cron `GET /api/cron/data-tick` (`CRON_SECRET`, Mondays 04:30 UTC) re-run MX + SMTP checks on the oldest due mailboxes. A mailbox that has gone dead is suppressed, its running sequence is stopped and the flow is marked dead. Demo records are excluded.

## 3. Public-contact waterfall — `POST /api/leads/:id/waterfall`

Four rungs, each with its own confidence; evidence across rungs compounds (`1 − Π(1 − c)`):

| Hop | Source | Confidence |
|---|---|---|
| site | `/csi`, `/foundation`, `/sustainability`, `/transformation`, `/leadership`, `/about`… on the company domain | 0.80 |
| reports | integrated / CSI / B-BBEE report pages via the configured search provider | 0.70 |
| leadership | public leadership/news pages via search (official domain 0.70, third party 0.55) | 0.55–0.70 |
| graph | people already on your own records with the same registrable domain | 0.90 |

Only CSI / foundation / sustainability / transformation / SED / corporate-affairs roles (plus CEO / chair / trustee) are kept; CFOs, COOs and navigation text are discarded. Text is PII-scrubbed **before** extraction, so emails and phone numbers are never stored. Hops that cannot run (no website, no search key) are reported as `skipped` with the reason, so staff see exactly what was and wasn't checked.

Staff decide per person — `POST /api/leads/:id/contact-leads {id, action: accept|candidate|reject, replace?}`:
* **accept** → becomes the record's contact (`contactSource` keeps hops/confidence/sources); refuses to overwrite an existing contact unless `replace:true`.
* **candidate** → a Discover candidate with `source:'waterfall'`, empty email.
* **reject** → remembered so a re-run doesn't resurface the person.

## UI

* **Workbench step 1**: data grade pill, re-verify flag, freshness/completeness reasons, *Find public contacts* button and the waterfall panel (hop chips + per-person actions).
* **Data quality** page (sidebar, sky tile): average score, re-verify due, stale/incomplete, merge reviews; the merge queue with Merge / Keep both / Dismiss; a "needs attention" list sorted by lowest score; *Re-verify stale now*.
* Workbench add form handles the 409 with an *Add anyway* confirmation.

## Tests

`tests/data-engine.test.js` — domain/name/dedup/merge rules; freshness & grading; the waterfall with stubbed fetch/search (confidence compounding, role filtering, PII exclusion, skipped hops); and an API run covering block → override → review → merge, discovery block, graph-hop waterfall + accept/candidate, stale re-verification via the cron endpoint after ageing the stored check.
