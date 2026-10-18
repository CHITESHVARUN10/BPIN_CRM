let cached = null

export function getEnv() {
  if (!cached) {
    cached = {
      mongoUri: process.env.MONGODB_URI || '',
      blobToken: process.env.BLOB_READ_WRITE_TOKEN || '',
      cronSecret: process.env.CRON_SECRET || '',
      serviceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '',
      sharedDriveId: process.env.GOOGLE_SHARED_DRIVE_ID || '',
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

export function assertConfigured() {
  const e = getEnv()
  const missing = []
  if (!e.mongoUri) missing.push('MONGODB_URI')
  if (!e.blobToken) missing.push('BLOB_READ_WRITE_TOKEN')
  if (!e.cronSecret) missing.push('CRON_SECRET')
  if (!e.localDriveDir) {
    if (!e.serviceAccountJson) missing.push('GOOGLE_SERVICE_ACCOUNT_JSON')
    if (!e.sharedDriveId) missing.push('GOOGLE_SHARED_DRIVE_ID')
  }
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`)
  return e
}

export function parseServiceAccount(raw) {
  const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')
  const sa = JSON.parse(text)
  if (!sa.client_email || !sa.private_key) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not a valid service-account key')
  return sa
}

export function isAuthorized(req) {
  const secret = getEnv().cronSecret
  if (!secret) return false
  const header = req.headers?.authorization || req.headers?.Authorization || ''
  return header === `Bearer ${secret}`
}
