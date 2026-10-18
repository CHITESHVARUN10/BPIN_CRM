import { Readable } from 'node:stream'
import mongoose from 'mongoose'
import { getEnv } from './env.js'
import { connect, APP_COLLECTIONS } from './db.js'
import { getDrive } from './drive.js'
import { dumpCollectionStream, countedTransform } from './dumps.js'
import { listAllBlobs, openBlobStream, buildBlobRefMap } from './media.js'
import { buildManifest, buildIndex } from './manifest.js'
import { notifyAdmins, audit } from './notify.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const clamp = (value, n = 500) => String(value ?? '').slice(0, n)
const pad = (n) => String(n).padStart(2, '0')

const folderNameNow = (d = new Date()) =>
  `bpin-backup-${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}_${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`

const ITEM_TRIES_PER_WAVE = 3
const ITEM_TRIES_DELAYS_MS = [0, 1500, 5000]
const MAX_ITEM_WAVES_FALLBACK = 5
const WAVE_COOLDOWN_MS_FALLBACK = 15 * 60 * 1000
const MAX_RUN_RETRIES = 3
const STALE_UPLOADING_MS = 15 * 60 * 1000
const LOCK_TTL_MS = 15 * 60 * 1000
const CATCH_UP_AFTER_MS = 32 * 24 * 60 * 60 * 1000

const maxItemWaves = () => getEnv().maxItemWaves || MAX_ITEM_WAVES_FALLBACK
const waveCooldownMs = () => (getEnv().waveCooldownSeconds || WAVE_COOLDOWN_MS_FALLBACK / 1000) * 1000

const guessContentType = (pathname) => {
  const ext = pathname.split('.').pop()?.toLowerCase()
  const map = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    json: 'application/json',
  }
  return map[ext] || 'application/octet-stream'
}

// ── Locking ──────────────────────────────────────────────────────────────────

async function acquireLock(db, holder) {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + LOCK_TTL_MS)
  try {
    const res = await db.collection('backup_lock').findOneAndUpdate(
      { _id: 'backup', $or: [{ expiresAt: { $lt: now } }, { holder }] },
      { $set: { holder, expiresAt, updatedAt: now } },
      { upsert: true, returnDocument: 'after' },
    )
    const doc = res && (res.value ?? res)
    return Boolean(doc && doc.holder === holder)
  } catch (err) {
    if (err?.code === 11000) return false
    throw err
  }
}

async function releaseLock(db, holder) {
  try {
    await db.collection('backup_lock').deleteOne({ _id: 'backup', holder })
  } catch {
    // lock expires on its own if this fails
  }
}

// ── Drive file helpers ───────────────────────────────────────────────────────

async function replaceFile(drive, parentId, name, content, mimeType) {
  const existing = await drive.findInFolderByName(parentId, name)
  if (existing) await drive.deleteFile(existing.id)
  return drive.uploadStream({
    parentId,
    name,
    mimeType: mimeType || guessContentType(name),
    stream: Readable.from([content]),
  })
}

async function writeManifest(db, run) {
  const drive = await getDrive()
  const items = await db.collection('backup_items').find({ runId: run._id }).toArray()
  const manifest = buildManifest(run, items)
  return replaceFile(drive, run.drive.folderId, 'manifest.json', JSON.stringify(manifest, null, 2), 'application/json')
}

async function writeIndex(db) {
  const drive = await getDrive()
  const runs = await db
    .collection('backup_runs')
    .find({ status: { $in: ['completed', 'rotated'] } })
    .sort({ startedAt: -1 })
    .toArray()
  const rootId = await drive.ensureRootFolder()
  return replaceFile(drive, rootId, 'BACKUPS.json', JSON.stringify(buildIndex(runs), null, 2), 'application/json')
}

// ── Start a run ──────────────────────────────────────────────────────────────

export async function startRun({ source = 'manual' } = {}) {
  const db = await connect()
  const env = getEnv()

  const active = await db.collection('backup_runs').findOne({
    $or: [{ status: 'running' }, { status: 'failed', retryAttempts: { $lt: MAX_RUN_RETRIES } }],
  })
  if (active) {
    return {
      started: false,
      reason: active.status === 'running' ? 'a backup is already running' : 'a failed backup is awaiting automatic retry',
      runId: String(active._id),
    }
  }

  const drive = await getDrive()
  const rootId = await drive.ensureRootFolder()
  const folderName = folderNameNow()
  const { id: folderId } = await drive.createFolder(folderName, rootId)

  const now = new Date()
  const runDoc = {
    status: 'running',
    source,
    startedAt: now,
    cutoffAt: now,
    completedAt: null,
    rotatedAt: null,
    keep: env.keep,
    retryAttempts: 0,
    lastRetryAt: null,
    lastError: null,
    drive: { folderId, folderName, rootId },
    totals: { dbCollections: APP_COLLECTIONS.length, dbDocs: 0, mediaFiles: 0, mediaBytes: 0 },
    createdAt: now,
    updatedAt: now,
  }
  const { insertedId: runId } = await db.collection('backup_runs').insertOne(runDoc)

  const items = []
  const makeItem = (type, key, fileName, extra = {}) => ({
    runId,
    type,
    key,
    fileName,
    status: 'pending',
    attempts: 0,
    waves: 0,
    attemptGateAt: null,
    lastError: null,
    driveFileId: null,
    bytes: null,
    sha256: null,
    docs: null,
    contentType: null,
    meta: null,
    refs: [],
    createdAt: now,
    updatedAt: now,
    ...extra,
  })

  for (const name of APP_COLLECTIONS) items.push(makeItem('db', name, `db/${name}.ndjson.gz`))

  const blobs = await listAllBlobs()
  const refMap = await buildBlobRefMap(db)
  for (const blob of blobs) {
    items.push(
      makeItem('media', blob.pathname, `media/${blob.pathname}`, {
        meta: { size: blob.size, uploadedAt: blob.uploadedAt, contentType: blob.contentType },
        refs: refMap.get(blob.pathname) || [],
      }),
    )
  }

  for (let i = 0; i < items.length; i += 500) {
    try {
      await db.collection('backup_items').insertMany(items.slice(i, i + 500), { ordered: false })
    } catch (err) {
      if (err?.code !== 11000) throw err
    }
  }

  const mediaItems = items.filter((i) => i.type === 'media')
  const mediaBytes = mediaItems.reduce((acc, i) => acc + (i.meta?.size || 0), 0)
  await db.collection('backup_runs').updateOne(
    { _id: runId },
    { $set: { 'totals.plannedMediaFiles': mediaItems.length, 'totals.plannedMediaBytes': mediaBytes } },
  )

  const run = { ...runDoc, _id: runId }
  await writeManifest(db, run)
  await audit(db, {
    action: 'backup_started',
    targetId: runId,
    targetLabel: folderName,
    detail: `Full backup started: ${APP_COLLECTIONS.length} collections, ${mediaItems.length} media file(s)`,
  })
  await notifyAdmins(db, {
    title: 'Backup started',
    body: `A new full backup started (${folderName}). It runs in the background and usually finishes within a few minutes.`,
  })

  return {
    started: true,
    runId: String(runId),
    folder: folderName,
    collections: APP_COLLECTIONS.length,
    mediaFiles: mediaItems.length,
    mediaBytes,
  }
}

export async function retryRun(runId) {
  const db = await connect()
  let id
  try {
    id = new mongoose.Types.ObjectId(runId)
  } catch {
    throw new Error('retry: invalid run id')
  }
  const run = await db.collection('backup_runs').findOne({ _id: id })
  if (!run) throw new Error('retry: run not found')

  const revived = await db
    .collection('backup_items')
    .updateMany(
      { runId: id, status: 'failed' },
      { $set: { status: 'pending', waves: 0, attemptGateAt: null, lastError: null, updatedAt: new Date() } },
    )
  await db.collection('backup_runs').updateOne(
    { _id: id },
    { $set: { status: 'running', lastRetryAt: new Date(), updatedAt: new Date() }, $inc: { retryAttempts: 1 } },
  )
  await audit(db, {
    action: 'backup_retry_manual',
    targetId: id,
    targetLabel: run.drive?.folderName,
    detail: `Manual retry requested (${revived.modifiedCount} item(s) revived)`,
  })
  return { retried: true, runId: String(id), itemsRevived: revived.modifiedCount, status: 'running' }
}

// ── Worker ───────────────────────────────────────────────────────────────────

async function resetStaleUploading(db) {
  await db
    .collection('backup_items')
    .updateMany(
      { status: 'uploading', updatedAt: { $lt: new Date(Date.now() - STALE_UPLOADING_MS) } },
      { $set: { status: 'pending', updatedAt: new Date() } },
    )
}

async function catchUp(db) {
  const active = await db.collection('backup_runs').countDocuments({
    $or: [{ status: 'running' }, { status: 'failed', retryAttempts: { $lt: MAX_RUN_RETRIES } }],
  })
  if (active > 0) return false
  const last = await db
    .collection('backup_runs')
    .findOne({ status: { $in: ['completed', 'rotated'] } }, { sort: { completedAt: -1 } })
  if (!last) return false // no history yet — first run comes from the monthly cron or a manual trigger
  const age = Date.now() - new Date(last.completedAt).getTime()
  if (age < CATCH_UP_AFTER_MS) return false
  try {
    const res = await startRun({ source: 'catch-up' })
    return res.started
  } catch {
    return false
  }
}

async function reviveRun(db, run) {
  await db
    .collection('backup_items')
    .updateMany(
      { runId: run._id, status: 'failed' },
      { $set: { status: 'pending', waves: 0, attemptGateAt: null, lastError: null, updatedAt: new Date() } },
    )
  await db.collection('backup_runs').updateOne(
    { _id: run._id },
    { $set: { status: 'running', lastRetryAt: new Date(), updatedAt: new Date() }, $inc: { retryAttempts: 1 } },
  )
  await audit(db, {
    action: 'backup_retry',
    targetId: run._id,
    targetLabel: run.drive?.folderName,
    detail: 'Automatic retry of a failed backup',
  })
}

const isRunRetryDue = (run) =>
  !run.lastRetryAt || Date.now() - new Date(run.lastRetryAt).getTime() > getEnv().runRetryCooldownSeconds * 1000

async function nextReadyItem(db, runId) {
  return db.collection('backup_items').findOne(
    { runId, status: 'pending', $or: [{ attemptGateAt: null }, { attemptGateAt: { $lte: new Date() } }] },
    { sort: { attempts: 1, _id: 1 } },
  )
}

async function claimItem(db, item) {
  const res = await db.collection('backup_items').findOneAndUpdate(
    { _id: item._id, status: 'pending' },
    { $set: { status: 'uploading', updatedAt: new Date() } },
    { returnDocument: 'after' },
  )
  return res && (res.value ?? res)
}

async function uploadItem(db, run, item) {
  const drive = await getDrive()

  // remove any half-written file from a previous attempt so retries
  // never leave duplicates behind in the run folder
  const existing = await drive.findInFolderByName(run.drive.folderId, item.fileName)
  if (existing) await drive.deleteFile(existing.id)

  let sourceStream
  let contentType
  let docsFn = null
  if (item.type === 'db') {
    const dump = dumpCollectionStream(db, item.key)
    sourceStream = dump.stream
    docsFn = dump.docs
    contentType = 'application/gzip'
  } else {
    const blob = await openBlobStream(item.key)
    sourceStream = blob.stream
    contentType = blob.contentType || guessContentType(item.key)
  }

  const counted = countedTransform()
  sourceStream.on('error', (err) => counted.transform.destroy(err))
  sourceStream.pipe(counted.transform)

  const up = await drive.uploadStream({
    parentId: run.drive.folderId,
    name: item.fileName,
    mimeType: contentType,
    stream: counted.transform,
  })
  const stats = counted.stats()
  return {
    driveFileId: up.id,
    bytes: stats.bytes,
    sha256: stats.sha256,
    docs: docsFn ? docsFn() : null,
    contentType,
  }
}

async function processItemWithRetries(db, run, item) {
  let lastErr = null
  for (let tryIndex = 0; tryIndex < ITEM_TRIES_PER_WAVE; tryIndex++) {
    const delay = ITEM_TRIES_DELAYS_MS[tryIndex]
    if (delay) await sleep(delay)
    try {
      const result = await uploadItem(db, run, item)
      await db.collection('backup_items').updateOne(
        { _id: item._id },
        {
          $set: {
            status: 'done',
            driveFileId: result.driveFileId,
            bytes: result.bytes,
            sha256: result.sha256,
            docs: result.docs ?? item.docs ?? null,
            contentType: result.contentType || null,
            lastError: null,
            attemptGateAt: null,
            updatedAt: new Date(),
          },
        },
      )
      const inc = { 'totals.itemsDone': 1 }
      if (item.type === 'db') inc['totals.dbDocs'] = result.docs || 0
      else {
        inc['totals.mediaFiles'] = 1
        inc['totals.mediaBytes'] = result.bytes || 0
      }
      await db.collection('backup_runs').updateOne({ _id: run._id }, { $inc: inc, $set: { updatedAt: new Date() } })
      return
    } catch (err) {
      lastErr = err
      await db.collection('backup_items').updateOne(
        { _id: item._id },
        { $inc: { attempts: 1 }, $set: { lastError: clamp(err?.message || err), updatedAt: new Date() } },
      )
    }
  }

  const waves = (item.waves || 0) + 1
  if (waves >= maxItemWaves()) {
    await db.collection('backup_items').updateOne(
      { _id: item._id },
      {
        $set: {
          status: 'failed',
          waves,
          attemptGateAt: null,
          lastError: clamp(lastErr?.message || lastErr),
          updatedAt: new Date(),
        },
      },
    )
  } else {
    await db.collection('backup_items').updateOne(
      { _id: item._id },
      {
        $set: {
          status: 'pending',
          waves,
          attemptGateAt: new Date(Date.now() + waveCooldownMs()),
          lastError: clamp(lastErr?.message || lastErr),
          updatedAt: new Date(),
        },
      },
    )
  }
}

async function finalizeRun(db, run) {
  const failedCount = await db.collection('backup_items').countDocuments({ runId: run._id, status: 'failed' })
  if (failedCount > 0) {
    const error = `Backup incomplete — ${failedCount} item(s) failed after all retries`
    await db.collection('backup_runs').updateOne(
      { _id: run._id },
      { $set: { status: 'failed', lastError: error, updatedAt: new Date() } },
    )
    await audit(db, {
      action: 'backup_failed',
      targetId: run._id,
      targetLabel: run.drive?.folderName,
      detail: error,
    })
    await notifyAdmins(db, {
      title: 'Backup failed',
      body: `${run.drive?.folderName}: ${error}. An automatic retry will run; you can also trigger one manually with /api/start?retry=${String(run._id)}.`,
    })
    return 'failed'
  }

  const completedAt = new Date()
  await db.collection('backup_runs').updateOne(
    { _id: run._id },
    { $set: { status: 'completed', completedAt, lastError: null, updatedAt: completedAt } },
  )
  const doneRun = { ...run, status: 'completed', completedAt }
  await writeManifest(db, doneRun)

  const items = await db.collection('backup_items').find({ runId: run._id }).toArray()
  const mediaItems = items.filter((i) => i.type === 'media')
  const mediaBytes = mediaItems.reduce((acc, i) => acc + (i.bytes || 0), 0)
  await audit(db, {
    action: 'backup_completed',
    targetId: run._id,
    targetLabel: run.drive?.folderName,
    detail: `${items.length} items saved (${APP_COLLECTIONS.length} collections, ${mediaItems.length} media files, ${mediaBytes} bytes)`,
  })
  await notifyAdmins(db, {
    title: 'Backup completed',
    body: `${run.drive?.folderName} finished — ${APP_COLLECTIONS.length} collections and ${mediaItems.length} media file(s) are safely stored in Google Drive.`,
  })
  return 'completed'
}

async function rotate(db) {
  const env = getEnv()
  const drive = await getDrive()
  const completed = await db
    .collection('backup_runs')
    .find({ status: 'completed' })
    .sort({ completedAt: -1 })
    .toArray()
  const extra = completed.slice(env.keep)
  const rotated = []
  for (const run of extra) {
    try {
      if (run.drive?.folderId) await drive.deleteFolderRecursive(run.drive.folderId)
      await db.collection('backup_runs').updateOne(
        { _id: run._id },
        { $set: { status: 'rotated', rotatedAt: new Date(), updatedAt: new Date() } },
      )
      await audit(db, {
        action: 'backup_rotated',
        targetId: run._id,
        targetLabel: run.drive?.folderName,
        detail: `Oldest backup deleted — the newest ${env.keep} backups are kept`,
      })
      rotated.push(run.drive?.folderName)
    } catch {
      // deletion failed — it stays 'completed' and the next finalize retries
    }
  }
  await writeIndex(db)
  return rotated
}

export async function runWorker() {
  const db = await connect()
  const env = getEnv()
  const holder = `${process.env.VERCEL_REGION || 'local'}:${process.pid}:${Math.random().toString(36).slice(2)}`

  const got = await acquireLock(db, holder)
  if (!got) return { status: 'busy', message: 'another invocation holds the worker lock' }

  try {
    await resetStaleUploading(db)
    const catchUpStarted = await catchUp(db)

    let run = await db.collection('backup_runs').findOne({ status: 'running' }, { sort: { startedAt: 1 } })
    if (!run) {
      const failed = await db
        .collection('backup_runs')
        .findOne({ status: 'failed', retryAttempts: { $lt: MAX_RUN_RETRIES } }, { sort: { startedAt: 1 } })
      if (failed && isRunRetryDue(failed)) {
        await reviveRun(db, failed)
        run = await db.collection('backup_runs').findOne({ _id: failed._id })
      }
    }
    if (!run) return { status: catchUpStarted ? 'started' : 'idle' }

    const deadline = Date.now() + env.timeBudgetSeconds * 1000
    let processed = 0
    while (Date.now() < deadline) {
      const item = await nextReadyItem(db, run._id)
      if (!item) break
      const claimed = await claimItem(db, item)
      if (!claimed) continue
      processed += 1
      await processItemWithRetries(db, run, claimed)
    }

    const remaining = await db
      .collection('backup_items')
      .countDocuments({ runId: run._id, status: { $in: ['pending', 'uploading'] } })
    if (remaining === 0) {
      const outcome = await finalizeRun(db, run)
      if (outcome === 'completed') {
        const rotated = await rotate(db)
        return { status: 'completed', processed, rotated }
      }
      return { status: outcome, processed }
    }
    return { status: 'running', processed, remaining }
  } finally {
    await releaseLock(db, holder)
  }
}
