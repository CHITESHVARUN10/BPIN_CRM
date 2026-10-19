import crypto from 'node:crypto'
import { ACTIVE_STATUSES, TERMINAL_STATUSES } from './format.js'

const LOCK_TTL_MS = 5 * 60 * 1000
const HEARTBEAT_STALE_MS = 2 * 60 * 1000

const ops = (db) => db.collection('recovery_operations')
const locks = (db) => db.collection('recovery_lock')

export async function ensureRecoveryIndexes(db) {
  await ops(db).createIndex({ createdAt: -1 })
  await ops(db).createIndex({ status: 1 })
  await db.collection('recovery_events').createIndex({ at: -1 })
  await db.collection('recovery_events').createIndex({ action: 1 })
}

export async function createOperation(db, doc) {
  const now = new Date()
  const { insertedId } = await ops(db).insertOne({
    status: 'pending',
    progress: 0,
    phase: 'Queued',
    steps: [],
    warnings: [],
    errors: [],
    createdAt: now,
    updatedAt: now,
    heartbeatAt: now,
    ...doc,
  })
  return insertedId
}

export async function getOperation(db, id) {
  return ops(db).findOne({ _id: id })
}

export async function updateOperation(db, id, patch) {
  const { $set = {}, $push = {}, $inc = {} } = patch || {}
  const update = {}
  if (Object.keys($set).length) update.$set = { ...$set, updatedAt: new Date() }
  if (Object.keys($push).length) update.$push = $push
  if (Object.keys($inc).length) update.$inc = $inc
  if (Object.keys(update).length) await ops(db).updateOne({ _id: id }, update)
}

export function addStep(db, id, phase, message, level = 'info') {
  return updateOperation(db, id, {
    $set: { phase },
    $push: { steps: { at: new Date(), phase, message: String(message).slice(0, 1000), level } },
  })
}

export function setProgress(db, id, progress, phase) {
  const patch = { $set: { progress: Math.max(0, Math.min(100, Math.round(progress))) } }
  if (phase) patch.$set.phase = phase
  return updateOperation(db, id, patch)
}

export function startHeartbeat(db, id) {
  const timer = setInterval(async () => {
    try {
      const now = new Date()
      await ops(db).updateOne({ _id: id }, { $set: { heartbeatAt: now, updatedAt: now } })
      await locks(db).updateOne({ _id: 'restore' }, { $set: { expiresAt: new Date(Date.now() + LOCK_TTL_MS) } })
    } catch {
      // heartbeat failures are non-fatal; stale detection will catch a dead run
    }
  }, 15000)
  timer.unref?.()
  return () => clearInterval(timer)
}

export async function acquireRestoreLock(db, holder) {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + LOCK_TTL_MS)
  try {
    const res = await locks(db).findOneAndUpdate(
      { _id: 'restore', $or: [{ expiresAt: { $lt: now } }, { holder }] },
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

export async function releaseRestoreLock(db, holder) {
  try {
    await locks(db).deleteOne({ _id: 'restore', holder })
  } catch {
    // TTL expires it otherwise
  }
}

export async function getActiveOperation(db) {
  return ops(db).findOne({ status: { $in: ACTIVE_STATUSES } })
}

export async function listOperations(db, limit = 20) {
  return ops(db).find({}).sort({ createdAt: -1 }).limit(limit).toArray()
}

// Operations whose process died leave stale heartbeats. Never auto-resume a
// destructive flow: flag them for an operator and let manual rollback run.
export async function flagStaleOperations(db) {
  const threshold = new Date(Date.now() - HEARTBEAT_STALE_MS)
  const stale = await ops(db)
    .find({ status: { $in: ACTIVE_STATUSES }, heartbeatAt: { $lt: threshold } })
    .toArray()
  for (const op of stale) {
    await ops(db).updateOne(
      { _id: op._id, status: op.status },
      {
        $set: {
          status: 'manual_intervention_required',
          lastError: 'The process running this operation stopped unexpectedly. Review the operation log and roll back from the verified snapshot.',
          updatedAt: new Date(),
          interruptedAt: new Date(),
        },
        $push: {
          steps: {
            at: new Date(),
            phase: 'interrupted',
            message: 'Heartbeat stopped while the operation was active — marked for manual intervention.',
            level: 'error',
          },
        },
      },
    )
  }
  return stale.length
}

export async function assertNoActiveOperation(db) {
  const active = await getActiveOperation(db)
  if (active) {
    const err = new Error('Another recovery operation is already running')
    err.status = 409
    err.operationId = String(active._id)
    throw err
  }
}

export function newHolder(label = 'restore') {
  return `${label}:${process.pid}:${crypto.randomBytes(6).toString('hex')}`
}
