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
