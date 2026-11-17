# Consolidation before production (2026-10-26)

Goal: one place per job. 17 sidebar sections became 10; four intake doors became one; replies are handled in one place; one import endpoint.

| Job | Before | After |
|---|---|---|
| Add an organisation | Discover page, Workbench step 1, "Add prospect" on Prospects/Pipeline/Overview | **Workbench → Add or discover / Local pool & CSV** (Discover's pool, CSV import and catalogue live in the second tab). Other screens link to the Workbench. |
| Handle a reply | Inbox triage, Workbench triage form, Sent "recorded" column | **Inbox**. Workbench shows "Reply received → Handle in Inbox"; Sent links "Open in Inbox". |
| See all leads | Prospects (table) + Pipeline (kanban) | **Prospects** with a Table ⇄ Board toggle. |
| Dashboards | Overview, Analytics, Ops, Deliverability, Data quality | **Overview** (today's work) + **Ops** with tabs Health · Deliverability · Analytics · Data quality. Engine tabs are root-only; everyone else sees Ops as "Analytics". |
| Approvals | Phone tab only; desktop spread across Workbench/Briefings/Sequences | **Inbox → Approvals** on desktop (drafts, plans, 4-eyes countersigns, research briefs, briefing requests). Same `approvalItems()` feeds the phone tab. |
| Research | Copilot "Web research" tab + Workbench research step | **Workbench research step** only; the copilot keeps Paste-to-Extract. |
| Partners | `partnersView` (dead) + Relationships | **Relationships**. |

## Redirects
Old view names still resolve: `discover → workbench (pool tab)`, `pipeline → prospects (board)`, `analytics|deliverability|data → ops (tab)`. Command palette entries jump straight to the tab. Bookmarks and phone deep links keep working.

## API
- `POST /api/import` — `{ source: 'csv', candidates: [...] }` or `{ source: 'catalogue', limit, verify }`.
- `/api/candidates/import`, `/api/leads/catalogue/import`, `/api/leads/import` remain as aliases for one release and answer with `Deprecation: true` + `Link: </api/import>; rel="successor-version"`.
- Triage (`POST /api/leads/:id/triage`) is the single write path; it now mirrors the decision onto the Inbox conversation via `inbox.onTriage`: opt-out/automatic → resolved, not-now → snoozed until the resume date, wrong-person/interested → event note, stays open.

## Tests
`tests/consolidation.test.js` renders every surviving view, checks redirects, the merged tabs and the root/non-root gating of Ops.

## Preview before send (2026-10-26)

Problem: staff could not read the final email and the PDF together before approving; the review step buried the single-send preview and the PDF lived behind a separate modal.

Research applied (approval UX): *Plan → Preview → Approve*; review in the order the recipient experiences it (from/to/subject → body → links → attachment); show the exact artifact that will be sent, not a reconstruction; one primary action per state; checklists humans can scan.

What shipped:
- `GET /api/leads/:id/preview[?step=N]` returns the message exactly as the send engine will build it — `from` (picked mailbox), `to`, `subject`, `text`, `html` (same `emailHtml()` used for the MIME), every link classified (booking CTA / co-branded page / opt-out), the attachment (when the PDF is attached) or the proposal link, sequence steps, and a pre-flight checklist (recipient, sending mailbox, subject, unfilled placeholders, clear ask, suppression, PDF present).
- **Preview before send** screen (Workbench step 4/5, Inbox → Approvals): email rendered in a sandboxed iframe on the left, the proposal PDF in a viewer on the right (open full size / download), links listed under the email, the checklist along the bottom, and exactly one primary button for the current state — Approve this email / Countersign / Send now / Approve whole plan / Countersign & start sending. Red checks disable approval. "Edit email" jumps to the draft editor.
- Framing policy changed from `DENY` / `frame-ancestors 'none'` to `SAMEORIGIN` / `frame-ancestors 'self'` so the app can frame its own PDF; third-party framing is still blocked.

## Simplify — Release 1 (2026-11-17)

Goal: anyone can see what does what. No engine behaviour changed; only names, statuses and words.

- **Sidebar names:** Inbox · To do (was Workbench) · Today (was Overview) · Funders (was Prospects) · Projects · Briefings · Sent · Partners (was Relationships) · Health (root; "Results" for staff — was Ops) · Settings. **Proposals removed** (`proposals` redirects to Funders; proposals still live on each funder).
- **Three person-facing statuses** everywhere a funder is listed: **Your turn / Working / Waiting on them** (+ Stopped). The engine status stays on hover (`title`) and in Health. `SIMPLE_OF` maps engine → simple; `NEXT_STEP` gives a one-line "what to do now".
- **To do filters:** All · Your turn (default) · Working · Waiting on them · Stopped.
- **4-eyes wording hidden** unless the policy is four-eyes; where it does show it reads "two people must approve" / "Approve as second person". Policy toggle stays in Settings.
- **Plain words:** sequence → "Chelo follows up automatically"; countersign → second approval; triage → "What kind of reply is this?"; error rows say what failed and what to do.
- **Sidebar colour:** `#3f2fc0`, a darker shade of the favicon purple `#5945e8`; brand mark is the favicon colour; secondary text lifted for contrast.
- Tests updated to the new words (71/0). Cache tag `20261026-v32`.

Release 2 (next, after go): funder page becomes three cards — Who they are · What we'll send · one Send button; stepper and plan editor removed; PDF always attached to the first email.

## Simplify — Release 2 (2026-11-17)

The funder page in **To do** is now three cards; the six-step stepper and the editable plan are gone.

1. **Status + one button** (top): the simple status, a one-line "what to do now", and a single button that fits the moment — *Start*, *Looks right — write the email*, *Read & send*, *Approve as second person & send* (4-eyes only), *Send now*, *Stop follow-ups*, *Read their reply in the Inbox*. Small links underneath: *They said yes → Partners*, *Do not contact*.
2. **Who they are**: 3–5 short facts with tick boxes (top 3 findings, 2 alignment points, up to 2 public CSI names), "Where this came from" links, and the project picker. Untick anything wrong → *Looks right — write the email*. Before research exists the card shows the email-address check and, only when something is blocked, the fix buttons.
3. **What we'll send**: To, *Attached: Chelo proposal PDF*, subject and body (editable until sent), one line explaining that Chelo follows up in the same thread and stops when they reply. Once running, the follow-ups show as a read-only list.

`Read & send` builds the follow-up plan if needed and opens the existing *Preview before send* screen; its primary button reads **Send & follow up**.

**PDF always attached (server):** `shouldAttachProposal()` — the first email (single send, approve, countersign, `.eml`, preview and sequence step 1) always carries the proposal PDF; follow-ups only when asked. `ensureProposalPdf()` makes the PDF at approval time if it does not exist yet (needs a chosen project). Pre-flight check reads *Proposal PDF will be attached* when it is not made yet. Covered in `tests/sequences.test.js`.

Follow-up count unchanged (the conversion ladder: first email + 3 follow-ups); the copy states the real number from the plan.

Mobile: the email card shows *Send & follow up* when a plan is drafted; wording updated. Cache tag `20261026-v33`. Tests 71/0.

## Sidebar colour & brand mark (2026-11-17)

- Sidebar locked to **deep indigo** `#2a2470 → #1f1a58` (subtle vertical gradient) — the favicon hue taken deep and quiet. Selected item: soft brand-purple tint `rgba(89,69,232,.48)`; hover: white 7%; captions and the user line in muted lavender `#b9b4e6`; menu text white. Counts: white chip with indigo text. `theme-color` = `#2a2470`. The `?sidebar=` trial switch and `sidebar-compare.html` were removed.
- **Brand tile = the favicon.** Every brand tile (sidebar, login, booking / public pages, phone header) now shows `/brand/chelo-mark.svg` (purple tile with the ring-and-dot) instead of the generic target icon. Text beside it stays "Chelo · Communication Center"; the login screen now says the same. Outbound emails stay plain-text styled (no logo header) on purpose, for deliverability.

## Pool / CSV run the same workflow · Read & send is a page (2026-11-17)

**Problem:** "Add to pipeline" from the local pool or a CSV only created the funder — it never started the check → research → draft workflow that "Add & run" starts, and rows without an email were refused. So nothing was ever drafted for them.

- Every pool/CSV row now has **Add & run** (`POST /api/candidates/:id/promote {run:true}`): the row becomes a funder and the full workflow starts immediately, same as adding by hand. The page jumps to that funder in To do and polls until Chelo is done.
- **Tick boxes + "Add & run selected"** (`POST /api/candidates/promote-run {ids}` → 202): up to 50 rows; promoted at once, flows run two at a time in the background; duplicates are linked to the existing funder, dead addresses and do-not-contact rows are skipped with a plain reason in the toast.
- **No email? Chelo looks first.** `runLeadFlow` now calls the mailbox finder when a funder has no address (published CSI/foundation/info mailbox, verified on the domain). Only if nothing is found does it stop with *"Chelo could not find a published email address for them. Add one…"*. Plain `promote` without `run` keeps the old 409 for API callers.
- **Read before sending is a full-width page** (`state.view = 'review'`, `state.review = { id, step, cache }`) instead of a pop-up: Back button, email left / PDF right, checks + Send pinned at the bottom. Each step's preview is cached, so switching First email ↔ Follow-ups keeps the current content on screen until the new one is ready (no blank flash); background refreshes only re-render when something changed.
- Tests: `tests/workbench-flow.test.js` covers CSV rows with and without email through `promote-run`; `tests/consolidation.test.js` covers the page. 71/0. Cache tag `v36`.
