# Chelo Idea Bank

Living register of every idea raised in discussion or found in research — ours, the market's, the community's.
Nothing is built from here without a "go"; nothing is deleted, only re-statused. Co-thinking space.

**Status legend:** `seed` (raw) · `shaping` (being discussed) · `ready` (specified, awaiting go) · `building` · `shipped` · `parked` (with reason) · `rejected` (with reason)

**How we run it (agreed 2026-10-25):** lives here in the repo; I file ideas as we talk (yours, mine, the market's) and
update statuses every turn. I present candidates with scores; **you choose** what gets built. Two lanes:
`Now` = buildable on this stack within ~12 months; `Horizon` = moonshots that shape architecture but aren't scheduled.

**Scoring (1–5 each):** Impact on winning CSI partnerships · Ahead-of-market · Effort (5 = tiny) · POPIA/safety risk (5 = none)

---

## A. Deliverability & sending

| # | Idea | Source | Status | I / A / E / S | Notes |
|---|------|--------|--------|---------------|-------|
| A1 | Inbox-placement seed test before a mailbox goes live (send to a panel of own Gmail/Outlook/Microsoft 365 seeds; read where it landed via IMAP) | Amplemarket 2026 feature matrix; Reddit "domains tank after 3 weeks" | seed | 4/4/3/5 | Only Saleshandy/Amplemarket/Smartlead add-on have it. We own the seeds — no shared pool. |
| A2 | Adaptive send pacing: slow a mailbox automatically when reply/bounce ratio drifts, not only hard breaker | r/coldemail "adaptive logic when Gmail tweaks filters" | seed | 4/4/3/5 | Extends Batch 1 breaker into a continuous controller. |
| A3 | Reply-rate as health signal: mailboxes with 0 replies over N sends get paused for review ("doom loop" guard) | r/b2bmarketing 2026 deliverability thread | seed | 3/4/4/5 | |
| A4 | Domain-health drift alerts (re-check SPF/DKIM/DMARC daily, alert on change) | Amplemarket; our Batch 1 does check-on-demand | seed | 3/3/4/5 | Cron already exists. |
| A5 | Send-time per funder from their own reply timestamps (learned, not assumed Tue–Thu) | our discussion | seed | 3/4/3/5 | |

## B. Sequences, replies, triage

| # | Idea | Source | Status | I / A / E / S | Notes |
|---|------|--------|--------|---------------|-------|
| B1 | Reply SLA with escalation to a second staff member when the first misses the deadline | 1M-email operator: "fast human replies = 3× meetings" | seed | 4/3/4/5 | Builds on Batch 2 SLA timer. |
| B2 | "Wrong person" redirect auto-creates a draft to the named person — only if that person is a published role contact | Batch 2 triage | shaping | 4/4/3/4 | POPIA: must be a public role, never scraped. |
| B3 | Out-of-office date parsing → auto-reschedule next step after return date | norbelys triage guide | seed | 3/3/4/5 | |

## C. Data engine & discovery

| # | Idea | Source | Status | I / A / E / S | Notes |
|---|------|--------|--------|---------------|-------|
| C1 | Quarterly catalogue refresh keyed to annual-report / Trialogue season so the 336 don't rot | our market review 2026-10-25 | seed | 4/3/3/5 | |
| C2 | Integrated/ESG report ingestion: pull CSI spend, focus areas, flagship programmes from public PDFs into the brief | Batch 3 waterfall | shaping | 5/5/2/4 | Organisation data only; no PII. Huge differentiator vs static lists. |
| C3 | B-BBEE certificate / SED spend as a signal of budget size | Trialogue (CSI ≈ 1% NPAT via SED) | seed | 4/5/3/5 | Public certificates only. |
| C4 ⟶Horizon/Now | Partner graph: who funds whom (from public annual reports) → "funders of orgs like us" | Clay waterfall reviews; our Batch 5 graph | seed | 5/5/2/5 | |
| C5 | Community-contributed corrections to the catalogue (staff mark mailbox dead/alive; shared across workspaces later) | r/nonprofit "duplicate-laden imports kill adoption" | seed | 3/3/3/5 | |

## D. Signals & timing

| # | Idea | Source | Status | I / A / E / S | Notes |
|---|------|--------|--------|---------------|-------|
| D1 | Financial-year-end approach windows (shipped Batch 4) | Trialogue | shipped | | |
| D2 | Watchlist signals: new CSI head appointed, foundation launched, results announcement | parked in B4 decision | parked | 4/4/2/4 | Parked by user until core engine proves out. |
| D3 | Tender/RFP-style CSI calls (e.g. IDC CSI window Apr–Aug) as dated signals | grantedai listing | seed | 4/3/4/5 | |

## E. Relationship memory & stewardship

| # | Idea | Source | Status | I / A / E / S | Notes |
|---|------|--------|--------|---------------|-------|
| E1 | Impact-report cadence: auto-draft quarterly impact updates for won partners from project data | Batch 5 stewardship | seed | 5/4/3/5 | Retention beats acquisition; Bloomerang's whole pitch. |
| E2 | Pipeline forecasting by window phase (expected R value per quarter) | r/nonprofittech "no CRM does pipeline" | seed | 4/4/3/5 | |

## F. AI (cherry on top)

| # | Idea | Source | Status | I / A / E / S | Notes |
|---|------|--------|--------|---------------|-------|
| F1 | Draft critique, not draft generation: AI scores a human draft for specificity/length/asks before approval | operators: "AI copy performs worse than human" | seed | 3/4/4/5 | PII-masked input already exists. |
| F2 | Research brief freshness diff: what changed since last brief | Batch "research" | seed | 3/4/4/5 | |

## G. Platform, safety, ops

| # | Idea | Source | Status | I / A / E / S | Notes |
|---|------|--------|--------|---------------|-------|
| G1 | Hardening batch: CSP/HSTS/frame-ancestors headers; SameSite=Lax on own domain; stop uploading `.settings-key` (env authoritative); bucket snapshot history (7 daily) | security review 2026-10-25 | ready | 4/2/4/5 | Awaiting go. |
| G2 | TOTP MFA for admins + "sign out everywhere" | security review | seed | 3/2/3/5 | |
| G3 | API-wide rate limiting (not only login) | security review | seed | 2/2/4/5 | |
| G4 | Privacy notice text covering cross-border hosting (s72 POPIA) | security review | seed | 3/1/5/5 | Document, not code. |
| G5 | Ops dashboard (shipped Batch 6) | | shipped | | |
| G8 | **Mobile companion mode**: a reduced phone layout (not the full desktop workbench) for the day-to-day essentials — see replies & triage, approve/reject drafts and plans, view a lead/relationship, Ops glance, notifications. Desktop keeps the advanced flow. | user 2026-10-25 | shaping | 4/3/2/5 | Current state: desktop-first; sidebar/topbar lack phone layout; only panel-level breakpoints exist. Scope questions open. |
| G7 | Chelo logo as platform favicon / brand assets (`public/brand/chelo-mark.svg`, lockup PNG) | user 2026-10-25 | shipped | | Logo file supplied by user; mark rebuilt as crisp SVG. |
| G6 | Self-host option on a R‑priced SA VPS (data residency, always-on worker, no cron limits) | deployment reality notes | seed | 3/3/3/5 | `npm start` already works; needs a one-page runbook. |

## H. Product / positioning

| # | Idea | Source | Status | I / A / E / S | Notes |
|---|------|--------|--------|---------------|-------|
| H1 ⟶Horizon | Multi-NGO workspaces sharing the funder catalogue (network effect; each NGO's pipeline private) | our discussion | seed | 5/5/1/3 | Big architectural step; POPIA boundaries per tenant. |
| H2 ⟶Horizon | Funder-side view: a corporate CSI team logs in to see verified projects seeking partners (two-sided) | Verified Projects catalogue | seed | 5/5/1/4 | Flips the model from outreach to marketplace. |

## I. Message psychology & conversion (raised by user 2026-10-25: "small email that gets them off guard → clickable CTA → paint the end point")

**Evidence filed:** 304K-email study: interest-based CTAs 12% reply vs 7% for meeting asks; 68% vs 41% positive (growleads 2026). Saleshandy 30M: one soft CTA = +78% positive replies; multiple CTAs worst. Length sweet spot 50–125 words; CTA in last sentence +22%. Gong: offer CTA +28%, meeting ask −44%. Timeline CTA ("worth 15 min this week?") 2.34% meetings vs 0.69% problem-based (Digital Bloom) — i.e. meeting asks work *later* in the ladder. Behavioural science: identifiable victim / **identified intervention effect** — tangible, concrete details of the intervention and one named place/person raise giving (Cryder & Loewenstein; "The donor is in the details"). Vividness = emotionally interesting + concrete imagery + psychologically proximate.

| # | Idea | Source | Status | I / A / E / S | Notes |
|---|------|--------|--------|---------------|-------|
| I1 | **CTA ladder per sequence**: step 1 interest ("worth a look?") → step 2 offer (one-page partnership pack) → step 3 timeline ask (15 min, 2 slots) → step 4 graceful close. One CTA per email, last sentence. | user + 304K/30M studies | shaping | 5/3/4/5 | Fits Batch 2 sequences; templates need the ladder baked in. |
| I2 | **End-state picture slot**: every first touch carries one concrete, place-named outcome from the Verified Project ("by March, 140 Grade-R learners in Seshego start the day with a working solar classroom") — identified-intervention effect, not statistics. | user + Cryder/Loewenstein | shaping | 5/4/3/5 | Data already in Verified Projects catalogue; add a required "picture" field + draft critique check. |
| I3 | **Hosted one-click partnership page + booking** (our domain): the "button" lives on a tiny page, not in the first email; page shows the picture, the ask, 2 meeting slots, .ics. Keeps first touch plain-text (deliverability), satisfies the clickable-CTA instinct from step 2 onward. | user + plain-text-first (B1) | shaping | 5/4/3/5 | Tracks click as warm signal → fit score (Batch 4 warmth). |
| I4 | **Message experiments engine**: A/B CTA wording, subject, picture variant per sector; auto-promote winner after N sends with significance guard; results feed draft templates. | our discussion | seed | 4/4/2/5 | Small volumes → use Bayesian/Thompson rather than fixed splits. |
| I5 | Plain-text vs HTML-button first-touch test on our own domain health (measure placement + reply) | user vs deliverability research | seed | 3/3/4/5 | Decide with data, not opinion. |
| I6 | **Persuasion guardrail (ethics linter)**: approval blocks false urgency, fake scarcity, guilt framing, invented numbers; allows vividness, specificity, reciprocity (offer first). Reputation is the long-term reply rate. | our discussion | shaping | 4/5/4/5 | "Ahead of market" = trusted sender, not tricked reader. |
| I7 | **Dual framing for CSI managers**: emotional picture + instrumental line (B-BBEE SED points, reporting pack, visibility) in one email — they buy with the heart but justify to the board. | Trialogue + our discussion | shaping | 5/4/4/5 | |
| I9 | **Chelo as traceability layer** positioning: pitch = de-risked CSI spend with automatic impact report (Verified Recipients · Traceable Transactions · Impact Reports, from cheloapp.com), not charity ask. Funder is grammatical hero of the picture. | cheloapp.com + user decision 2026-10-25 | shaping | 5/5/4/5 | Draft ladder in docs/message-ladder-v1.md. Decisions: meeting at step 2; funder = hero via co-branded pictures; named staff mailboxes; Chelo-hosted booking; instrumental line = direct-to-supplier + milestone sign-off (cheloapp.com/how-it-works). |
| I10 | **Co-branded picture generator**: per funder, a photo of the project with a navy→indigo gradient panel, typography "{{Company}} × {{School}}", one-line picture, Chelo wordmark. Used on hosted page (I3), impact report, partner comms. Concept chosen 2026-10-25: docs/assets/cobrand-concept.png. **Decisions:** generated imagery for now (no real children until consent process exists); appears on the hosted page only (never in email); typography-only "{{Company}} ×" (no funder logo before signature); **3 templates** matched to cheloapp.com categories — classroom/renovation, construction, ICT — auto-picked by project type. | user | ready | 4/4/3/4 | Spec complete; awaiting go with I1/I2/I3/I6. |
| I11 | Hosted page **expires** (default 30 days after last ladder step, or when project fully funded) with a fallback: "this project is now funded — see what {{Company}} could do next" (second conversion chance). | user 2026-10-25 | ready | 4/4/4/5 | Part of I3. |
| I8 | Forwardable internal-approval pack generated per funder (one page, their language, our numbers) — makes the CSI manager our champion inside. | user hypothesis 4 | seed | 5/5/2/5 | Pairs with I3. |

---

## Rejected / parked (with reasons)
- Shared warm-up pools / rented inboxes — rejected 2026-10-25: Reddit consensus 30–40% open-rate drops; reputational risk; not needed at our volume.
- Paid email-finder providers (Hunter/Apollo-style) — rejected 2026-10-25: cost + POPIA (named individuals' emails); generic published mailboxes only.
- Open-tracking pixels by default — rejected Batch 1: privacy + deliverability.
- LinkedIn/multichannel — parked: email-centric by decision.
