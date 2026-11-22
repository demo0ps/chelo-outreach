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


## Co-branded photo cover · PDF that is always there (v37)

- **One photo per project type**, used on both the hosted page hero and page 1 of the proposal PDF: `literacy` (reading under a tree),
  `construction` (laughing in the school yard), `ict` (solar roof & garden), `classroom` (running past the mural). Files live in
  `public/brand/templates/<name>.jpg` (web, 1400 px) and `<name>-cover.jpg` (PDF, 900 px). `lib/conversion.js templateFor()` picks.
- **Legibility rule:** words sit on a navy fade from the left and the bottom (`.pp-hero::after`; PDF: alpha strips via ExtGState),
  always white, top-left logo. Only short words go on the picture — *Funder × Chelo*, project name, place. The longer
  "picture the first day of term…" sentence is normal text under the photo.
- **Why "create PDF" looked like it did nothing in production:** the PDF was written to the serverless instance's `/tmp`, which is not
  part of the Supabase snapshot (only the database is). The next request landed on another instance → "could not be found" → no
  attachment. Fix: `proposalPdfPath()` rebuilds the file from the saved `proposalData` whenever it is missing, and queued send jobs
  carry the PDF **bytes** (base64 in the job payload), not a path. First email always attaches; the preview's "Proposal PDF attached"
  check now reflects the real file.
- Read & send footer is a normal block at the end of the page (no longer pinned).

## Find mailboxes · time-budgeted batches (v38)

- Symptom: "Find mailboxes" spun and nothing changed. Cause: one batch crawled up to 8 pages × 2 URL variants × 12 s per organisation
  plus SMTP checks; one slow website pushed the request past Vercel's 60 s limit → HTML 504 → the browser's JSON call failed silently.
- Fix: every batch runs inside `MAILBOX_BATCH_BUDGET_MS` (16 s on serverless, 45 s locally); page fetches use a 6 s timeout and the
  batch's AbortSignal. Whatever finishes is saved; organisations cut short are marked `cutShort` and go to the back of the queue
  (not "no mailbox published"). The browser keeps asking for the next batch, shows live progress, tolerates a 502/503/504 three times,
  and stops with a clear message when only slow sites remain.

## Email arrives → block clears (v39)

- Symptom: a lead showed "No email address yet" in red while the finder panel showed a mailbox "In use". The address had been saved,
  but the workflow still carried the verdict from the earlier run.
- Fix: `unblockForEmail(lead)` runs whenever an address lands on a lead (typed, "Use this", or found automatically). The verify step
  becomes *pending* with "Email address added (…). Press Run to check it and carry on." and the status returns to **Run** — Chelo does
  not auto-continue (staff decision). `deriveFlowStatus` also heals records that were blocked before the address arrived.
- Mailbox finder skips department mailboxes entirely — hr@, careers@, press@, sales@, support@ … — including department
  *subdomains* such as `info@hr.ibm.com`. Prefers csi@ / foundation@ / sustainability@ / info@.

## Settings: Save next to the key · failed test no longer crashes (v40)

- Each Settings card (AI provider, Search provider) has its own **Save** button; **Save & test** saves what you typed and then tests it,
  so you no longer test last week's key. Secret fields are emptied after saving.
- Bug: a failed AI/SMTP connection test hit `actorName()` outside its scope in the error handler → `ReferenceError` → **process crash**
  (on Vercel: the request died silently). Fixed; failed tests now return plain errors ("The AI provider rejected the key…",
  "…did not answer within 15 seconds…").

## Add a mailbox with just email + password · every mailbox reads its own replies (v41)

- **Add mailbox** form is now: email address, password, name shown to funders, "start slowly" tick. **Find settings** looks up the
  domain's MX → provider (Google Workspace / Microsoft 365 / Zoho / self-hosted cPanel) → tries the known SMTP and IMAP servers in
  order with the typed login (8 s each; a password refusal stops the search) and shows what worked. **Connect mailbox** does the same
  and saves sending + reply-reading in one go. "Server details" stays available behind a disclosure for the rare manual case.
  (`lib/mail-autodiscover.js`; `POST /api/deliverability/mailboxes/autodiscover|connect`.)
- Per-mailbox IMAP: `mailboxes.imap_json` (migrated in place). `POST …/mailboxes/:id/imap` sets/clears it, `…/:id/sync-inbox` reads
  it now, `POST /api/inbound/imap-sync` reads **every** mailbox (plus the legacy shared IMAP setting if it is different). The
  send-tick cron and the 10-minute worker timer also read inboxes, so a funder reply stops follow-ups before the next send.
  The password defaults to the SMTP one; a separate IMAP password can be stored.
- DNS advice per provider (`GET …/mailboxes/:id/dns`): SPF include, DKIM selector + where to generate it, DMARC. For cheloapp.com
  (Google Workspace, Afrihost DNS): add TXT `v=spf1 include:_spf.google.com ~all`; DKIM selector `google` from Admin console →
  Apps → Gmail → Authenticate email; DMARC `p=quarantine` already exists.
- Bug caught by the new test: rows now carry `imap_json`, which the named-parameter UPDATE rejected ("Unknown named parameter") —
  `bindable()` strips it before `setMailboxHealth` / `setMailboxStatus`.

## Dead "Send & follow up" button (v43)

- Symptom: on the review page, **Send & follow up** (and *Stop follow-ups*, *Approve as second person*) did nothing — no request,
  no error. The click dispatcher only forwarded `wb-*` actions to `wbAction`, but those buttons use `seq-*`.
- Fix: dispatcher forwards `wb-*`, `seq-*` and `triage-apply`. New test in `tests/consolidation.test.js` scans every
  `data-action` in the UI and fails if any has no handler, and asserts `seq-` is routed.
- Also (v42): "Make the PDF now" on the review page builds the PDF from the project instead of demanding the proposal form; when
  Send is greyed out the page now says which checks block it.

## Emails go when approved; the app nudges the engine (v44)

- Root cause of "I approved it and nothing arrived": on Vercel there is no background worker and the cron runs once a day
  (09:00 SAST, Mon–Fri). A due email sat in the queue until something touched the engine.
- **Auto-nudge**: the browser calls `POST /api/engine/nudge` after each data refresh (≤1/min), every 5 minutes while the tab is
  visible and when the tab regains focus. The server (throttled to 20 s, single-flight) sends what is due (≤5) and reads every
  mailbox's inbox if the newest read is older than 10 minutes. The daily cron stays as a backstop.
- **Immediate first email**: `enqueue({ immediate: true })` — used for the first email of a sequence and a single approved email —
  skips the random delay inside the open window but keeps the 90 s minimum gap after the previous email. Follow-ups keep full
  spacing. Outside the window everything still waits for the next opening (staff decision).
- **Send now**: `sendEngine.sendNow(jobId)` → `POST /api/leads/:id/send-now` (any staff) and `POST /api/deliverability/jobs/:id/send-now`
  (root queue). Refuses when the window is closed or the mailbox hit today's cap. Leads carry `sendSlot` (next waiting job, due?,
  window open?, next opening) and the lead page/review page show "Email sends at 09:44 — Send now" or "waits for the sending window —
  goes Mon 08:30". The Send queue header has "Send what is due" (visible inside Health → Email delivery too, where the page header is hidden).

## Warm Vercel instances reload when the shared snapshot moves (v45)

- Symptom family: "the draft is gone", "no draft to preview yet", "PDF generator stopped working", data reverting. Cause: Vercel runs
  several warm instances; each pulled the Supabase snapshot once at cold start and never again. A request landing on a different
  instance saw old data — and that instance's next save pushed the old data back over the new (last writer wins).
- Fix (`api/index.js`): before any `/api`, `/track`, `/proposal`, `/book`, `/opt-out` request the entry compares the shared manifest
  version with the version this instance loaded (`remoteSync.checkFresh()`, one small read; GETs throttled to every 2 s, mutating
  requests always). When behind: `app.close()` (releases SQLite), purge the require cache for the repo's modules, `pull()`, re-require
  `server.js`. Single-flight. The sync object lives on `globalThis` so version state survives the reload.
- Test: `tests/vercel-entry.test.js` drives the handler with a fake sync — a bump in the remote version makes the next request
  `check → pull` before serving; POSTs check even inside the throttle window.

## Connect with Google (OAuth) for Workspace mailboxes (v46)

- **Settings → Google**: Client ID + Client secret of an *Internal* OAuth client created in the company's Google Cloud project
  (`PUT /api/settings/google`, secret encrypted; env `GOOGLE_CLIENT_ID/SECRET` override). The card prints the exact origin and
  redirect URI to paste into Google (`/api/oauth/google/callback`).
- **Add mailbox → Connect with Google** (`GET /api/oauth/google/start[?mailbox=id]`, admin): redirects to Google with scopes
  `gmail.send` + `gmail.readonly` + `openid email`, `access_type=offline`, `prompt=consent`, `hd=<hostedDomain>` if set. State is
  HMAC-signed with a per-workspace key (`configStore.deriveKey`) and expires in 15 min — stateless across serverless instances.
  Callback exchanges the code, reads the address from the id_token, refuses if a permission was unticked, then
  `sendEngine.connectGoogleMailbox()` creates/re-links the mailbox (`auth_type='google'`, refresh token encrypted in
  `password_json`, `host='gmail-api'`, imap marker `gmail-api`) and redirects to `/?google=connected&email=…`.
- **Sending**: `lib/google-mail.js` `transport(mailbox)` mirrors nodemailer's interface — MIME built by nodemailer's MailComposer
  (same headers, List-Unsubscribe, PDF attachment, Message-ID) and posted to `users/me/messages/send`. Access tokens cached per
  mailbox and refreshed with the stored refresh token.
- **Reading**: `checkInbox()` lists `in:inbox after:<cursor> -from:me` and fetches metadata headers only (never bodies); same
  `signals` shape as the IMAP reader; cursor + recent ids kept in `imap_json.lastSync` to de-duplicate across reads.
- **Revocation**: `invalid_grant`/401 → error flagged `disconnected` → engine class `auth` → mailbox paused "Google disconnected —
  press Reconnect"; the card shows a primary **Reconnect Google** button; reconnecting re-links the same mailbox id and resumes it.
- `api/index.js`: `/api/oauth/*` counted as mutating so the new mailbox is pushed to Supabase before the redirect completes.
- Tests: `tests/google-mail.test.js` (auth URL/scopes/state, code exchange + unticked permissions, MIME + Gmail send with cached
  token, revoked → paused → reconnect, metadata-only inbox read).

## v49 — My mailbox: one Google setup, every staff member connects their own mailbox (2026-11-20)
- Settings → **My mailbox** (all roles, default tab): Connect with Google, per-person list with state, "Check for replies now", Reconnect, Remove. Admins also find the Google client settings there (collapsed); Integrations stays root-only.
- Mailboxes gain an `owner` (staff login). `/api/oauth/google/start` is open to every signed-in user; the callback assigns the mailbox to the person who connected it and refuses re-connecting a colleague's mailbox unless admin. `/api/me/mailboxes` (+ `DELETE`, `/check`, `/sync-inbox`) are owner-scoped.
- Sending: `pickMailbox(preferred, { owner })` — approver's own mailbox first, then shared (unowned), then any active. Sequence steps pin `seq.mailboxId` so follow-ups stay in the same thread/mailbox; the first approver's login is carried in `meta.actor`.
- Company lock: hosted domain defaults to `cheloapp.com` (`GOOGLE_HOSTED_DOMAIN` or Settings override); `hd=` on the Google chooser and re-checked on callback.
- Next: v50 Sign in with Google (`openid email profile`, same client, @cheloapp.com auto-provision as member, password login kept).

## v50 — Sign in with Google (2026-11-20)
- Login page: **Sign in with Google** (`/api/auth/google/start` → `/api/auth/google/callback`, scopes `openid email profile`, `hd=cheloapp.com`, `prompt=select_account`). Shown once a first admin exists and the Google client is set.
- `googleMail.loginUrl` / `exchangeLoginCode`: id_token from the token endpoint (aud, email_verified, hd) → `{email, name}`; wrong domain / unverified / other-app refused with plain errors.
- `configStore.provisionGoogleUser`: existing staff account reused (deactivated refused); new @cheloapp.com account created as **owner** (staff) with a random unusable password, flagged `googleOnly`. Audit `auth.google.joined` / `auth.login`. Rate-limited per IP like password login. Password sign-in unchanged.
- First visit lands on Settings → My mailbox with a welcome toast; `?login=error` shows on the login card.
- Test-only `GOOGLE_TOKEN_URL_OVERRIDE` (ignored in production) lets the e2e test run a fake Google token endpoint.

## v55 — One Google screen: sign in + mailbox (2026-11-21)
- Login scopes = `openid email profile` + `gmail.send` + `gmail.readonly`, `access_type=offline`, `include_granted_scopes`. First visit `prompt=select_account`; if Google returns no refresh token and the person has no usable Google mailbox, one automatic bounce with `prompt=consent` (state `consent:true` prevents loops). Returning visits: single click.
- Callback connects/refreshes the mailbox (`owner` = the signer, from-name = display name) and audits `mailbox.google_connected`. Unticked Gmail boxes → sign-in refused (no session) with a plain message, per user decision.
- `api/index.js`: `/api/auth/google/callback` counted as mutating → session/account/mailbox pushed to the shared snapshot before the response (fixes "Sign in required" right after Google).
- Return params: `login=welcome|ok`, `mailbox=connected|ready|missing`, `email`.

## v56 — Private workspaces with sharing (2026-11-21)
- `lib/access.js`: `accessReason(session, lead, teams)` → `all | owner | shared | project | ''`. Admins, reviewers (4-eyes second approver), root and demo see everything; everyone else sees funders they own (`lead.ownerId`), are shared on (`lead.sharedWith[]`) or whose Verified Project team they are on (`project.team[]`).
- `visibleLeads(session)` now scopes every list: To do, `/api/leads`, `/api/workbench`, `/api/radar` (+ follow-up digest), `/api/signals`, `/api/triage`, `/api/partners`, and `/api/init` (messages, events, bookings, activities, partners filtered by visible lead ids; `canSeeAll`, `directory`, each lead carries `access`). Lead routes 404 for funders you cannot see; Inbox `canSee` runs a `leadGate` first (assignee of a thread keeps access).
- Routes: `GET /api/leads/:id/access`, `PUT /api/leads/:id/share {userIds}` (owner/admin), `PUT /api/leads/:id/owner {userId}` and bulk `PUT /api/leads/owner {userId, leadIds}` (admin), `PUT /api/projects/:id/team {userIds}` (admin). Audit actions `lead.shared`, `lead.owner_changed`, `project.team`.
- Migration: `ensureLeadOwners()` at boot and on `/api/init` gives ownerless funders to the root account.
- Duplicate protection stays global; when the match is private the reply is `Already in Chelo — ask an admin to share it with you.` with no record details (`code: duplicate-private`).
- UI: funder page shows "Who can see this" + "Share with…" (owner/admin; admins also change owner there); To-do rows show the owner's name for admins; project detail has "Team on this project". Cache tag `v56`.

## v57 — One voice, five ways in (2026-11-21)
- `lib/voice.js`: openings `figure | question | priority | story | ask`, picked per funder (`pickOpening` hashes lead id + step, skips `lead.voice.used`), remembered on the lead (`voice.remember`). `angleFrom(facts, strategy)` picks the approved research fact that suits the opening (numbers → figure, priority words → priority, learners/schools → story); `asSentence` gives fragment facts a subject. Length targets by step (`95–140 / 55–90 / 30–55 / 40–65` words), six rotating sign-offs. `tooSimilar(body, recentBodies)` = word-trigram overlap after stripping links/boilerplate; threshold 0.5.
- AI path (`generateOutreachEmail` → `generateOutreachEmailOnce`): the brief is appended to the system prompt and sent as `writingBrief`; temperature 0.6 (0.75 on rewrite); the result is compared with the last 20 sent emails and regenerated once with the next opening if it reads like a template. Mandatory phrases/links/guards unchanged.
- Template path (`conversion.ladderStep`): step 1 opening comes from the strategy (one question per email — if the opening is the question, the close becomes a statement), the approved alignment point is always included, proof line/close/subject/sign-off vary per funder; steps 2–4 vary their lead-ins.
- "Write it again" → **Rewrite differently** (`redraft` → `differently: true` → excludes the last opening). The draft card shows which opening was used. PDF cover opening (`localProposalDraft`) follows the same strategy as the email.
- Tests: `tests/voice.test.js`, conversion ladder test covers all five openings. Cache tag `v57`.

## v58 — Opt-out footer · real-funder discovery · news as homework (2026-11-21)
- **Footer.** One line everywhere (`conversion.OPT_OUT_FOOTER` = "Don't want more emails from Chelo? Opt out: <url>", always last). `emailHtml` renders it as a small grey footer with only "Opt out" linked; plain text keeps the address. Question/word counters (`conversion.lint`, client readiness, smoke) strip the footer via `OPT_OUT_LINE`.
- **`lib/news-intel.js`.** `classifyHost` → media | directory | government | academic | social | company (only `company` can become a funder; `/news|press|jobs/` paths on company sites count as articles). `articleDate` (meta → JSON-LD → URL → text), `isFresh` (≤12 months), `whenPhrase` ("recently / earlier this year / last year / in 2023" — never the outlet). `funderNamesFromArticles` (AI, heuristic fallback) returns organisations that *give*; `givingFacts` returns dated giving/CSI facts for one funder (`kind: news_giving`, `fresh`, `when`, `outlet`, `sourceUrl`).
- **Discovery** (`discoverOrganisations`): 4 query variants → company pages kept directly; article pages (≤6) read → names → each resolved with one `"Name" official website` search (`looksLikeOfficialSite`); directories/government/universities/social never fetched. Results carry `via`, `articles[]`, `unresolved`. Route enriches the top 6 with the published generic mailbox (`mailboxFinder.find`, no pattern guessing, 20 s budget). `/api/discovery/add` stores `lead.discovery.articles` and, when a mailbox came back, sets it as the generic contact.
- **Research** (`researchFunder`): `knownArticles` (from discovery) + media hits are read separately; `givingFacts` go first in `findings`, `brief.articles` lists them with `fresh`. Stale news facts cannot be approved (server filter) and are excluded from `approvedContext` / `approvedFactsFor`; fresh ones carry the `when` phrase into v57's openings and the PDF. UI: "In the news · 2026-03" tag, stale rows disabled with "older than 12 months — not used in emails".
- Tests: `tests/news-intel.test.js` (classification, dates, giving facts, names, end-to-end discovery with fake search), footer assertions in conversion + smoke. Cache tag `v58`.

## v59 — Discovery judged by AI, proper names (2026-11-21)
- `news.classifyHits(hits, {aiConfig})`: one AI call per search labels each hit `org | publisher | public` with the organisation's proper name; list-based `classifyHost` is the fallback and a hard floor (media/government/academic can never be upgraded to `org`; search/AI tool domains such as tavily/serper/bing are always dropped). Media patterns extended (`insider`, `billionaire`, `knowledgehub`, `.africa` cores, businessinsider, billionaires.africa, trialogueknowledgehub).
- `news.orgNameFor(title, domain)`: never a page title ("CSI", "Corporate social investment"); picks the title segment that matches the domain, else a brand table (bp → BP, jse → JSE…), else the domain core.
- Only `media`/`company`-listed publishers are read as articles; directories/job boards never fetched. `read` now reports `named`, `articleTitles`, `aiOn`; the UI prints "Read N articles → funders named inside: …" or "AI key not set — article reading is off". Cache tag `v59`.
- **v59b — "Tracked" is actionable.** `/api/discovery/search` returns `tracked {id, company, hidden, visible, stage}` for matches; the card shows **In To do · Open** / **Parked · Open** (hidden awaiting-contact leads are revealed via new `POST /api/leads/:id/reveal`, audited `lead.revealed`), or "Already in Chelo — ask an admin to share it" when the match belongs to someone else.

## v60 — Four Desks, Release 1: desks & roles
- One Chelo, four desks (CSI, Marketing, Schools, Suppliers). `lib/desks.js` is the single catalogue.
- Accounts hold one or more desks (`users.desks`); admins, reviewers and root hold all four. Staff form has desk tick-boxes.
- Sidebar desk switch (shown only when you hold ≥2 desks). Client sends `X-Chelo-Desk`; server resolves to a held desk.
- Targets carry `kind` (funder / media / school / supplier). Missing kind = funder = CSI, so all existing data stays on the CSI desk with no migration.
- Leads, To do, Workbench and Inbox are desk-scoped; Verified Projects stay shared.
- Mailboxes can be tagged to one desk (`PUT /api/deliverability/mailboxes/:id/desk`); untagged boxes serve any desk.
- Issue log started: `docs/known-issues.md`.

## v61 — Four Desks, Release 2: Marketing desk
- `lib/media.js` is the single home for the desk: pitch tracks (PR / Partnership), media kit rules, "what you covered" brief, outlet discovery, outcomes.
- Media kit lives in the SQLite meta table (`doc:mediaKit`, via `store.getDoc/setDoc`). Admin edits (`PUT /api/media-kit`) reset approval; `POST /api/media-kit/approve` gates every pitch.
- Same engine, one record: media targets are leads with `kind = 'media'`, `pitchTrack`, `outcomes`. The flow dispatches at two points only: `gatherBrief()` (coverage brief vs funder brief) and `generateOutreachEmail()` (kit pitch vs funder email). Sequences use `media.FOLLOW_UP_OFFSETS` (two follow-ups). No proposal PDF on pitches.
- Discovery on the Marketing desk (`X-Chelo-Desk: marketing`) returns outlets instead of funders; CSV rows and promoted candidates inherit the desk's kind; candidates are desk-scoped.
- Outcomes: `PUT /api/leads/:id/outcome {outcome: booked|published|signed, on}` — booked → Interested, the track's goal outcome → Won.

## v62 — Four Desks, Release 3: Schools desk
- `lib/schools.js` is the single home: DBE CSV parser (official headers or our compact ones), `schools.sqlite` store (`createSchoolsStore(conn)`), tree/list, `leadFromSchool`, `dbeBrief`, `emailStep`, `callScript`, call outcomes, needs → project body.
- `data-seeds/dbe-schools-2025q2.csv.gz` (1 MB): the DBE national master list Q2 2025, open schools only, 20 columns, sourced from a public GitHub mirror of the DBE Excel. `POST /api/schools/load` loads it; `POST /api/schools/import` (text/csv, ≤40 MB) takes a newer quarter straight from the DBE site.
- Routes: `GET /api/schools/status|tree|?province&district&circuit&contact&q`, `POST /api/schools/:natemis/add`, `POST /api/leads/:id/call`, `POST /api/leads/:id/needs`, `POST /api/leads/:id/needs/:needId/project`.
- Same engine: a school is a lead with `kind = 'school'`, `natemis`, `school{…}`, `callTask`, `needs`. Flow dispatch: no email → call task (flow status `call` / `call-booked`), email → "15-minute call with the principal" ask (two follow-ups, no PDF); research step = DBE facts brief; project match not required.
- `vercel.json` includes `data-seeds/**`; remote-sync tracks `schools.sqlite`.

## v63 — Four Desks, Release 4: Suppliers desk
- `lib/suppliers.js` (pure): 11 trades, need-category → trade map, public sign-up validation (`fromSignup`), vetting (`setVetting` pending/approved/rejected → stage), `matchSuppliers` (approved + trade + province), per-project quote request (`openTender`, token link `/quote/:token?s=supplierId`, broadcast email copy), `submitQuote` (one live quote per supplier), `setQuoteStatus` (shortlist / sign with optional fee % 0–30 / decline; signing declines the rest and sets the project to "Supplier signed · In delivery"), `closeTender`, `confirmDone` ("Delivered · School confirmed").
- Server: public `GET/POST /api/public/suppliers/signup` (dedupe by email, 40/h), `GET/POST /api/public/quote/:token`; staff `GET /api/suppliers/match`, `GET /api/suppliers/signup-link`, `PUT /api/leads/:id/vetting` (admin), `GET/POST /api/projects/:id/tender`, `/tender/close`, `/tender/done`, `PUT /tender/quotes/:quoteId`. Supplier leads skip the email flow entirely (flow status `vet`/`vetted`) and only show on the Suppliers desk.
- Public pages `public/suppliers.html` + `suppliers.js` (CSP-safe, no inline script): sign-up form and hosted quote form.
- Staff UI: Suppliers intake bar (sign-up link + vetting count), supplier card (facts, references, approve/reject with notes, quote history), project modal "Suppliers & quotes" section (who would get it → ask to quote → quotes table → shortlist/sign/decline → school confirmed done → ask again).
- Tests: `tests/suppliers.test.js` (module + end-to-end). 111/0.

## v64 — Four Desks, Release 5: security backlog & clean-up
- `lib/security.js` (pure): fixed-window `rateLimiter`, RFC 6238 TOTP (`generateSecret`, `totp`, `verifyTotp` with ±1 step drift and replay guard, `otpauthUrl`), recovery codes (hashed, single use), `mfaChallenges` (5-min single-use token between password and code).
- `config-store`: `mfaStatus/beginMfa/enableMfa/disableMfa/verifyMfa`; secret encrypted at rest, `mfaEnabled` on public user.
- Server: rate limit on every `/api/*` request (per IP: auth 30/min, public 90/min, anon 120/min; per session 900/min; `RATE_LIMIT_SCALE` env) with 429 + Retry-After + audit; login returns `{mfaRequired, mfaToken}` when two-step is on, `POST /api/auth/mfa/verify` finishes it (8 attempts/15 min per IP, 6 per challenge); `GET /api/auth/mfa`, `POST /api/auth/mfa/setup|enable|disable`, `POST /api/auth/sessions/revoke-all`; `PUT /api/staff/:id {mfaReset|signOutEverywhere}` (root/co-root protected). `/api/auth/mfa*` and `/api/auth/sessions*` require a session despite the `/api/auth/` prefix. `deleteSessionsForUser(username,{except})` returns the count.
- Send engine: desk mailbox fallback recorded (`meta.mailboxFallback`, `onFallback` hook → `mailbox.fallback` audit).
- UI: two-step code screen at sign-in (with "start again"), "Your sign-in security" card under Team & governance (setup with key + otpauth link, recovery codes shown once, disable with password, sign out everywhere else), staff table 2-step pill + Sign out / Reset 2-step actions, tender earlier rounds list, privacy link on sign-in and supplier pages.
- `docs/privacy-notice.md` + `public/privacy.html` served at `/privacy` (POPIA incl. s72 cross-border hosting).
- Tests: `tests/security.test.js` (RFC vectors, limiter, challenges, e2e MFA, rate limit, fallback audit). 114/0.

## v65 — Discover: emails only; PDFs per desk
- Discover (`GET /api/discovery/search`): mailbox finder runs on every result (≤12) with pattern guesses, 30 s budget (`DISCOVERY_MAILBOX_BUDGET_MS`), `profile` by desk; results without a mailbox are dropped into `withoutEmail[]` (shown collapsed as "left out"). `discoverOrganisations` resolve budget trimmed to 15 s so the whole call stays inside Vercel's 60 s.
- `lib/mailbox-finder.js`: `PROFILES.funder|media` (priority list, wrong-department list, pages, pattern locals); `find(org,{profile})`; `findLeadMailbox` passes the media profile for media leads.
- `lib/desk-pdf.js`: `fieldLabels`, `defaults`, `layoutFor`, `filenameFor` for media/school/supplier. `pdf-engine.makeProposalPdf` honours `proposal.layout` (kicker, title, labels, box, sections, footer); funder path untouched.
- Server: `deskPdfContext(lead)` (project, media kit, open tender the supplier was sent); `createProposal`/rebuild/attachment/download use the desk layout and filename; `proposal/draft` returns desk defaults (`mode: 'desk-template'`) for non-funder leads.
- UI: `PDF_LABELS` per kind in the proposal modal (titles, field labels, button), amount/metrics/research only for funders; "Documents" page copy per desk; lead action button names the document. Tests: `tests/desk-pdf.test.js`. 120/0.

## v66 — Schools list in its own scroll box; media-kit block made unmissable
- Schools intake: `.sch-scroll` (max-height ≈46vh, sticky filters), "Hide list / Show list" toggle (`state.sch.collapsed`, localStorage `chelo-sch-collapsed`).
- Marketing: `mediaKitBanner()` on the To do (admin: "Approve the media kit now"; all: "Open media kit" → Settings → Media kit); `open-media-kit`, `media-kit-save-approve` actions; `PUT /api/media-kit {approve:true}` saves + approves; approve (either route) re-runs every media lead whose draft step is blocked on the kit (`rerun` count in the response). Test in `tests/media.test.js`.

## v67 — Starter media kit
- `media.starterKit({spokesperson, spokespersonTitle, pressEmail})`: boilerplate + six facts drawn from the product and cheloapp.com positioning (three guarantees; no money through school or Chelo; DBE list ≈25 500 schools Q2 2025; supplier vetting/quotes; Motse School × Bolt proof point; project page for CSI/B-BBEE reporting). `mediaKit()` returns it (status draft, `starter: true`) until a kit is saved; spokesperson defaults to the root account's name, press mailbox to its email. Settings → Media kit explains it is a starter.

## v68 — Photo library: one theme per need, rotated per funder, staff can pin
- `lib/pictures.js` `createLibrary(dir)`: 11 themes (need categories + "school life"), files `public/brand/photos/<theme>-<n>.jpg` (1400w) + `-cover.jpg` (1000w, baseline JPEG for the PDF); `themeFor(project)` (pinned → `needCategory` → words, specific before general), `pick(project,{lead})` (FNV hash of project+lead → variant; pinned wins; legacy template fallback when a theme is empty), `gallery()`, `coverBuffer()`.
- Server: `conversion.pageModel({photo})`; `proposalContext` cover from the library; `clientProject.photoPick`; `GET /api/photos`; `PUT /api/projects/:id/photo {theme,n}` (empty theme = back to rotation); projects created from a school need carry `needCategory`.
- UI: project modal "Picture" section (current pick, theme browser, click to pin, back to automatic). Images: 10 generated this session + 4 legacy re-encoded (ImageMagick resize/strip). Tests `tests/pictures.test.js`. 122/0.

## v69 — Supplier account manager: nearest first, documents, earnings
- `lib/geo.js`: offline gazetteer (~330 towns + province centres), `geocodeTown`, `distanceKm`, `inSouthAfrica`, `nearestTown`.
- Sign-up (`/suppliers/join`): town* + postcode + travel radius (25/50/100/200/anywhere) + optional phone GPS; compliance numbers (tax PIN, insurer + expiry, B-BBEE level). `supplier.location {lat,lng,town,postcode,source,radiusKm}`, `supplier.documents` (cipc, tax, csd, insurance, bbbee, bank, ownerId → missing | declared | received, expiry → expiring/expired).
- Projects from a school need carry `location` (DBE GPS by NatEMIS, else town). `rankSuppliers` tags each approved supplier with the first ring that reaches them (25 km, 75 km, province; supplier radius respected). Opening a quote request sends ring 0; `dueWave` widens 48 h later while quotes < 3; `sweepTenderWaves` runs in `/api/cron/send-tick`; `POST /tender/widen` for staff. Emails say "about N km from you".
- `PUT /api/leads/:id/documents`; `workbenchLead` adds `account` (`supplierSummary`: invited, quoted, awarded value and net of fee, completed value, places, documents, location). Supplier card: account strip, location, documents table with save per row, quotes with where. Tender form shows ring counts; open tender shows waves + next widening.
- Fix: grey tile text (#33). Tests `tests/geo-waves.test.js`; 126/0.

## v70 — Each desk shows only what it uses
- `DESK_NAV` / `DESK_WORDS` in app.js: per-desk sidebar (CSI: full; Marketing: Inbox, To do, Shows & outlets, Media kit, Projects, Sent, Results, Settings; Schools: Inbox, To do, Schools & districts, Calls, Projects, Sent, Results, Settings; Suppliers: To do, Suppliers, Jobs, Sent, Results, Settings). `setView` and desk-switch redirect disallowed views to To do; topbar bell hidden where there are no briefings.
- `deskAddButton()` replaces "Add a funder" on Today, the list page, Documents and To do: funders/media focus the add form; schools open the DBE browser; suppliers copy the sign-up link.
- `wbSupplierPage` (vetting pill, edit, supplier card only); `supplierTable` for the Suppliers list; Briefings page titled Calls / Interviews with desk wording. Test added to tests/consolidation.test.js. 127/0.
