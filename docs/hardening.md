# Hardening (G1) — 2026-10-25

| Control | Where | Behaviour |
|---|---|---|
| Content-Security-Policy | `server.js` `applySecurityHeaders` | `default-src 'self'`; scripts self only (no inline); styles self + inline (the UI sets inline `style=` attributes); images self/data/blob; `object-src 'none'`; `frame-ancestors 'none'` |
| HSTS | same | `max-age=31536000; includeSubDomains` when the request arrived over HTTPS (`x-forwarded-proto` or TLS socket) |
| Framing | same | `X-Frame-Options: DENY` + CSP frame-ancestors |
| Misc | same | `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera/mic/geo/payment/usb off), `Cross-Origin-Opener-Policy: same-origin` |
| Session cookie | `cookieHeader` | `SameSite=Lax; Secure` on HTTPS (was `None; Partitioned`). CSRF tokens still required on every mutation. |
| Key separation | `lib/remote-sync.js` `localFiles` | When `SETTINGS_ENCRYPTION_KEY` is set (it is, on Vercel) the local `.settings-key` is never uploaded to Supabase — bucket access alone cannot decrypt stored secrets. |
| Snapshot history | `lib/remote-sync.js` `snapshotHistory` | First push of each UTC day copies the snapshot to `workspace/history/YYYY-MM-DD/`; pruned to `SUPABASE_HISTORY_DAYS` (default 7). Restore = copy a day's files over `workspace/` and redeploy. |

`EMBEDDED_PREVIEW=true` (only for hosted iframe previews) relaxes framing and switches the cookie back to `SameSite=None; Partitioned`. Never set it on a real domain.

Tests: `tests/remote-sync.test.js` (history + key exclusion; security headers + cookie).

Still open (G2–G4 in the idea bank): TOTP MFA, API-wide rate limiting, privacy-notice text for cross-border hosting.

## Root account (2026-10-26)

The founding administrator — the account created at `/api/auth/setup` (on existing workspaces: the oldest active admin, migrated automatically on first load) — is the **root account**. There is exactly one.

**Immutable to everyone else.** No admin can demote, deactivate, rename or reset the root account; the root account can rename itself and rotate its own password, but can never demote or deactivate itself (`lib/config-store.js updateUser` guards; staff list shows a *Root* badge and *Protected* instead of controls).

**Technical surface is root-only** (hidden in the UI, `403 This area is reserved for the root account` on the API):

| Area | Paths |
|---|---|
| Ops dashboard | `/api/ops` |
| Deliverability (mailboxes, domain health, queue, policy, tick) | `/api/deliverability/**` |
| Data quality (merge reviews, re-verify) | `/api/data`, `/api/data/*` — except `check-duplicates`, used by intake for all staff |
| Durable storage probe | `/api/storage` |
| Inbound plumbing | `/api/inbound/webhook-info`, `/api/inbound/imap-sync`; the inbound section of Settings → Briefings & inbound |
| Integrations tab (AI, web-search, tracking, public URL) + connection tests | `/api/settings/test-*`; `PUT /api/settings` accepts only governance keys from non-root admins (`approvalPolicy`, `outreachStyle`, `guardrail`, briefing platforms) and refuses mixed payloads |
| Raw audit export | `/api/audit/export.csv` (the audit viewer stays available to admins) |
| Demo purge | `/api/demo/clear` |

Non-root sessions receive a scoped settings object (`technicalHidden: true`, no hosts/ports/usernames/endpoints; only `*Configured` booleans so the workbench can still explain why a step is waiting). Other admins keep everything day-to-day: staff management of non-root accounts, approval policy, outreach style, guardrail, countersigning, leads, relationships. Tests: `tests/root-account.test.js`.

**Invisible to others (2026-10-26).** Non-root sessions never see the root account: it is removed from `/api/staff` and `/api/init.staff` (so staff counts exclude it), `rootUserId` is withheld, `PUT /api/staff/<root>` answers 404, and audit entries authored by the root account are shown with actor **"Chelo system"** in the audit viewer. Root sees the real actors.
