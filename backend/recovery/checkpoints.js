import { getDrive, DRIVE_FOLDER_MIME } from './drive.js'
import { APP_COLLECTIONS, isSafePathname } from './format.js'

const FOLDER_RX = /^bpin-backup-\d{4}-\d{2}-\d{2}_\d{4}$/
const SHA_RX = /^[a-f0-9]{64}$/

// Server-side inventory. Checkpoint ids are Drive folder ids discovered by
// listing the expected root folder — arbitrary user-supplied ids are never
// trusted and are re-validated against this list at restore time.

export async function listCheckpoints() {
  const drive = await getDrive()
  const rootId = await drive.ensureRootFolder()
  const children = await drive.listChildren(rootId)
  const folders = children.filter((c) => c.mimeType === DRIVE_FOLDER_MIME && FOLDER_RX.test(c.name))
  const items = []
  for (const folder of folders) items.push(await inspectCheckpoint(drive, folder))
  items.sort((a, b) => String(b.completedAt || b.name).localeCompare(String(a.completedAt || a.name)))
  return { rootFolder: rootId, items }
}

export async function loadCheckpoint(checkpointId) {
  const drive = await getDrive()
  const rootId = await drive.ensureRootFolder()
  const children = await drive.listChildren(rootId)
  const folder = children.find((c) => c.id === checkpointId && c.mimeType === DRIVE_FOLDER_MIME && FOLDER_RX.test(c.name))
  if (!folder) {
    const err = new Error('Checkpoint not found in the backup location')
    err.status = 404
    throw err
  }
  const entry = await inspectCheckpoint(drive, folder)
  return { drive, folder, checkpoint: entry }
}

export async function inspectCheckpoint(drive, folder) {
  const entry = {
    id: folder.id,
    name: folder.name,
    manifestStatus: 'missing',
    startedAt: null,
    cutoffAt: null,
    completedAt: null,
    valid: false,
    restorable: { db: false, assets: false, both: false },
    db: { valid: false, collections: 0, docs: 0, bytes: 0, errors: [] },
    media: { valid: false, files: 0, bytes: 0, errors: [] },
    integrity: { manifest: false, dbFiles: 'not_checked', mediaFiles: 'not_checked' },
    errors: [],
    warnings: [],
    totals: { dbBytes: 0, mediaBytes: 0, totalBytes: 0 },
    manifest: null,
  }

  try {
    const manifestFile = await drive.findInFolderByName(folder.id, 'manifest.json')
    if (!manifestFile) {
      entry.errors.push('manifest.json is missing')
      return entry
    }
    const manifest = JSON.parse((await drive.downloadFile(manifestFile.id)).toString('utf8'))
    entry.manifest = manifest
    entry.integrity.manifest = true
    validateManifest(manifest, entry)

    // Verify the files the restore would read actually exist and have the
    // manifest's sizes (content checksums are re-verified in dry-run/execute).
    const dbFolder = await drive.findInFolderByName(folder.id, 'db')
    const dbChildren = dbFolder ? await drive.listChildren(dbFolder.id) : []
    const byFileName = new Map(dbChildren.map((c) => [c.name, c]))
    for (const collection of manifest.db?.collections || []) {
      const fileName = String(collection.file || '').split('/').pop()
      const file = byFileName.get(fileName)
      if (!file) {
        entry.db.errors.push(`missing file ${collection.file}`)
        continue
      }
      if (file.size !== null && Number(collection.bytes) !== file.size) {
        entry.db.errors.push(`size mismatch for ${collection.file}`)
      }
    }
    entry.integrity.dbFiles = dbChildren.length ? 'present' : 'missing'

    if ((manifest.media?.files || []).length > 0) {
      const mediaFolder = await drive.findInFolderByName(folder.id, 'media')
      if (!mediaFolder) {
        entry.media.errors.push('media folder is missing')
        entry.integrity.mediaFiles = 'missing'
      } else {
        entry.integrity.mediaFiles = 'present'
      }
    } else {
      entry.integrity.mediaFiles = 'none_required'
    }
  } catch (err) {
    entry.errors.push(`manifest could not be read: ${err.message}`)
  }

  entry.db.valid = entry.db.errors.length === 0
  entry.media.valid = entry.media.errors.length === 0
  entry.valid = entry.errors.length === 0 && entry.db.valid && entry.media.valid
  entry.restorable = {
    db: entry.db.valid,
    assets: entry.media.valid,
    both: entry.db.valid && entry.media.valid,
  }
  entry.totals = {
    dbBytes: entry.db.bytes,
    mediaBytes: entry.media.bytes,
    totalBytes: entry.db.bytes + entry.media.bytes,
  }
  entry.errors = [...entry.errors, ...entry.db.errors, ...entry.media.errors]
  return entry
}

function validateManifest(manifest, entry) {
  if (!manifest || typeof manifest !== 'object') {
    entry.errors.push('manifest is not an object')
    return
  }
  if (manifest.kind !== 'bpin-crm-backup') entry.errors.push('manifest kind is not bpin-crm-backup')
  if (manifest.version !== 1) entry.errors.push(`unsupported manifest version: ${manifest.version}`)
  entry.manifestStatus = manifest.status || 'unknown'
  if (manifest.status !== 'completed') entry.errors.push(`backup status is "${manifest.status}"`)
  if (manifest.checks && Number(manifest.checks.failed) > 0) entry.errors.push('backup reports failed items')
  entry.startedAt = manifest.startedAt || null
  entry.cutoffAt = manifest.cutoffAt || null
  entry.completedAt = manifest.completedAt || null

  const collections = Array.isArray(manifest.db?.collections) ? manifest.db.collections : []
  const byName = new Map()
  for (const c of collections) byName.set(c.name, c)
  entry.db.collections = 0
  entry.db.docs = 0
  entry.db.bytes = 0
  for (const name of APP_COLLECTIONS) {
    const c = byName.get(name)
    if (!c) {
      entry.db.errors.push(`missing collection: ${name}`)
      continue
    }
    entry.db.collections += 1
    if (c.status !== 'done') entry.db.errors.push(`collection ${name} is not complete`)
    if (!SHA_RX.test(String(c.sha256 || ''))) entry.db.errors.push(`collection ${name} has no checksum`)
    if (!Number.isFinite(c.docs) || c.docs < 0) entry.db.errors.push(`collection ${name} has no document count`)
    if (!Number.isFinite(c.bytes) || c.bytes < 0) entry.db.errors.push(`collection ${name} has no byte count`)
    if (c.file !== `db/${name}.ndjson.gz`) entry.db.errors.push(`collection ${name} has an unexpected file name`)
    if (Number.isFinite(c.docs)) entry.db.docs += c.docs
    if (Number.isFinite(c.bytes)) entry.db.bytes += c.bytes
  }

  const mediaFiles = Array.isArray(manifest.media?.files) ? manifest.media.files : []
  entry.media.files = mediaFiles.length
  entry.media.bytes = 0
  for (const f of mediaFiles) {
    if (!isSafePathname(f.pathname)) entry.media.errors.push('media entry has an unsafe pathname')
    if (!SHA_RX.test(String(f.sha256 || ''))) entry.media.errors.push(`media ${f.pathname || '?'} has no checksum`)
    if (!Number.isFinite(f.bytes) || f.bytes < 0) entry.media.errors.push(`media ${f.pathname || '?'} has no byte count`)
    if (f.file !== `media/${f.pathname}`) entry.media.errors.push(`media ${f.pathname || '?'} has an unexpected file path`)
    if (Number.isFinite(f.bytes)) entry.media.bytes += f.bytes
  }
  if (manifest.media?.totals && Number.isFinite(manifest.media.totals.files) && manifest.media.totals.files !== mediaFiles.length) {
    entry.media.errors.push('media totals do not match the file list')
  }
}
