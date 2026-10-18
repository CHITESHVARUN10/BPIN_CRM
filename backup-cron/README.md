# BPIN Backup Cron

A standalone Vercel project that backs up the BPIN CRM data into a Google
Workspace **Shared Drive**:

- **MongoDB** (company Atlas): every business collection as gzipped NDJSON
  (`db/<collection>.ndjson.gz`).
- **Vercel Blob store**: every actual file (images + videos) streamed out of
  the private store into Drive (`media/<original blob pathname>`).
- A **manifest.json** per run ties every stored file to its blob identifier
  (`pathname`) and the ServiceRecord fields that reference it — so a future
  recovery can match identifiers between a backup and the live database.
- **BACKUPS.json** in the Drive root lists every backup generation.

Retention: it is a *full cumulative* backup each time. The newest **2**
completed backups are kept; the oldest is deleted only **after** a new backup
finished and its manifest was written.

## How it runs

Two Vercel cron entries hit the project's production URL:

| Endpoint | Schedule (UTC) | What it does |
|---|---|---|
| `GET /api/start` | `0 3 1 * *` (1st of month, 08:30 IST) | Creates a run: makes the Drive folder, enumerates all items, writes the starting manifest. Refuses to start if a run is already active. |
| `GET /api/work` | `*/10 * * * *` | Worker ticks: uploads pending items inside a ~660s budget, then finalizes, rotates old backups and rewrites the index. Exits in under a second when there is nothing to do. It also **catches up** (starts a run automatically) if the last completed backup is older than 32 days, and automatically retries failed backups. |

Both endpoints require `Authorization: Bearer <CRON_SECRET>`; Vercel sends
that automatically for cron invocations. Manual trigger:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<project>.vercel.app/api/start?force=1
curl -H "Authorization: Bearer $CRON_SECRET" "https://<project>.vercel.app/api/start?retry=<runId>"
```

Failures: every item gets 3 attempts per wave with backoff; a failed wave is
retried after 15 minutes, up to 5 waves; a failed run is auto-retried by the
worker (up to 3 times, 6h apart) and admins receive an in-app notification +
audit-log entry for `backup_started` / `backup_completed` / `backup_failed` /
`backup_rotated`. A run can always be revived manually with `?retry=<runId>`.

Concurrency: a database lock guarantees only one worker processes at a time —
duplicate cron deliveries are harmless.

## One-time setup

### 1. Google Cloud (service account)

1. Create (or reuse) a Google Cloud project → enable the **Google Drive API**.
2. IAM & Admin → **Service Accounts** → create one (e.g. `bpin-backup`) — no
   roles needed at project level.
3. On that account: **Keys → Add key → Create new key → JSON** → download.
   That JSON goes into `GOOGLE_SERVICE_ACCOUNT_JSON` (raw JSON or base64).

### 2. Google Workspace (Shared Drive)

Service accounts have **no storage quota of their own**, so uploads must live
in a Shared Drive:

1. In Google Drive, create a **Shared Drive** (e.g. "BPIN Backups"). Shared
   Drives require Google Workspace; a personal Gmail account cannot use this
   flow.
2. Open the Shared Drive → **Manage members** → add the service account's
   `client_email` (from the JSON key, looks like
   `bpin-backup@<project>.iam.gserviceaccount.com`) as **Content manager**.
3. Copy the Shared Drive ID from the URL:
   `drive.google.com/drive/folders/<GOOGLE_SHARED_DRIVE_ID>`.

The job creates a `BPIN CRM Backups` folder inside that Shared Drive by
itself (name configurable).

### 3. Vercel project

1. New Project → import this repository → set **Root Directory** to
   `backup-cron` (framework preset: Other).
2. Environment variables (Production):
   `MONGODB_URI`, `BLOB_READ_WRITE_TOKEN`, `CRON_SECRET`
   (`openssl rand -hex 24`), `GOOGLE_SERVICE_ACCOUNT_JSON`,
   `GOOGLE_SHARED_DRIVE_ID`, optionally `DRIVE_ROOT_FOLDER_NAME`,
   `BACKUP_TIME_BUDGET_SECONDS`, `BACKUP_KEEP`.
3. Deploy, then check **Settings → Cron Jobs** — both schedules must be
   listed. Cron invocations only run against **production** deployments.
4. Trigger the first backup manually with the curl above, then watch
   **Logs** — `/api/work` ticks pick it up within 10 minutes.

## Local development

```bash
cd backup-cron
cp .env.example .env        # fill in real values
npm install

# no Google credentials yet? mirror "Drive" to a local folder:
#   DRIVE_LOCAL_DIR=./.drive-local
npm run local               # start + worker ticks until the run completes
```

`npm run local -- --retry=<runId>` revives a failed run.

## Files

- `api/start.js`, `api/work.js` — cron endpoints (CRON_SECRET-protected).
- `lib/backup.js` — orchestration: start, worker, retries, finalize, rotate.
- `lib/drive.js` — Drive access (service account → Shared Drive; or local folder in dev).
- `lib/dumps.js` — streaming Mongo → NDJSON → gzip with sha256/byte counts.
- `lib/media.js` — Blob store enumeration, private streaming reads, DB cross-references.
- `lib/manifest.js` — manifest + BACKUPS.json builders.
- `lib/notify.js` — admin in-app notifications + audit entries.
- `lib/db.js` — Atlas connection + job collections (`backup_runs`, `backup_items`, `backup_lock`).

## Restore (future work)

Restore is intentionally not implemented yet. The manifest inside each backup
provides what it needs: per-collection files with document counts and
checksums, and for every media file its `pathname`, the DB records that
reference it, size and sha256. A recovery flow can therefore decide per
record whether a media file already exists in the live Blob store (by
`pathname`) before restoring anything.

## Notes / troubleshooting

- `storageQuotaExceeded` from Google means the upload landed in a My Drive
  context instead of the Shared Drive — check that the SA is a member of the
  Shared Drive and `GOOGLE_SHARED_DRIVE_ID` is the Shared Drive (not a folder
  inside it).
- Drive folder sizes: every backup re-uploads all media, so the two kept
  generations together use roughly 2× the current Blob-store size.
- All Drive paths preserve the blob pathname verbatim under `media/`, e.g.
  `media/bpin/records/2026-10-18/photo-ab12cd34.jpg`.
