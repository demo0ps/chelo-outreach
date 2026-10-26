# Batch 8 — Mobile companion (G8)

Plain responsive web (no PWA, no service worker). On phones (`max-width: 720px`) `public/mobile.js` takes over `renderApp()` and renders a reduced app; desktop (>720px) is unchanged. The breakpoint is live — rotating a tablet switches shells.

## Tabs (bottom bar, badges = items needing a human)
| Tab | Shows | Actions |
|---|---|---|
| **Inbox** | Human replies awaiting triage (overdue first, with SLA), failed/blocked sends, briefing requests | open → triage buckets (reuses `triage-apply`), confirm/decline booking |
| **Approvals** | Sequence plans (draft), 4-eyes countersigns (plan + email), first-touch drafts, research briefs pending | approve plan / countersign / stop (`seq-*`), approve / countersign / reject→draft / queue & send (`email-*`), guardrail issues shown |
| **Leads** | Search across company, person, sector, province, project, stage; status + fit | lead detail: triage card, booking card, sequence panel, draft preview, facts (stage, owner, project, ask, fit, FYE, email, last touch), recent timeline |
| **More** | Notifications (SLA breaches, countersigns, failed sends, paused mailboxes, overdue stewardship), Relationships lite (won partners: health, last touch, next due, pledges, renewal, stewardship queue), Refresh, Sign out | — |

## Hidden entirely on phones
Workbench stepper, Discover, Projects, Pipeline board, Proposals, Analytics, **Ops**, Deliverability, Data quality, Settings, CSV import, research review (citations), editing. Each phone screen says where the desktop-only work lives.

## Implementation notes
- Zero new endpoints: everything reads `state.data` from `/api/init` and `/api/relationships`; actions dispatch through the existing `dispatchAction` handlers (prefix `m-` routes to `mobileAction`).
- `wbSequencePanel()` and `wbTriageCard()` are reused verbatim (restyled under `.m-seq` / `.m-triage`), so approve-once semantics, 4-eyes and triage capture stay identical to desktop.
- Hidden `#email-subject` / `#email-body` fields in the draft card let `email-approve` reuse `getEmailFields()` — the guardrail + HMAC digest therefore see the same text as desktop.
- Safe-area insets, 44px tap targets, sticky header, `100dvh`, toasts lifted above the tab bar.
- Tests: `tests/mobile.test.js` renders all screens in a vm sandbox with `matchMedia` forced to phone and asserts queues, actions and the absence of desktop chrome.
