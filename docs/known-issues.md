# Known issues & parked items

Running log kept from v60 (Four Desks programme) onward. Every bug, shortcut or mistake we notice goes here
with its status. Release 5 (final clean-up) closes or consciously parks every open line.

| # | Found in | Area | Issue | Status |
|---|----------|------|-------|--------|
| 1 | v60 | Desks | Candidates, Sent and Briefings lists are not yet desk-filtered (only Leads, To do, Inbox, Workbench are). Harmless while Marketing/Schools/Suppliers are empty; fix in R2 when the first non-CSI targets exist. | open |
| 2 | v60 | Desks | `/api/partners` and `/api/projects` are shared across desks by design (Verified Projects are the common ground). Re-check in R5 that nothing desk-private leaks via these. | watch |
| 3 | v60 | Mailboxes | If every mailbox is tagged to other desks, a send on a desk with no box of its own falls back to *any* active box (so nothing silently blocks). Log a warning in the send audit — not done yet. | open |
| 4 | pre-v60 | Security | MFA, login rate limiting and POPIA notice still outstanding (G2/G3/G4). | planned R5 |
| 5 | pre-v60 | Settings | Google settings persistence via Supabase never root-caused; env-var workaround in use. | parked |
| 6 | pre-v60 | DNS | cheloapp.com SPF record missing; CNAME for tracking domain pending (user side). | user |
| 7 | pre-v60 | Data | Transnet lead failing discovery/research; stale leads to review (user side). | user |
