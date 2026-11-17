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
