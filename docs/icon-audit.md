# Icon coverage audit — resumable log

Goal (user, 2026-10-25): every button & action across the whole site gets a duotone icon; fix blank/old-style icons; Chrome desktop.
Rule: tick items here as they are done. On "go", resume from the first unticked item. Verify with `node /tmp/audit-icons.js` (regenerates list) → target 0 remaining.

## Phase 0 — new glyphs needed
- [x] refresh, copy, trash, back (arrow-left), x-circle (decline/reject), ban (do-not-contact), key (rotate secret), save, users-cog (staff), flag/won (trophy), kanban, filter, list-check

## Phase 1 — automated pass (data-action → icon map), app.js

### navItem
- [x] L254 · ? · ""

### renderMobileMoreMenu
- [x] L304 · mobile-more-close · "×"

### demoBanner
- [x] L321 · dismiss-demo · "×"

### overviewView
- [x] L349 · open-lead · "View"
- [x] L355 · follow-up · "Draft"
- [x] L366 · ? · "Open Kanban →"
- [x] L370 · ? · "View prospects"
- [x] L373 · ? · "See all →"
- [x] L374 · ? · "Manage →"

### leadTableRows
- [x] L392 · create-outreach · "Prepare"
- [x] L392 · open-lead · "Details"

### discoverView
- [x] L418 · promote-candidate · "Add to pipeline"
- [x] L420 · candidate-recheck · "{…}"
- [x] L421 · candidate-review · "Complete details"
- [x] L422 · open-lead · "Open pipeline record"
- [x] L422 · candidate-review · "Edit details"

### sentView
- [x] L462 · mark-replied · "Mark reply"
- [x] L462 · open-lead · "Details"
- [x] L463 · ? · "Review candidates"

### bookingsView
- [x] L482 · open-lead · "Prospect"
- [x] L482 · confirm-booking · "Confirm & send invite"
- [x] L482 · decline-booking · "Decline"
- [x] L482 · complete-booking · "Complete"

### partnersView
- [x] L495 · edit-partner · "Edit"
- [x] L500 · ? · "Open pipeline"

### proposalsView
- [x] L506 · create-proposal · "{…}"
- [x] L506 · copy-proposal-link · "Copy secure link"
- [x] L506 · email · "Draft email"

### modalFrame
- [x] L618 · close-modal · "×"

### leadFormModal
- [x] L647 · close-modal · "Cancel"
- [x] L647 · submit · "{…}"

### candidateReviewModal
- [x] L668 · close-modal · "Cancel"
- [x] L668 · submit · "Save and check again"

### candidateImportReportModal
- [x] L681 · close-modal · "Done"

### candidateCsvPreviewModal
- [x] L714 · csv-select-clean · "Select clean rows"
- [x] L714 · csv-clear-selection · "Clear selection"
- [x] L717 · csv-preview-cancel · "Cancel"
- [x] L717 · csv-import-confirm · "Import {…} selected to Discover"

### leadDetailModal
- [x] L728 · opt-out · "Do not contact"
- [x] L736 · open-project · "View funding gap"
- [x] L743 · close-modal · "Close"
- [x] L743 · mark-won · "Mark as won"
- [x] L743 · ? · "View partner"

### proposalModal
- [x] L768 · proposal-rewrite · "{…}"
- [x] L770 · close-modal · "Cancel"

### outreachModal
- [x] L790 · close-modal · "Cancel"

### emailModal
- [x] L971 · create-proposal · "Edit PDF"
- [x] L972 · create-proposal · "Edit PDF"
- [x] L972 · create-proposal · "Prepare for later"
- [x] L985 · email-return · "Return to draft"
- [x] L988 · email-save-draft · "Save edits"
- [x] L990 · email-save-draft · "Save draft"
- [x] L992 · email-return · "Return to draft"

### partnerModal
- [x] L999 · close-modal · "Cancel"
- [x] L999 · submit · "Save partner"

### renderPublicOptOut
- [x] L1614 · public-opt-out · "Stop further outreach"

### projectsView
- [x] L1770 · open-project · "Details"

### projectFormModal
- [x] L1794 · delete-project · "Remove"
- [x] L1794 · close-modal · "Cancel"
- [x] L1794 · submit · "{…}"

### projectDetailModal
- [x] L1806 · open-lead · "Open"
- [x] L1807 · close-modal · "Close"

### projectImportModal
- [x] L1834 · close-modal · "Cancel"

### copilotModal
- [x] L1845 · close-modal · "Close"
- [x] L1854 · close-modal · "Close"

### radarView
- [x] L1862 · open-lead · "Open"
- [x] L1862 · ? · "Review"
- [x] L1863 · open-lead · "Open"
- [x] L1864 · refresh-radar · "Refresh"

### governanceView
- [x] L1872 · edit-staff · "Edit"
- [x] L1872 · toggle-staff · "{…}"
- [x] L1873 · verify-audit · "Verify chain"
- [x] L1874 · set-approval-policy · "1-person approvalSmall team · fast hando"
- [x] L1874 · set-approval-policy · "Strict 4-eyesDrafter + independent count"
- [x] L1876 · clear-demo · "Clear demo records"

### staffFormModal
- [x] L1887 · close-modal · "Cancel"
- [x] L1887 · submit · "{…}"

### briefingsSettingsView
- [x] L1908 · rotate-webhook-secret · "Rotate webhook secret"

### bookingEditModal
- [x] L1922 · close-modal · "Cancel"
- [x] L1922 · submit · "Save briefing"

### researchModal
- [x] L1963 · research-back · "Back"
- [x] L1983 · research-clear · "Remove"
- [x] L1983 · research-back · "Back"
- [x] L1983 · research-reject · "Reject brief"

## Phase 2 — manual review per view (render harness + eyeball HTML)
- [x] All views rendered via /tmp/render-all.js (45 fns, 144 buttons/links, 0 icon-less)
- [x] Modals: lead form, candidate review, CSV preview/import report, lead detail, proposal, outreach, email, partner, project form/detail/import, copilot, staff, booking edit, research
- [x] Public: /book/…, /opt-out/…, login, mobile more-menu, demo banner, icon-gallery

## Phase 3 — blank/old-style checks
- [x] grep legacy classes icon-fill/icon-fill-mid/icon-fill-low still emitted anywhere
- [x] confirm <defs> (index.html serves /, /book/*, /opt-out/*; gallery has own defs) gradient/filter present on every page that renders icons (index.html, gallery, public pages share index.html?)
- [x] non-button actions (a.button CSV/Download/Preview, demo banner "i", policy cards): `<a>` links, `.table-action`, select/filters, status pills, empty states, section headings

## Phase 4 — ship
- [x] npm test  - [x] commit+push  - [x] promote to production  - [ ] user visual confirmation on Chrome desktop

## Status 2026-10-25
Committed & promoted. Remaining: user to eyeball live site; report any specific spot still lacking an icon (view + button label).

## Round 2 (go)
- [x] 7 panel titles, 13 detail-section titles, 2 radar headings, 5 settings/CSV h3s now carry glyphs (.panel-title/.section-title-text/.h-icon)
- [x] copilot tabs already iconed; stage/status pills intentionally text-only (colour-coded)
- [ ] user visual confirmation on Chrome desktop

## Round 3 (screenshot: giant/"upside-down" kanban + prospects on Overview)
- [x] Root cause: `.panel-action` had no icon size → SVG expanded to container width. Added global `.icon-svg` 16px default + explicit sizes for panel-action, auth-submit, button-lime, mobile-menu, empty-state-icon, approval-trail-title, radar-heading
- [x] Kanban glyph redrawn as a bordered board with 3 lanes + cards (no longer reads as inverted bars)
- [x] Verified arrow directions: upload/download/arrow/back/logout/external/trend/send all correct
- [ ] user visual confirmation on Chrome desktop

## UI redesign (Linear/Vercel aesthetic) — 2026-10-25
Decisions: dark zinc-950 sidebar + light zinc app; single purple accent; restyle + ⌘K palette, breadcrumbs, dense tables, sticky headers; Geist bundled locally.
- [x] public/ui.css design-system layer (tokens, type, surfaces, depth, motion, focus rings, palette)
- [x] Geist Sans/Mono variable woff2 in public/fonts (server mime + immutable cache)
- [x] Breadcrumb "Workspace / View / Section", ⌘K hint in search, command palette (views, actions, prospects, projects, partners)
- [x] tools/render-audit.js committed (replaces /tmp harness)
- [ ] user visual confirmation; follow-ups: per-view polish from screenshots

## Sidebar revision — navy + 3D glossy app tiles (2026-10-25)
Decisions: deep navy-indigo sidebar (signature), iOS-style per-item coloured gradient tiles with white embossed glyph, sidebar only.
- [x] ui.css sidebar block rewritten: navy gradient, 28px tiles (radial highlight, gloss cap ::before, inset rim ::after, inner top highlight + bottom shade, drop shadow), per-view hues via --tile-a/b/c, raised glowing active pill, hover lift
- [ ] user visual confirmation
