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
