# Durable storage on ephemeral hosts (Supabase Storage sync)

**Problem.** Vercel functions have a throw-away filesystem: `/tmp` SQLite is wiped on every cold start, so loaded funders, found mailboxes, logins and audit history vanish.

**Solution (zero dependencies).** `lib/remote-sync.js` mirrors the data directory to a *private* Supabase Storage bucket over plain HTTPS:

| When | What |
|---|---|
| Cold start (`api/index.js`, `start.js`) | `ensureBucket()` → `pull()`: downloads `manifest.json` and any tracked file whose SHA-256 differs from the local copy, drops stale `-wal/-shm`, **before** the SQLite store opens. |
| After every mutating request (POST/PATCH/DELETE, `/api/cron/*`, `/track/*`) | `push()`: flush pending writes, `PRAGMA wal_checkpoint(TRUNCATE)`, upload only files whose hash changed, then a new `manifest.json` with `version+1`. Runs *after* the response is sent but inside the invocation, so it never slows the UI and Vercel keeps the function alive until it completes. |
| Long-running host (`npm start` → `start.js`) | Same pull at boot, push every `SYNC_INTERVAL_SECONDS` (60) and on SIGTERM. |

Tracked files: `chelo.sqlite`, `settings.json`, `auth.json`, `audit.jsonl`, `.settings-key`. (Generated proposal PDFs are not mirrored; they regenerate.)

Concurrency: a manifest `version` detects two warm instances writing past each other; the conflict is logged and counted (`GET /api/storage` → `sync.conflicts`), last writer wins. For a 2–5 person team hitting one region this is rare; a Postgres row store is the next step if it ever matters.

## Setup (10 minutes)
1. Create a free Supabase project (any region; `eu-west` is closest to ZA). Nothing else to configure — the bucket is created automatically.
2. Project Settings → API: copy **Project URL** and the **service_role** key (never the anon key; the bucket is private).
3. Vercel → Project → Settings → Environment Variables (Production):
   - `SUPABASE_URL` = `https://xxxx.supabase.co`
   - `SUPABASE_SERVICE_KEY` = `eyJ…` (service role)
   - optional `SUPABASE_BUCKET` (default `chelo-data`), `SUPABASE_PREFIX` (default `workspace`)
   - remove `DEMO_OPEN_ACCESS` so real logins apply.
4. Redeploy. Discover → the catalogue panel shows "Durable storage on: synced to Supabase (vN)". `GET /api/storage` returns the sync status.

Free-tier notes: Supabase pauses projects after 7 days without API activity — the daily cron (`/api/cron/data-tick`) keeps it awake. Storage use is a few MB.

Tests: `tests/remote-sync.test.js` (unit against a fake Storage API: changed-only uploads, versioned manifest, pull restores a wiped directory, conflict counting, bad-key never throws; plus end-to-end: real server boots with sync → creates login + lead → SIGTERM pushes → brand-new directory boots, pulls, and the login + lead are there).
