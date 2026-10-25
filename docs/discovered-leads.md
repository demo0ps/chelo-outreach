# Discovered leads — SA CSI funder catalogue (Batch 5.5)

A curated, organisation-level catalogue of South African CSI / SED funders that staff can load into the pipeline in one click, with every organisation's domain verified on the way in and duplicates linked rather than copied.

## What is in the catalogue
- `lib/discovered-leads.js` — catalogue `sa-csi-2026`, ~330 rows: JSE-listed companies, corporate foundations and trusts, banks/insurers/miners/retailers/telcos/energy IPPs, large private groups and a few family foundations with public CSI programmes.
- Per row: organisation, website, sector, province (head office / main footprint), typical financial year-end month, CSI focus (→ `partnerPriorities`), foundation name / parent company (→ org graph), tier (→ suggested ask) and a short note.
- Each row is mapped to one of the six verified Chelo projects (solar classrooms GP, literacy WC, WASH EC, STEM KZN, ECD LP, youth employability ZA) by focus and geography.
- **No personal data**: no names, emails or phones. Contacts are found afterwards through the research brief and the public-contact waterfall (Batch 3), which only surfaces public CSI/foundation leadership names and titles.

### Honesty notes
- Rows were compiled from general knowledge of the SA CSI landscape, not scraped live. Focus areas and FYE months are "typical" and are flagged `confirm current CSI focus` in notes and `fyeEvidence: catalogue … confirm`. Staff should confirm via the research brief before drafting.
- "Verified" means the organisation's **domain** is live (MX or A/AAAA record found) — it does not mean a contact or mailbox was verified.

## API
| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/leads/catalogue` | totals, imported, remaining, verification counts, per-project breakdown, contacts still needed |
| `POST` | `/api/leads/catalogue/import` `{limit?=60, verify?=true}` | import the next `limit` unimported rows; dedupes against hand-entered leads/candidates/partners; runs domain verification (8 concurrent) |
| `POST` | `/api/leads/catalogue/verify` `{limit?=60}` | re-run domain verification for imported rows still `retry`/unchecked |

Import semantics:
- Idempotent: rows are keyed by `catalogKey`; re-running never duplicates.
- Exact duplicate against an existing hand-entered lead (same registrable domain + similar name) → the existing lead is **linked** (`catalogKey`) and only blank fields are filled (website, province, FYE, focus, project link). Staff data is never overwritten.
- Same-domain siblings inside the catalogue (e.g. Sasol / Sasol Foundation) are intentional; the relationship graph collapses them into one organisation node.
- Imported leads: stage `New`, `contactCheck.status = needs-clarification` (missing contact name + work email), `discovered: {source:'catalogue', batch, importedAt, importedBy}`, `orgCheck: {status: verified|invalid|retry, method, reason, domain, checkedAt}`.
- Fit score and approach window (Batch 4) and relationship graph (Batch 5) work immediately because FYE, province, sector and project are populated.
- `POST /api/leads/import` still returns 409 — the catalogue importer is the single sanctioned bulk path because every row is organisation-level and pre-mapped.

## UI
Discover → "Discovered funders · SA CSI catalogue" panel: progress bar, counts (in pipeline, verified, dead, pending, need contact), per-project chips, **Load N discovered funders** (loops in batches of 40 with live progress, so it fits Vercel's 60 s function limit) and **Verify pending**. Workbench rows and lead detail show an `Org verified` / `Domain dead` / `Org check pending` pill.

## Recommended flow after loading
1. Workbench default order already ranks by fit (approach window from FYE).
2. For top-ranked rows: run the research brief (confirms focus, surfaces public CSI lead names) → waterfall for a published CSI mailbox → verification → draft → 4-eyes → sequence.

## Tests
`tests/catalogue.test.js` — catalogue integrity (≥200 rows, unique keys, no PII, valid project links, FYE ranges, all six projects covered) and an end-to-end import run (dedup-link against an existing lead, batch continuation, idempotency, verification endpoint never crashes without DNS, fit computed, org graph merges siblings, signals ranking populated).

## Published-mailbox finder (Batch 5.6)
`lib/mailbox-finder.js` fills the email gap without ever touching personal data:
1. Crawls up to 8 pages on the organisation's **own** domain (`/`, `/contact`, `/contact-us`, `/csi`, `/corporate-social-investment`, `/foundation`, `/sustainability`, `/about-us`, …) using the same SSRF-guarded fetcher as research (raw HTML, so footers/`mailto:` links count; `[at]`/`%40` obfuscation decoded).
2. Keeps only **role-based** local parts on the org's own domain — priority: `csi@/csr@/sed@/community@` (1.0) → `foundation@/trust@/grants@/sponsorship@/partnerships@` (0.95) → `sustainability@/corporateaffairs@/communications@` (0.8) → `info@/enquiries@/contact@` (0.6). `media@/press@/careers@/noreply@` are listed but never selected. Anything that looks like `first.last@` or `j.surname@` is **discarded before storage**.
3. If nothing is published, it tries pattern guesses `csi@`, `foundation@`, `info@` — these are only auto-used when the mail server positively confirms them (SMTP `deliverable`); otherwise they are listed as "unconfirmed" for staff to pick.
4. Every candidate is verified (MX + SMTP where port 25 is open). `invalid`/`undeliverable` are shown as dead and cannot be selected.
5. On success: `lead.email`, `contactName = 'CSI / Social Investment team'` (or `<Foundation> team`), `contactKind = 'generic-mailbox'`, `contactSource = {kind: published-mailbox | pattern-verified-mailbox, sourceUrl, verification}`, `contactLastVerifiedAt`, and the intake `contactCheck` is recomputed so the lead becomes draft-ready. Audit entry `lead.mailbox_found` (address masked).

Endpoints: `POST /api/leads/catalogue/mailboxes {limit≤40}` (bulk, 4 concurrent; the UI loops in batches of 10), `POST /api/leads/:id/find-mailbox`, `POST /api/leads/:id/use-mailbox {email}` (staff pick one of the listed candidates). The daily cron tick (`/api/cron/data-tick`) also searches 8 outstanding organisations per run, so on a persistent host the catalogue fills itself over a few weeks. `mailboxSearch.status`: `published | pattern-verified | unconfirmed | none-published | unreachable` (unreachable retries after 24h).

UI: Discover panel → **Find mailboxes (N)** with live progress and counts (found / none published / still to search); Workbench step 1 → **Find published mailbox** button and a candidate list with **Use this**.

Limits: it only finds what organisations publish. Expect roughly a third to half of SA corporates to publish a generic CSI/foundation/info mailbox; the rest need the waterfall (public CSI lead name + title) and a staff-entered public address.
