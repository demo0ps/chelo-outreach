# Batch 4 — Signals v1 + fit score

South African CSI is predictable: budgets of roughly 1 % of NPAT (the B-BBEE SED target) are planned in the months before a company's financial year-end and allocated in the first quarter after it. So v1 trusts exactly one signal — the **financial year-end (FYE)** — and turns it into a deterministic approach window. No watchlists, no AI; everything in `lib/signals.js` is pure and explainable.

## FYE capture
* `lead.financialYearEnd` (1–12) with `fyeSource` = `staff` | `research`. Set in the lead form, inline in Workbench step 3, or via `PATCH /api/leads/:id {financialYearEnd}`.
* **Inferred from research**: the researcher scans fetched public pages (official pages first) for "year ended 30 June", "financial year-end: February", "FY ending 31 Mar", "twelve months ended 31 December" and stores `brief.signals.financialYearEnd` with the evidence sentence and source URL. If the lead has no FYE yet it is applied (`fyeSource:'research'`, `fyeEvidence`) and audited; staff see "inferred — confirm or correct".

## Approach window — `approachWindow(month, now)`
| Phase | When (relative to FYE) | Score | Meaning |
|---|---|---|---|
| budgeting | 5 → 2 months before | 1.00 | next year's CSI budget being set — best time to pitch |
| closing | last ~2 months | 0.55 | books closing; pitch for the new year |
| allocation | 1 → 3 months after | 0.85 | new budget live, unallocated funds decided |
| mid-year | otherwise | 0.35 | budget committed; build the relationship |

Also returns the budgeting/allocation date ranges and `daysToNextBudgeting` for "opening soon" nudges. Explicit `grantWindowOpenMonth/CloseMonth` on a record override the FYE heuristic.

## Fit score — `fitScore(lead, {project, events, bookings})`
Five factors, each 0–1 with a human-readable reason, combined as a **weighted geometric mean** (sector 30 % · window 25 % · warmth 20 % · province 15 % · SED 10 %) so a weak factor drags the whole score down — that's the "×" in sector × province × SED × window × warmth.

* **sector** — matched project vs funder sector / approved research focus areas (education gets full marks: 91 % of SA CSI funders support it).
* **province** — project province vs funder footprint (research text, `province`, `footprint`); national footprint 0.8; unknown 0.65.
* **SED** — for-profit funder + verified project → 1.0 (counts towards SED); foundations/trusts 0.8.
* **window** — the approach window above (unknown FYE = 0.5).
* **warmth** — partner / warm intro 1.0 → briefing booked 0.95 → replied 0.9 → graph-known contact 0.75 → opened 0.65 → research approved 0.55 → cold 0.45.

Output: `score` 0–100, `band` strong/good/fair/weak, per-component scores + reasons, `weakest` / `strongest` driver. Attached to every lead as `lead.fit`; `GET /api/signals` returns totals, phase counts, `inWindow`, `openingSoon` (≤45 days), `missingFye` and the ranking.

## UI
* Workbench list is **ordered by fit & timing by default** (toggle to Recent); each row shows the fit pill and window chip.
* Step 3 (*Match project · fit & timing*): five factor bars with reasons, FYE selector (shows research evidence when inferred), and the window timeline with budgeting/allocation dates.
* Overview gains **Approach windows**: in-window funders ranked by fit, and windows opening within 45 days.

## Tests
`tests/signals.test.js` — phase boundaries for every month, date ranges and next-opening maths, FYE inference patterns and false-positive guard, fit-score ordering/weakest-driver behaviour, staff grant-window override, and an API run (FYE on create / PATCH / invalid clear, window change, `/api/signals` grouping, `fit` on every lead).
