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
| G6 | Self-host option on a R‑priced SA VPS (data residency, always-on worker, no cron limits) | deployment reality notes | seed | 3/3/3/5 | `npm start` already works; needs a one-page runbook. |

## H. Product / positioning

| # | Idea | Source | Status | I / A / E / S | Notes |
|---|------|--------|--------|---------------|-------|
| H1 ⟶Horizon | Multi-NGO workspaces sharing the funder catalogue (network effect; each NGO's pipeline private) | our discussion | seed | 5/5/1/3 | Big architectural step; POPIA boundaries per tenant. |
| H2 ⟶Horizon | Funder-side view: a corporate CSI team logs in to see verified projects seeking partners (two-sided) | Verified Projects catalogue | seed | 5/5/1/4 | Flips the model from outreach to marketplace. |

---

## Rejected / parked (with reasons)
- Shared warm-up pools / rented inboxes — rejected 2026-10-25: Reddit consensus 30–40% open-rate drops; reputational risk; not needed at our volume.
- Paid email-finder providers (Hunter/Apollo-style) — rejected 2026-10-25: cost + POPIA (named individuals' emails); generic published mailboxes only.
- Open-tracking pixels by default — rejected Batch 1: privacy + deliverability.
- LinkedIn/multichannel — parked: email-centric by decision.
