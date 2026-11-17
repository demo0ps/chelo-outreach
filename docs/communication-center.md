# Chelo Communication Center — shared Inbox

The platform is now called **Chelo Communication Center**. Its Inbox is modelled on Chatwoot's inbox/conversation design,
rebuilt zero-dependency on the existing Node 22 + `node:sqlite` stack.

## Concepts
| Chatwoot | Chelo | Notes |
|---|---|---|
| Inbox (channel) | **Mailbox** from the send engine (`partnerships@…`, `emmaculate@…`) | One inbox per staff mailbox; appears in the Inbox sidebar with an unread badge. |
| Inbox member | **Member** (`inbox_members`) | Managed by root / full-access accounts only (Inbox → *Members*). |
| Conversation | **Conversation** (`conversations`) | One per lead per mailbox. Opened automatically by a human reply (webhook, IMAP, or staff-logged). |
| Status open/pending/snoozed/resolved | same | Snoozes wake automatically on the chosen morning. |
| Assignee | **Assignee** | Lead owner if they are a member of that inbox, otherwise round-robin among members. |
| Message / private note | **Message** (`conversation_messages`) | `inbound`, `outbound` (staff reply), `note` (private, `@Name` mentions), `event`. |

## Who sees what
* Root and full-access accounts see every inbox and every conversation.
* Members see the inboxes they belong to. An inbox with **no members is visible to all staff** (sensible default on day one).
* Anyone sees a conversation assigned to them, even in an inbox they are not a member of.
* Unrouted conversations (no mailbox could be inferred) are visible to everyone and listed under *Unrouted*.

Routing a reply to an inbox: explicit `mailboxId` → the `To:` address of the inbound event → the mailbox that sent the last email to that lead → the only active mailbox → unrouted.

## Replies & governance
* Replies are sent from the conversation's mailbox, in-thread (`In-Reply-To`/`References`), through the send queue (caps, business hours, suppression, circuit breaker all apply).
* **Single-approver policy:** the author's *Send* is the approval; queued immediately.
* **Strict 4-eyes:** the reply waits as *awaiting countersignature*; a different teammate clicks *Countersign & send*. The author cannot countersign their own reply.
* Opted-out contacts cannot be replied to. Everything is audited (`inbox.reply_queued`, `inbox.reply_countersigned`, `inbox.status`, `inbox.members_updated`).

## Triage and the Workbench
The 5-bucket triage (interested / not now / wrong person / opt-out / automatic) lives in the conversation's lead panel and still drives
the pipeline (stage, resume date, redirect → candidate, suppression). Triaging as *not now*, *opt-out* or *automatic* resolves the conversation.

## API
`GET /api/inbox` · `GET /api/inbox/conversations/:id` (marks seen) · `POST …/:id/status|assign|note|reply|seen` · `POST …/:id/reply/:msgId` (countersign) · `PUT /api/inbox/mailboxes/:id/members` (root).

## Phone
The phone Inbox tab mirrors the desktop: folder chips (Mine · Unassigned · All · each inbox), status tabs, two-pane list → thread with reply/note/assign/resolve. Failed sends and briefing requests remain listed under *Also needing a human*.
