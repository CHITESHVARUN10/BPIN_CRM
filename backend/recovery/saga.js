import mongoose from 'mongoose'
import { getDrive } from './drive.js'
import { getMediaStore } from './mediaStore.js'
import { loadCheckpoint } from './checkpoints.js'
import {
  APP_COLLECTIONS,
  SNAPSHOT_KIND,
  SNAPSHOT_PREFIX,
  CONFIRMATION_PHRASE,
  MODES,
  sha256,
  gzipBuffer,
  gunzipBuffer,
  parseNdjson,
  dumpCollectionBuffer,
  guessContentType,
  modeIncludes,
  canonicalMediaUrl,
  collectRecordBlobRefs,
} from './format.js'
import { recoveryEvent } from './events.js'
import {
  ensureRecoveryIndexes,
  createOperation,
  getOperation,
  updateOperation,
  addStep,
  setProgress,
  startHeartbeat,
  acquireRestoreLock,
  releaseRestoreLock,
  newHolder,
  assertNoActiveOperation,
  flagStaleOperations,
  listOperations,
} from './store.js'

import User from '../models/User.js'
import Product from '../models/Product.js'
import Problem from '../models/Problem.js'
import ServiceRecord from '../models/ServiceRecord.js'
import Assignment from '../models/Assignment.js'
import Notification from '../models/Notification.js'
import AuditLog from '../models/AuditLog.js'

const INDEX_MODELS = [User, Product, Problem, ServiceRecord, Assignment, Notification, AuditLog]
const MAX_ASSET_MB = () => Math.max(1, Number(process.env.RECOVERY_MAX_ASSET_MB || 100))
const testFaults = () => new Set(String(process.env.RECOVERY_TEST_FAULTS || '').split(',').map((s) => s.trim()).filter(Boolean))

const dbHandle = () => mongoose.connection.db

function fail(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

// ── Public serializers ───────────────────────────────────────────────────────

export function publicCheckpoint(entry) {
  return {
    id: entry.id,
    name: entry.name,
    manifestStatus: entry.manifestStatus,
    startedAt: entry.startedAt,
    cutoffAt: entry.cutoffAt,
    completedAt: entry.completedAt,
    valid: entry.valid,
    restorable: entry.restorable,
    db: { valid: entry.db.valid, collections: entry.db.collections, docs: entry.db.docs, bytes: entry.db.bytes },
    media: { valid: entry.media.valid, files: entry.media.files, bytes: entry.media.bytes },
    integrity: entry.integrity,
    totals: entry.totals,
    errors: entry.errors,
    warnings: entry.warnings,
  }
}

export function publicOperation(op) {
  return {
    id: String(op._id),
    status: op.status,
    mode: op.mode,
    phase: op.phase,
    progress: op.progress,
    checkpoint: op.checkpoint,
    actor: op.actor,
    createdAt: op.createdAt,
    updatedAt: op.updatedAt,
    completedAt: op.completedAt || null,
    heartbeatAt: op.heartbeatAt,
    lastError: op.lastError || null,
    warnings: op.warnings || [],
    errors: op.errors || [],
    steps: (op.steps || []).slice(-80),
    plan: op.plan || null,
    snapshot: op.snapshot || null,
    result: op.result || null,
    rollback: op.rollback || null,
    verification: op.verification || null,
  }
}

function summarizePlan(plan) {
  return {
    mode: plan.mode,
    checkpoint: { id: plan.checkpointId, name: plan.checkpointName, completedAt: plan.completedAt },
    db: plan.db ? { collections: plan.db.collections, totalDocs: plan.db.totalDocs, checkpointBytes: plan.db.checkpointBytes } : null,
    assets: plan.assets
      ? {
          total: plan.assets.total,
          needed: plan.assets.items.filter((i) => i.needed).length,
          reuse: plan.assets.reuse,
          missing: plan.assets.missing,
          replace: plan.assets.replace,
          bytes: plan.assets.totalBytes,
        }
      : null,
    snapshot: plan.snapshot,
    requiresDbRollback: plan.requiresDbRollback,
    missingAssets: plan.missingAssets || [],
    warnings: plan.warnings,
    errors: plan.errors,
    canProceed: plan.canProceed,
  }
}

// ── Plan builder (used by dry-run and by execute, which re-validates) ────────

export async function buildPlan({ checkpoint, mode }) {
  const db = dbHandle()
  const drive = await getDrive()
  const store = getMediaStore()

  const plan = {
    checkpointId: checkpoint.id,
    checkpointName: checkpoint.name,
    completedAt: checkpoint.completedAt,
    mode,
    db: null,
    assets: null,
    refs: [],
    missingAssets: [],
    snapshot: { required: false, collections: [], assets: [], estimatedBytes: 0 },
    requiresDbRollback: false,
    canProceed: false,
    errors: [],
    warnings: [],
  }

  let serviceRecordDocs = null

  if (modeIncludes(mode, 'db')) {
    if (!checkpoint.restorable.db) {
      plan.errors.push('This checkpoint has no valid database component')
    } else {
      const collections = []
      let totalBytes = 0
      let totalDocs = 0
      for (const c of checkpoint.manifest.db.collections) {
        try {
          const fileBuffer = await drive.downloadAtPath(checkpoint.id, c.file)
          if (fileBuffer.length !== c.bytes) {
            plan.errors.push(`${c.name}: file size does not match the manifest`)
            continue
          }
          if (sha256(fileBuffer) !== c.sha256) {
            plan.errors.push(`${c.name}: checksum mismatch`)
            continue
          }
          let docs
          try {
            docs = parseNdjson(gunzipBuffer(fileBuffer))
          } catch (err) {
            plan.errors.push(`${c.name}: ${err.message}`)
            continue
          }
          if (docs.length !== c.docs) {
            plan.errors.push(`${c.name}: document count mismatch (${docs.length} vs ${c.docs})`)
            continue
          }
          if (c.name === 'servicerecords') serviceRecordDocs = docs
          collections.push({
            name: c.name,
            checkpointDocs: c.docs,
            currentDocs: await db.collection(c.name).countDocuments({}),
            bytes: c.bytes,
          })
          totalBytes += c.bytes
          totalDocs += c.docs
        } catch (err) {
          plan.errors.push(`${c.name}: ${err.message}`)
        }
      }
      if (collections.length !== checkpoint.manifest.db.collections.length) {
        plan.errors.push('One or more database files failed validation')
      }
      plan.db = { collections, totalDocs, checkpointBytes: totalBytes }
      plan.requiresDbRollback = true
      plan.snapshot.required = true
      plan.snapshot.collections = collections.map((c) => c.name)
      for (const name of APP_COLLECTIONS) {
        try {
          const stats = await db.command({ collStats: name })
          plan.snapshot.estimatedBytes += Number(stats.size || 0)
        } catch {
          // collection may not exist yet
        }
      }
    }
  }

  // Collect blob references from the checkpoint's records (needed for mode A
  // warnings and for filtering mode C assets).
  const manifestAssets = checkpoint.manifest?.media?.files || []
  const assetByPathname = new Map(manifestAssets.map((a) => [a.pathname, a]))
  if (serviceRecordDocs) {
    const refs = []
    for (const record of serviceRecordDocs) refs.push(...collectRecordBlobRefs(record))
    plan.refs = refs.map((r) => ({ pathname: r.pathname, tokenNo: r.tokenNo, section: r.section, kind: r.kind }))
    const missingInManifest = new Set()
    for (const ref of plan.refs) {
      if (!assetByPathname.has(ref.pathname)) missingInManifest.add(ref.pathname)
    }
    if (missingInManifest.size) {
      plan.warnings.push(
        `${missingInManifest.size} asset reference(s) in the database are not part of this backup's media manifest (legacy or orphaned references).`,
      )
    }
  }

  const neededPathnames = new Set(plan.refs.map((r) => r.pathname))

  if (modeIncludes(mode, 'assets')) {
    if (!checkpoint.restorable.assets) {
      plan.errors.push('This checkpoint has no valid media component')
    } else {
      const maxBytes = MAX_ASSET_MB() * 1024 * 1024
      const items = []
      for (const asset of manifestAssets) {
        const item = {
          pathname: asset.pathname,
          file: asset.file,
          bytes: asset.bytes,
          sha256: asset.sha256,
          contentType: asset.contentType || guessContentType(asset.pathname),
          needed: mode === 'assets' ? true : neededPathnames.has(asset.pathname),
          status: 'pending',
        }
        if (asset.bytes > maxBytes) {
          item.status = 'too_large'
          plan.errors.push(`${asset.pathname} exceeds the per-asset size limit`)
          items.push(item)
          continue
        }
        try {
          const backupBuffer = await drive.downloadAtPath(checkpoint.id, asset.file)
          if (backupBuffer.length !== asset.bytes || sha256(backupBuffer) !== asset.sha256) {
            item.status = 'corrupt_backup'
            plan.errors.push(`${asset.pathname}: backup copy failed checksum verification`)
            items.push(item)
            continue
          }
          const existing = await store.read(asset.pathname)
          if (!existing) item.status = 'missing'
          else if (sha256(existing.buffer) === asset.sha256) item.status = 'reuse'
          else item.status = 'replace'
        } catch (err) {
          item.status = 'error'
          plan.errors.push(`${asset.pathname}: ${err.message}`)
        }
        items.push(item)
      }
      const neededItems = items.filter((i) => i.needed)
      plan.assets = {
        total: items.length,
        totalBytes: neededItems.reduce((acc, i) => acc + i.bytes, 0),
        reuse: neededItems.filter((i) => i.status === 'reuse').length,
        missing: neededItems.filter((i) => i.status === 'missing').length,
        replace: neededItems.filter((i) => i.status === 'replace').length,
        items,
      }
      const replaces = neededItems.filter((i) => i.status === 'replace')
      if (replaces.length) {
        plan.snapshot.required = true
        plan.snapshot.assets = replaces.map((i) => ({ pathname: i.pathname, bytes: i.bytes }))
        plan.snapshot.estimatedBytes += replaces.reduce((acc, i) => acc + i.bytes, 0)
        plan.warnings.push(`${replaces.length} existing asset(s) differ from the backup and will be preserved before being replaced.`)
      }
    }
  }

  // Mode A report: which referenced assets are missing from current storage.
  if (mode === 'db' && plan.refs.length) {
    const unique = new Map()
    for (const ref of plan.refs) unique.set(ref.pathname, (unique.get(ref.pathname) || 0) + 1)
    for (const [pathname, count] of unique) {
      const existing = await store.read(pathname).catch(() => null)
      if (!existing) plan.missingAssets.push({ pathname, refs: count })
      else if (assetByPathname.get(pathname) && sha256(existing.buffer) !== assetByPathname.get(pathname).sha256) {
        plan.missingAssets.push({ pathname, refs: count, reason: 'checksum mismatch' })
      }
    }
    if (plan.missingAssets.length) {
      plan.warnings.push(`${plan.missingAssets.length} referenced asset(s) are missing from current storage; they will be reported after the restore.`)
    }
  }

  plan.canProceed = plan.errors.length === 0
  return plan
}

export async function dryRun({ checkpointId, mode, actor, ip, userAgent }) {
  if (!MODES.includes(mode)) throw fail(400, 'Invalid restoration mode')
  const { checkpoint } = await loadCheckpoint(checkpointId)
  const plan = await buildPlan({ checkpoint, mode })
  await recoveryEvent(dbHandle(), {
    actor,
    action: 'dry_run',
    checkpointId,
    mode,
    result: plan.canProceed ? 'ok' : 'invalid',
    detail: plan.errors.length ? plan.errors.join('; ') : `Mode ${mode} validated`,
    ip,
    userAgent,
  })
  return { checkpoint: publicCheckpoint(checkpoint), plan: summarizePlan(plan) }
}

// ── Snapshot ────────────────────────────────────────────────────────────────

async function createSnapshot({ op, plan }) {
  const db = dbHandle()
  const drive = await getDrive()
  const store = getMediaStore()
  const rootId = await drive.ensureRootFolder()
  const preRestore = (await drive.findInFolderByName(rootId, SNAPSHOT_PREFIX)) || (await drive.createFolder(SNAPSHOT_PREFIX, rootId))
  const folderName = `restore-${String(op._id)}`
  const folder = (await drive.findInFolderByName(preRestore.id, folderName)) || (await drive.createFolder(folderName, preRestore.id))

  const manifest = {
    kind: SNAPSHOT_KIND,
    version: 1,
    operationId: String(op._id),
    createdAt: new Date().toISOString(),
    mode: op.mode,
    checkpointId: op.checkpoint.id,
    collections: [],
    assets: [],
  }

  if (modeIncludes(op.mode, 'db')) {
    for (const name of APP_COLLECTIONS) {
      const dump = await dumpCollectionBuffer(db, name)
      await drive.uploadAtPath(folder.id, `db/${name}.ndjson.gz`, dump.buffer)
      const readBack = await drive.downloadAtPath(folder.id, `db/${name}.ndjson.gz`)
      if (sha256(readBack) !== dump.sha256) throw new Error(`Snapshot verification failed for ${name}`)
      manifest.collections.push({ name, file: `db/${name}.ndjson.gz`, docs: dump.docs, bytes: dump.bytes, sha256: dump.sha256 })
    }
  }

  if (modeIncludes(op.mode, 'assets')) {
    for (const asset of plan.snapshot.assets) {
      const current = await store.read(asset.pathname)
      if (!current) throw new Error(`Expected asset disappeared before snapshot: ${asset.pathname}`)
      const digest = sha256(current.buffer)
      const file = `assets/${asset.pathname}`
      await drive.uploadAtPath(folder.id, file, current.buffer)
      const readBack = await drive.downloadAtPath(folder.id, file)
      if (sha256(readBack) !== digest) throw new Error(`Snapshot verification failed for ${asset.pathname}`)
      manifest.assets.push({ pathname: asset.pathname, file, bytes: current.buffer.length, sha256: digest })
    }
  }

  await drive.uploadBuffer(folder.id, 'manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)), 'application/json')
  const readBack = JSON.parse((await drive.downloadAtPath(folder.id, 'manifest.json')).toString('utf8'))
  if (readBack.kind !== SNAPSHOT_KIND || readBack.operationId !== String(op._id)) {
    throw new Error('Snapshot manifest verification failed')
  }

  return {
    folderId: folder.id,
    folderName: folder.name,
    verified: true,
    collections: manifest.collections.length,
    assets: manifest.assets.length,
    bytes:
      manifest.collections.reduce((acc, c) => acc + c.bytes, 0) +
      manifest.assets.reduce((acc, a) => acc + a.bytes, 0),
    createdAt: manifest.createdAt,
  }
}

// ── Database restore helpers ────────────────────────────────────────────────

async function replaceCollection(db, name, docs) {
  const tmp = `__restore_${Date.now()}_${Math.random().toString(36).slice(2)}_${name}`
  try {
    await db.collection(tmp).drop().catch(() => {})
    // Ensure the collection exists even when the checkpoint had zero documents,
    // otherwise rename() has no source namespace.
    await db.createCollection(tmp).catch((err) => {
      if (err?.code !== 48) throw err // 48 = NamespaceExists
    })
    for (let i = 0; i < docs.length; i += 500) {
      try {
        await db.collection(tmp).insertMany(docs.slice(i, i + 500), { ordered: false })
      } catch (err) {
        if (err?.code !== 11000) throw err
      }
    }
    await db.collection(tmp).rename(name, { dropTarget: true })
  } finally {
    await db.collection(tmp).drop().catch(() => {})
  }
}

async function restoreDatabaseFromCheckpoint({ drive, checkpoint, faults, onProgress }) {
  const db = dbHandle()
  const collections = checkpoint.manifest.db.collections
  let done = 0
  for (const c of collections) {
    const buffer = await drive.downloadAtPath(checkpoint.id, c.file)
    if (sha256(buffer) !== c.sha256) throw new Error(`Checksum mismatch while restoring ${c.name}`)
    const docs = parseNdjson(gunzipBuffer(buffer))
    await replaceCollection(db, c.name, docs)
    done += 1
    await onProgress?.(done, collections.length)
    if (faults.has('fail_after_first_db_collection') && done === 1) {
      throw new Error('Injected test fault after the first collection')
    }
  }
}

async function syncIndexes(warnings) {
  for (const Model of INDEX_MODELS) {
    try {
      await Model.syncIndexes()
    } catch (err) {
      warnings.push(`Index rebuild failed for ${Model.modelName}: ${err.message}`)
    }
  }
}

// ── Asset restore helpers ───────────────────────────────────────────────────

async function putVerified(store, item, buffer) {
  await store.write(item.pathname, buffer, item.contentType)
  const readBack = await store.read(item.pathname)
  if (!readBack || sha256(readBack.buffer) !== item.sha256) throw new Error('post-write verification failed')
}

async function restoreAssets({ drive, checkpoint, items, faults, onProgress }) {
  const store = getMediaStore()
  const results = { reused: [], restored: [], replaced: [], failed: [] }
  let done = 0
  for (const item of items) {
    done += 1
    try {
      const existing = await store.read(item.pathname)
      if (existing && sha256(existing.buffer) === item.sha256) {
        results.reused.push(item.pathname)
        continue
      }
      if (faults.has('fail_assets_all')) throw new Error('Injected test fault during asset restore')
      const backupBuffer = await drive.downloadAtPath(checkpoint.id, item.file)
      if (sha256(backupBuffer) !== item.sha256) throw new Error('backup copy checksum mismatch')
      try {
        await putVerified(store, item, backupBuffer)
      } catch (firstError) {
        const retryBuffer = await drive.downloadAtPath(checkpoint.id, item.file)
        if (sha256(retryBuffer) !== item.sha256) throw firstError
        await putVerified(store, item, retryBuffer)
      }
      ;(existing ? results.replaced : results.restored).push(item.pathname)
    } catch (err) {
      results.failed.push({ pathname: item.pathname, error: err.message })
    }
    await onProgress?.(done, items.length)
  }
  return results
}

// Compensating action: put back bytes of assets that were replaced.
async function compensateReplacedAssets({ op, warnings }) {
  const db = dbHandle()
  const drive = await getDrive()
  const store = getMediaStore()
  if (!op.snapshot?.folderId) return { attempted: false }
  const manifest = JSON.parse((await drive.downloadAtPath(op.snapshot.folderId, 'manifest.json')).toString('utf8'))
  let restored = 0
  for (const asset of manifest.assets || []) {
    try {
      const buffer = await drive.downloadAtPath(op.snapshot.folderId, asset.file)
      if (sha256(buffer) !== asset.sha256) throw new Error('snapshot checksum mismatch')
      await store.write(asset.pathname, buffer, guessContentType(asset.pathname))
      const back = await store.read(asset.pathname)
      if (!back || sha256(back.buffer) !== asset.sha256) throw new Error('verification failed')
      restored += 1
    } catch (err) {
      warnings.push(`Could not restore preserved asset ${asset.pathname}: ${err.message}`)
    }
  }
  return { attempted: true, restored }
}

// ── Reference repair (Mode C; expected to be a no-op for current records) ────

async function repairReferences({ warnings }) {
  const db = dbHandle()
  const collection = db.collection('servicerecords')
  const cursor = collection.find({})
  const updates = []
  for await (const record of cursor) {
    for (const ref of collectRecordBlobRefs(record)) {
      const canonical = canonicalMediaUrl(ref.pathname)
      if (ref.url !== canonical) {
        const path = ref.section.replace(/\[(\d+)\]/g, '.$1') + '.url'
        updates.push({ recordId: record._id, path, value: canonical, pathname: ref.pathname })
      }
    }
  }
  let updated = 0
  for (const update of updates) {
    try {
      await collection.updateOne({ _id: update.recordId }, { $set: { [update.path]: update.value } })
      updated += 1
    } catch (err) {
      warnings.push(`Reference repair failed for ${update.pathname}: ${err.message}`)
    }
  }
  return { updated }
}

// ── Verification ────────────────────────────────────────────────────────────

async function verifyOperation({ op, checkpoint, plan, assetResults, warnings }) {
  const db = dbHandle()
  const store = getMediaStore()
  const verification = {
    db: { passed: true, collections: [] },
    assets: { passed: true, required: 0, available: 0, failed: [] },
    refs: { passed: true, total: 0, missing: [], legacy: 0 },
    indexes: { checked: 0, failed: [] },
    passed: true,
  }

  if (modeIncludes(op.mode, 'db')) {
    for (const c of checkpoint.manifest.db.collections) {
      const actual = await db.collection(c.name).countDocuments({})
      // auditlogs is append-only: the checkpoint history is restored, then this
      // operation's own audit entries are appended by design.
      const appendOnly = c.name === 'auditlogs'
      const ok = appendOnly ? actual >= c.docs : actual === c.docs
      verification.db.collections.push({ name: c.name, expected: c.docs, actual, ok, appendOnly })
      if (!ok) verification.db.passed = false
      if (appendOnly && actual > c.docs) {
        warnings.push('Audit history was restored from the checkpoint and appended with this operation\'s own audit entries.')
      }
    }
    for (const Model of INDEX_MODELS) {
      verification.indexes.checked += 1
      try {
        await Model.listIndexes()
      } catch {
        verification.indexes.failed.push(Model.modelName)
      }
    }
  }

  if (assetResults) {
    const required = plan.assets.items.filter((i) => i.needed)
    verification.assets.required = required.length
    for (const item of required) {
      const stored = await store.read(item.pathname).catch(() => null)
      if (!stored || sha256(stored.buffer) !== item.sha256) {
        verification.assets.failed.push({ pathname: item.pathname, error: 'missing or checksum mismatch after restore' })
      }
    }
    verification.assets.available = required.length - verification.assets.failed.length
    verification.assets.passed = verification.assets.failed.length === 0
  }

  if (plan.refs.length) {
    const unique = new Map()
    for (const ref of plan.refs) unique.set(ref.pathname, (unique.get(ref.pathname) || 0) + 1)
    for (const [pathname, count] of unique) {
      const stored = await store.read(pathname).catch(() => null)
      if (!stored) verification.refs.missing.push({ pathname, refs: count })
    }
    verification.refs.total = plan.refs.length
    verification.refs.passed = verification.refs.missing.length === 0
    if (!verification.refs.passed && op.mode === 'db') {
      warnings.push(`${verification.refs.missing.length} referenced asset(s) are missing from current storage (Mode A does not restore assets).`)
    }
  }

  verification.passed =
    verification.db.passed &&
    verification.assets.passed &&
    (op.mode === 'both' ? verification.refs.passed : true)
  return verification
}

// ── Rollback ────────────────────────────────────────────────────────────────

async function rollbackFromSnapshot({ op, faults }) {
  const db = dbHandle()
  const drive = await getDrive()
  const store = getMediaStore()
  if (!op.snapshot?.folderId) throw new Error('No verified snapshot is available for this operation')

  const manifestBuffer = await drive.downloadAtPath(op.snapshot.folderId, 'manifest.json')
  const snapshot = JSON.parse(manifestBuffer.toString('utf8'))
  if (snapshot.kind !== SNAPSHOT_KIND) throw new Error('Snapshot manifest is not valid')

  if (faults.has('fail_rollback')) throw new Error('Injected test fault during rollback')

  for (const c of snapshot.collections || []) {
    const buffer = await drive.downloadAtPath(op.snapshot.folderId, c.file)
    if (sha256(buffer) !== c.sha256) throw new Error(`Snapshot checksum mismatch for ${c.name}`)
  }
  for (const c of snapshot.collections || []) {
    const buffer = await drive.downloadAtPath(op.snapshot.folderId, c.file)
    await replaceCollection(db, c.name, parseNdjson(gunzipBuffer(buffer)))
  }
  for (const c of snapshot.collections || []) {
    const count = await db.collection(c.name).countDocuments({})
    if (count !== c.docs) throw new Error(`Rollback verification failed for ${c.name}`)
  }

  for (const asset of snapshot.assets || []) {
    const buffer = await drive.downloadAtPath(op.snapshot.folderId, asset.file)
    if (sha256(buffer) !== asset.sha256) throw new Error(`Snapshot checksum mismatch for ${asset.pathname}`)
    await store.write(asset.pathname, buffer, guessContentType(asset.pathname))
    const back = await store.read(asset.pathname)
    if (!back || sha256(back.buffer) !== asset.sha256) throw new Error(`Rollback verification failed for ${asset.pathname}`)
  }

  return { collections: (snapshot.collections || []).length, assets: (snapshot.assets || []).length }
}

// ── Start + execute ─────────────────────────────────────────────────────────

export async function startRestore({ checkpointId, mode, confirmation, acknowledge, actor, ip, userAgent }) {
  if (!MODES.includes(mode)) throw fail(400, 'Invalid restoration mode')
  if (confirmation !== CONFIRMATION_PHRASE) throw fail(400, `Type "${CONFIRMATION_PHRASE}" exactly to confirm`)
  if (acknowledge !== true) throw fail(400, 'You must acknowledge that newer data may be lost')

  const db = dbHandle()
  await ensureRecoveryIndexes(db)
  await flagStaleOperations(db)

  const { checkpoint } = await loadCheckpoint(checkpointId)
  const allowed =
    mode === 'db' ? checkpoint.restorable.db : mode === 'assets' ? checkpoint.restorable.assets : checkpoint.restorable.both
  if (!allowed) throw fail(400, 'This checkpoint is not valid for the selected restoration mode')

  const holder = newHolder('restore')
  if (!(await acquireRestoreLock(db, holder))) throw fail(409, 'Another restore is already running')
  try {
    await assertNoActiveOperation(db)
    const opId = await createOperation(db, {
      checkpoint: {
        id: checkpoint.id,
        name: checkpoint.name,
        completedAt: checkpoint.completedAt,
        cutoffAt: checkpoint.cutoffAt,
      },
      mode,
      actor: { id: String(actor._id), name: actor.name, email: actor.email },
      requesterIp: ip || null,
      userAgent: userAgent || null,
      holder,
    })
    await recoveryEvent(db, {
      actor,
      action: 'restore_requested',
      checkpointId,
      operationId: opId,
      mode,
      detail: `Confirmed restore (${CONFIRMATION_PHRASE})`,
      ip,
      userAgent,
    })
    setImmediate(() => {
      executeOperation(opId).catch((err) => {
        console.error('[recovery] operation crashed:', err)
      })
    })
    return { operationId: String(opId), status: 'pending' }
  } catch (err) {
    await releaseRestoreLock(db, holder)
    throw err
  }
}

export async function executeOperation(opId) {
  const db = dbHandle()
  const faults = testFaults()
  const stopHeartbeat = startHeartbeat(db, opId)
  let op = await getOperation(db, opId)
  if (!op) {
    stopHeartbeat()
    return
  }
  let afterPointOfNoReturn = false
  let assetResults = null
  const warnings = []

  try {
    await updateOperation(db, opId, { $set: { status: 'validating', progress: 5, phase: 'Validating checkpoint' } })
    await addStep(db, opId, 'validating', 'Re-validating the checkpoint and backup files')
    const { checkpoint } = await loadCheckpoint(op.checkpoint.id)
    const plan = await buildPlan({ checkpoint, mode: op.mode })
    await updateOperation(db, opId, { $set: { plan: summarizePlan(plan) } })
    if (!plan.canProceed) {
      throw Object.assign(new Error('Checkpoint validation failed'), { beforeChanges: true, details: plan.errors })
    }
    await setProgress(db, opId, 15, 'Validated')

    await updateOperation(db, opId, { $set: { status: 'snapshotting', phase: 'Creating safety snapshot' } })
    await addStep(db, opId, 'snapshotting', 'Creating and verifying a pre-restore snapshot')
    const snapshot = await createSnapshot({ op, plan })
    await updateOperation(db, opId, { $set: { snapshot } })
    await addStep(db, opId, 'snapshotting', `Snapshot verified (${snapshot.collections} collection(s), ${snapshot.assets} asset(s), ${snapshot.bytes} bytes)`)
    await setProgress(db, opId, 30, 'Snapshot verified')
    await recoveryEvent(db, {
      actor: op.actor ? { _id: op.actor.id, name: op.actor.name, email: op.actor.email, role: 'admin' } : null,
      action: 'snapshot_created',
      checkpointId: op.checkpoint.id,
      operationId: opId,
      mode: op.mode,
      detail: `Snapshot ${snapshot.folderName} verified (${snapshot.bytes} bytes)`,
      ip: op.requesterIp,
    })

    await updateOperation(db, opId, { $set: { status: 'ready', phase: 'Ready' } })

    if (modeIncludes(op.mode, 'db')) {
      await updateOperation(db, opId, { $set: { status: 'restoring_database', phase: 'Restoring database' } })
      await addStep(db, opId, 'restoring_database', 'Replacing database collections from the checkpoint')
      afterPointOfNoReturn = true
      await restoreDatabaseFromCheckpoint({
        drive: await getDrive(),
        checkpoint,
        faults,
        onProgress: (done, total) => setProgress(db, opId, 35 + (done / total) * 30, 'Restoring database'),
      })
      await syncIndexes(warnings)
      await addStep(db, opId, 'restoring_database', 'Database collections restored and indexes rebuilt')
      await recoveryEvent(db, {
        actor: op.actor ? { _id: op.actor.id, name: op.actor.name, email: op.actor.email, role: 'admin' } : null,
        action: 'database_restored',
        checkpointId: op.checkpoint.id,
        operationId: opId,
        mode: op.mode,
        detail: `${checkpoint.manifest.db.collections.length} collections restored`,
        ip: op.requesterIp,
      })
    }

    if (modeIncludes(op.mode, 'assets')) {
      await updateOperation(db, opId, { $set: { status: 'restoring_assets', phase: 'Reconciling media' } })
      await addStep(db, opId, 'restoring_assets', 'Reusing verified assets and restoring missing ones')
      const items = plan.assets.items.filter((i) => i.needed)
      assetResults = await restoreAssets({
        drive: await getDrive(),
        checkpoint,
        items,
        faults,
        onProgress: (done, total) => setProgress(db, opId, 70 + (done / total) * 20, 'Reconciling media'),
      })
      if (op.mode === 'both') {
        const repair = await repairReferences({ warnings })
        await addStep(db, opId, 'restoring_assets', `Reference repair complete (${repair.updated} update(s))`)
        if (repair.updated) {
          await recoveryEvent(db, {
            actor: op.actor ? { _id: op.actor.id, name: op.actor.name, email: op.actor.email, role: 'admin' } : null,
            action: 'references_repaired',
            checkpointId: op.checkpoint.id,
            operationId: opId,
            mode: op.mode,
            detail: `${repair.updated} media reference(s) updated`,
            ip: op.requesterIp,
          })
        }
      }
      await addStep(
        db,
        opId,
        'restoring_assets',
        `Assets: ${assetResults.reused.length} reused, ${assetResults.restored.length} restored, ${assetResults.replaced.length} replaced, ${assetResults.failed.length} failed`,
        assetResults.failed.length ? 'error' : 'info',
      )
      await recoveryEvent(db, {
        actor: op.actor ? { _id: op.actor.id, name: op.actor.name, email: op.actor.email, role: 'admin' } : null,
        action: 'assets_restored',
        checkpointId: op.checkpoint.id,
        operationId: opId,
        mode: op.mode,
        result: assetResults.failed.length ? 'partial' : 'ok',
        detail: `${assetResults.restored.length} restored, ${assetResults.replaced.length} replaced, ${assetResults.reused.length} reused, ${assetResults.failed.length} failed`,
        ip: op.requesterIp,
      })
    }

    await updateOperation(db, opId, { $set: { status: 'verifying', phase: 'Verifying' } })
    await addStep(db, opId, 'verifying', 'Verifying the restored database and assets')
    await setProgress(db, opId, 95, 'Verifying')
    const verification = await verifyOperation({ op, checkpoint, plan, assetResults, warnings })

    if (!verification.db.passed) {
      throw new Error('Database verification failed after restore')
    }

    const assetFailures = assetResults?.failed?.length || 0
    const status = assetFailures > 0 ? 'partial_failure' : 'completed'
    await updateOperation(db, opId, {
      $set: {
        status,
        progress: 100,
        phase: status === 'completed' ? 'Completed' : 'Completed with asset failures',
        completedAt: new Date(),
        verification,
        warnings,
        result: {
          dbCollections: checkpoint.manifest.db.collections.length,
          dbDocs: checkpoint.manifest.db.collections.reduce((acc, c) => acc + c.docs, 0),
          assets: assetResults
            ? {
                reused: assetResults.reused.length,
                restored: assetResults.restored.length,
                replaced: assetResults.replaced.length,
                failed: assetResults.failed,
              }
            : null,
          refs: verification.refs,
          requiredAssets: verification.assets.required,
          availableAssets: verification.assets.available,
        },
      },
    })
    await addStep(db, opId, 'verifying', status === 'completed' ? 'Verification passed' : 'Verification finished with asset failures', status === 'completed' ? 'info' : 'error')
    await recoveryEvent(db, {
      actor: op.actor ? { _id: op.actor.id, name: op.actor.name, email: op.actor.email, role: 'admin' } : null,
      action: status === 'completed' ? 'restore_completed' : 'restore_partial_failure',
      checkpointId: op.checkpoint.id,
      operationId: opId,
      mode: op.mode,
      result: status,
      detail: `DB verified: ${verification.db.passed}; assets ${verification.assets.available}/${verification.assets.required}`,
      ip: op.requesterIp,
    })
  } catch (err) {
    const message = err?.details ? `${err.message}: ${err.details.join('; ')}` : err.message
    if (afterPointOfNoReturn) {
      await updateOperation(db, opId, {
        $set: { status: 'rolling_back', phase: 'Rolling back', lastError: message },
        $push: { errors: { at: new Date(), message: String(message).slice(0, 1500) } },
      })
      await addStep(db, opId, 'rolling_back', `Failure after production changes: ${message}. Rolling back from the verified snapshot.`, 'error')
      await recoveryEvent(db, {
        actor: op.actor ? { _id: op.actor.id, name: op.actor.name, email: op.actor.email, role: 'admin' } : null,
        action: 'rollback_started',
        checkpointId: op.checkpoint.id,
        operationId: opId,
        mode: op.mode,
        detail: message,
        ip: op.requesterIp,
      })
      try {
        const current = await getOperation(db, opId)
        const rollback = await rollbackFromSnapshot({ op: current, faults })
        await updateOperation(db, opId, {
          $set: {
            status: 'rolled_back',
            phase: 'Rolled back',
            completedAt: new Date(),
            rollback: { attempted: true, status: 'rolled_back', ...rollback, at: new Date().toISOString() },
            warnings,
          },
        })
        await addStep(db, opId, 'rolled_back', 'Rollback completed and verified', 'info')
        await recoveryEvent(db, {
          actor: op.actor ? { _id: op.actor.id, name: op.actor.name, email: op.actor.email, role: 'admin' } : null,
          action: 'rollback_completed',
          checkpointId: op.checkpoint.id,
          operationId: opId,
          mode: op.mode,
          detail: `Rolled back ${rollback.collections} collection(s) and ${rollback.assets} asset(s)`,
          ip: op.requesterIp,
        })
      } catch (rollbackErr) {
        await updateOperation(db, opId, {
          $set: {
            status: 'manual_intervention_required',
            phase: 'Manual intervention required',
            completedAt: new Date(),
            rollback: { attempted: true, status: 'failed', error: rollbackErr.message, at: new Date().toISOString() },
            warnings,
          },
          $push: { errors: { at: new Date(), message: `Rollback failed: ${rollbackErr.message}` } },
        })
        await addStep(db, opId, 'manual_intervention_required', `Rollback failed: ${rollbackErr.message}`, 'error')
        await recoveryEvent(db, {
          actor: op.actor ? { _id: op.actor.id, name: op.actor.name, email: op.actor.email, role: 'admin' } : null,
          action: 'rollback_failed',
          checkpointId: op.checkpoint.id,
          operationId: opId,
          mode: op.mode,
          result: 'error',
          detail: rollbackErr.message,
          ip: op.requesterIp,
        })
      }
    } else {
      if (assetResults?.replaced?.length) {
        try {
          const compensation = await compensateReplacedAssets({ op: await getOperation(db, opId), warnings })
          await addStep(db, opId, 'failed', `Compensated replaced assets: ${compensation.restored} restored`, 'info')
        } catch (compErr) {
          warnings.push(`Asset compensation failed: ${compErr.message}`)
        }
      }
      await updateOperation(db, opId, {
        $set: { status: 'failed', phase: 'Failed', completedAt: new Date(), lastError: message, warnings },
        $push: { errors: { at: new Date(), message: String(message).slice(0, 1500) } },
      })
      await addStep(db, opId, 'failed', `Restore failed before production changes: ${message}`, 'error')
      await recoveryEvent(db, {
        actor: op.actor ? { _id: op.actor.id, name: op.actor.name, email: op.actor.email, role: 'admin' } : null,
        action: 'restore_failed',
        checkpointId: op.checkpoint.id,
        operationId: opId,
        mode: op.mode,
        result: 'error',
        detail: message,
        ip: op.requesterIp,
      })
    }
  } finally {
    stopHeartbeat()
    await releaseRestoreLock(db, op.holder)
  }
}

export async function manualRollback({ operationId, actor, ip, userAgent }) {
  const db = dbHandle()
  await flagStaleOperations(db)
  let id
  try {
    id = new mongoose.Types.ObjectId(operationId)
  } catch {
    throw fail(400, 'Invalid operation id')
  }
  const op = await getOperation(db, id)
  if (!op) throw fail(404, 'Operation not found')
  if (op.status === 'rolled_back') throw fail(400, 'This operation is already rolled back')
  if (op.status === 'rolling_back') throw fail(409, 'Rollback is already running')
  if (!['failed', 'manual_intervention_required', 'partial_failure'].includes(op.status)) {
    throw fail(400, `Rollback is not available for an operation in status "${op.status}"`)
  }
  if (!op.snapshot?.folderId) throw fail(400, 'No verified snapshot is available for this operation')

  const holder = newHolder('rollback')
  if (!(await acquireRestoreLock(db, holder))) throw fail(409, 'Another restore is already running')
  try {
    await updateOperation(db, id, {
      $set: { status: 'rolling_back', phase: 'Rolling back (manual)', lastError: null },
      $push: { steps: { at: new Date(), phase: 'rolling_back', message: 'Manual rollback requested', level: 'info' } },
    })
    await recoveryEvent(db, { actor, action: 'rollback_manual_requested', operationId: id, mode: op.mode, checkpointId: op.checkpoint?.id, ip, userAgent })
    setImmediate(async () => {
      try {
        const rollback = await rollbackFromSnapshot({ op: { ...op, holder }, faults: testFaults() })
        await updateOperation(db, id, {
          $set: {
            status: 'rolled_back',
            phase: 'Rolled back',
            completedAt: new Date(),
            rollback: { attempted: true, status: 'rolled_back', ...rollback, at: new Date().toISOString() },
          },
        })
        await addStep(db, id, 'rolled_back', 'Manual rollback completed and verified')
        await recoveryEvent(db, { actor, action: 'rollback_completed', operationId: id, mode: op.mode, checkpointId: op.checkpoint?.id, detail: `Rolled back ${rollback.collections} collection(s)`, ip })
      } catch (err) {
        await updateOperation(db, id, {
          $set: {
            status: 'manual_intervention_required',
            phase: 'Manual intervention required',
            completedAt: new Date(),
            rollback: { attempted: true, status: 'failed', error: err.message, at: new Date().toISOString() },
          },
          $push: { errors: { at: new Date(), message: `Rollback failed: ${err.message}` } },
        })
        await addStep(db, id, 'manual_intervention_required', `Rollback failed: ${err.message}`, 'error')
        await recoveryEvent(db, { actor, action: 'rollback_failed', operationId: id, mode: op.mode, result: 'error', detail: err.message, ip })
      } finally {
        await releaseRestoreLock(db, holder)
      }
    })
    return { operationId: String(id), status: 'rolling_back' }
  } catch (err) {
    await releaseRestoreLock(db, holder)
    throw err
  }
}

export async function listRecentOperations() {
  const db = dbHandle()
  await flagStaleOperations(db)
  const items = await listOperations(db, 20)
  return items.map(publicOperation)
}

export async function getOperationPublic(operationId) {
  const db = dbHandle()
  await flagStaleOperations(db)
  let id
  try {
    id = new mongoose.Types.ObjectId(operationId)
  } catch {
    throw fail(400, 'Invalid operation id')
  }
  const op = await getOperation(db, id)
  if (!op) throw fail(404, 'Operation not found')
  return publicOperation(op)
}
