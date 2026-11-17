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
