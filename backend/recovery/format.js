import zlib from 'node:zlib'
import { createHash } from 'node:crypto'
import mongoose from 'mongoose'

// Business collections captured by the backup pipeline. Keep this in sync
// with backup-cron/lib/db.js — a checkpoint must contain all of them.
export const APP_COLLECTIONS = [
  'users',
  'products',
  'problems',
  'servicerecords',
  'assignments',
  'notifications',
  'auditlogs',
  'counters',
]

// These collections are intentionally excluded from backups AND from DB
// restores, so recovery history survives a rollback.
export const RECOVERY_COLLECTIONS = ['recovery_operations', 'recovery_events', 'recovery_lock']

export const SNAPSHOT_KIND = 'bpin-restore-snapshot'
export const SNAPSHOT_PREFIX = 'pre-restore'
export const CONFIRMATION_PHRASE = 'RESTORE BPIN CRM'

export const MODES = ['db', 'assets', 'both']
export const MODE_LABELS = {
  db: 'Database only',
  assets: 'Images and videos only',
  both: 'Database + images/videos',
}

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

export const gzipBuffer = (buf) => zlib.gzipSync(buf)
export const gunzipBuffer = (buf) => zlib.gunzipSync(buf)

export function parseNdjson(buffer, { maxLineBytes = 1024 * 1024, maxLines = 1_000_000 } = {}) {
  const docs = []
  for (const line of buffer.toString('utf8').split('\n')) {
    if (!line.trim()) continue
    if (line.length > maxLineBytes) throw new Error('Backup contains an oversized document line')
    if (docs.length >= maxLines) throw new Error('Backup contains too many documents')
    let doc
    try {
      doc = JSON.parse(line)
    } catch {
      throw new Error('Backup contains malformed JSON')
    }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('Backup contains a non-object document')
    docs.push(reviveDocument(doc))
  }
  return docs
}

// Backups store documents as plain JSON, so ObjectIds become hex strings and
// Dates become ISO strings. Revive them before writing restored documents back
// into MongoDB — otherwise sessions stop resolving and relations break.
const OID_KEY_RX = /^(_id|technician|product|closedBy|assignedTo|assignedBy|recipient|actor|ref)$/
const OID_VALUE_RX = /^[a-f0-9]{24}$/i
const DATE_KEY_RX = /(At|Date)$/
const DATE_VALUE_RX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/

export function reviveDocument(value, key = null) {
  if (typeof value === 'string') {
    if (key && OID_KEY_RX.test(key) && OID_VALUE_RX.test(value)) return new mongoose.Types.ObjectId(value)
    if (key && (DATE_KEY_RX.test(key) || key === 'last') && DATE_VALUE_RX.test(value)) return new Date(value)
    return value
  }
  if (Array.isArray(value)) return value.map((entry) => reviveDocument(entry))
  if (value && typeof value === 'object') {
    const out = {}
    for (const [childKey, childValue] of Object.entries(value)) out[childKey] = reviveDocument(childValue, childKey)
    return out
  }
  return value
}

export async function dumpCollectionBuffer(db, name) {
  const lines = []
  let docs = 0
  const cursor = db.collection(name).find({}, { batchSize: 500 })
  for await (const doc of cursor) {
    docs += 1
    lines.push(`${JSON.stringify(doc)}\n`)
  }
  const gz = gzipBuffer(Buffer.from(lines.join(''), 'utf8'))
  return { buffer: gz, docs, bytes: gz.length, sha256: sha256(gz) }
}

export async function readStreamToBuffer(stream) {
  const chunks = []
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks)
}

// Blob pathname safety: relative, no traversal, no control characters.
export function isSafePathname(pathname) {
  if (typeof pathname !== 'string' || !pathname.length || pathname.length > 512) return false
  if (pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0')) return false
  if (pathname.split('/').some((part) => part === '..' || part === '.' || part === '')) return false
  return /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(pathname)
}

export const guessContentType = (pathname) => {
  const ext = String(pathname).split('.').pop()?.toLowerCase()
  const map = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
  }
  return map[ext] || 'application/octet-stream'
}

export function modeIncludes(mode, part) {
  if (mode === 'db') return part === 'db'
  if (mode === 'assets') return part === 'assets'
  if (mode === 'both') return true
  return false
}

export const TERMINAL_STATUSES = ['completed', 'partial_failure', 'rolled_back', 'failed', 'manual_intervention_required']
export const ACTIVE_STATUSES = [
  'pending',
  'validating',
  'snapshotting',
  'ready',
  'restoring_database',
  'restoring_assets',
  'verifying',
  'rolling_back',
]

export const canonicalMediaUrl = (pathname) => `/api/files?path=${encodeURIComponent(pathname)}`

// Walks the media arrays of a ServiceRecord-shaped document and returns the
// blob pathnames it references, ignoring legacy Cloudinary items.
export function collectRecordBlobRefs(record) {
  const refs = []
  const add = (item, section) => {
    if (!item || typeof item.url !== 'string' || !item.url.startsWith('/api/files?path=')) return
    let pathname
    try {
      pathname = decodeURIComponent(item.url.slice('/api/files?path='.length))
    } catch {
      return
    }
    if (!isSafePathname(pathname)) return
    refs.push({ pathname, section, url: item.url, kind: item.kind || 'image' })
  }
  ;(record.images || []).forEach((m, i) => add(m, `images[${i}]`))
  ;((record.closure && record.closure.images) || []).forEach((m, i) => add(m, `closure.images[${i}]`))
  ;(record.followUps || []).forEach((f, j) => (f?.images || []).forEach((m, i) => add(m, `followUps[${j}].images[${i}]`)))
  return refs.map((r) => ({ ...r, tokenNo: record.tokenNo, recordId: String(record._id) }))
}
