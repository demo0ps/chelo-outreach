# Batch 7 — Conversion layer (CTA ladder · hosted page · guardrail)

Ships idea-bank items I1, I2, I3, I6, I10, I11. Pure logic lives in `lib/conversion.js`; nothing here needs AI.

## 1. CTA ladder (I1)
`conversion.ladderStep({ step, lead, project, links, slots, staff, reason })`

| Step | Ask | Link | Copy rule |
|---|---|---|---|
| 1 | *"Worth a one-page look?"* (interest) | none (opt-out only) | ≤125 words, one `?`, opener = approved research point or sector, then the **picture** |
| 2 | one-page + 15-min slot | `/p/:token` | "pick a 15-minute slot or reply with a time" |
| 3 | two real slots (Tue 10:00 / Thu 14:00 SAST, ≥2 business days out) | `/p/:token` | timeline ask |
| 4 | graceful close | `/p/:token` | "Closing the loop for now…" |

- `settings.outreachStyle = 'ladder' | 'classic'` (admin, Settings → *Outreach style & guardrail*). Classic keeps the previous booking-link first touch.
- Fallback first-touch drafts (`generateOutreachEmail`) and sequence steps ≥2 (`buildLeadSequence` → `sequences.buildPlan({ ladder })`) use the ladder when enabled. AI drafting, when configured, is unchanged.

## 2. End-state picture (I2)
`project.picture` (≤300 chars, `{{company}}` token) is the one sentence funders read first. If blank, `pictureFor()` composes it from recipient, province and the first verified metric. The funder is always the subject ("…switched on by {{Company}}").

## 3. Hosted partnership page (I3, I10, I11)
- `GET /p/:bookingToken` → SPA; `GET /api/public/page/:bookingToken` (no auth) returns the page model: template + image, headline `"{{Company}} × {{School}}"`, picture, up to 5 numbers (budget, still to fund, first metric, R7m+, 500+), "what you receive", two slots, booking/opt-out paths, expiry.
- A view (not `?preview=1`) records `page_view` (`emailEvents`), `lead.pageViews/lastPageViewAt`, audit `page.viewed` on first view, and lifts warmth to **0.8** in the fit score (`lib/signals.js`).
- Slot buttons POST to the existing `/api/public/booking/:token` with the prefilled date/time; "other time" → `/book/:token`.
- Templates (`public/brand/templates/*.jpg`, generated imagery, no people): `classroom` (default), `construction` (build/sanitation/water…), `ict` (solar/digital/lab…) — `templateFor(project)`.
- **Expiry:** `lead.pageExpiresAt` = 30 days after the last active step's schedule (set when the sequence plan is approved); also expired when DNC or the project gap ≤ 0. Expired pages show the fallback ("now fully funded / page closed → browse live verified projects").

## 4. Persuasion guardrail (I6)
`conversion.lint(text, { project, lead, funding, step })` → `{ ok, blocks, warnings, issues[] }`.

- **Block:** false urgency, manufactured scarcity, guilt framing, unfounded guarantees, implied prior relationship (unless a touch is on file), and **any number not traceable** to the project record (metrics, amounts, Chelo facts 7/500, meeting lengths, numbers already in project text). Dates, years, times, phone numbers and URLs are ignored.
- **Warn:** step 1 > 125 words, more than one question, link in step 1.
- Enforced in `POST /api/leads/:id/approve-email` (first signature) and `POST /api/leads/:id/sequence/approve` (every active step). Blocked → **422** `{ error, guardrail }`. Admin may pass `overrideGuardrail: "<reason>"` → audit `guardrail.overridden`. `settings.guardrail = 'block' | 'warn'`.
- Result stored on `lead.guardrail` for the UI.

## Tests
`tests/conversion.test.js` — template pick, picture, ladder (no link/one question/word count, each step passes its own lint), guardrail (block + allow), page model/expiry, end-to-end API (ladder draft, 422 + override + audit, warn mode, page view event, slot booking, picture round-trip). Classic template smoke test unchanged.
