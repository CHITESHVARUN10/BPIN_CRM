import fs from 'node:fs'
import path from 'node:path'

let cached = null

export function getEnv() {
  if (!cached) {
    cached = {
      mongoUri: process.env.MONGODB_URI || '',
      blobToken: process.env.BLOB_READ_WRITE_TOKEN || '',
      cronSecret: process.env.CRON_SECRET || '',
      serviceAccountJson:
        process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
        process.env.SERVICE_ACCOUNT_JSON ||
        process.env.GOOGLE_SERVICE_ACCOUNT_KEY ||
        '',
      serviceAccountFile: process.env.GOOGLE_SERVICE_ACCOUNT_FILE || '',
      sharedDriveId: process.env.SHARED_DRIVE_ID || process.env.GOOGLE_SHARED_DRIVE_ID || '',
      sharedDriveName: process.env.SHARED_DRIVE_NAME || process.env.GOOGLE_SHARED_DRIVE_NAME || '',
      rootFolderName: process.env.DRIVE_ROOT_FOLDER_NAME || 'BPIN CRM Backups',
      localDriveDir: process.env.DRIVE_LOCAL_DIR || '',
      timeBudgetSeconds: Math.max(5, Number(process.env.BACKUP_TIME_BUDGET_SECONDS || 660)),
      keep: Math.max(1, Number(process.env.BACKUP_KEEP || 2)),
      // Diagnostics only — shorten retry cycles to drill failure handling locally.
      waveCooldownSeconds: Math.max(1, Number(process.env.BACKUP_WAVE_COOLDOWN_SECONDS || 900)),
      maxItemWaves: Math.max(1, Number(process.env.BACKUP_MAX_ITEM_WAVES || 5)),
      runRetryCooldownSeconds: Math.max(1, Number(process.env.BACKUP_RUN_RETRY_COOLDOWN_SECONDS || 21600)),
    }
  }
  return cached
}

// The service-account key can be provided three ways:
//   1. GOOGLE_SERVICE_ACCOUNT_JSON — raw JSON (or its base64) — use this on Vercel
//   2. GOOGLE_SERVICE_ACCOUNT_FILE — path to the downloaded key file
//   3. ./service-account.json next to this project (local convenience, gitignored)
export function serviceAccountRaw() {
  const env = getEnv()
  if (env.serviceAccountJson) return env.serviceAccountJson
  const candidates = [env.serviceAccountFile, path.join(process.cwd(), 'service-account.json')].filter(Boolean)
  for (const candidate of candidates) {
    try {
      return fs.readFileSync(candidate, 'utf8')
    } catch {
      // try the next candidate
    }
  }
  return ''
}

export function assertConfigured() {
  const env = getEnv()
  const missing = []
  if (!env.mongoUri) missing.push('MONGODB_URI')
  if (!env.blobToken) missing.push('BLOB_READ_WRITE_TOKEN')
  if (!env.cronSecret) missing.push('CRON_SECRET')
  if (!env.localDriveDir) {
    if (!serviceAccountRaw()) missing.push('GOOGLE_SERVICE_ACCOUNT_JSON (or GOOGLE_SERVICE_ACCOUNT_FILE / ./service-account.json)')
    if (!env.sharedDriveId && !env.sharedDriveName) missing.push('SHARED_DRIVE_ID (or SHARED_DRIVE_NAME)')
  }
  if (missing.length) throw new Error(`Missing configuration: ${missing.join(', ')}`)
  return env
}

export function parseServiceAccount(raw) {
  const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')
  const sa = JSON.parse(text)
  if (!sa.client_email || !sa.private_key) throw new Error('Service-account key is not valid (client_email/private_key missing)')
  return sa
}

export function isAuthorized(req) {
  const secret = getEnv().cronSecret
  if (!secret) return false
  const header = req.headers?.authorization || req.headers?.Authorization || ''
  return header === `Bearer ${secret}`
}
