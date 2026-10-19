import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import mongoose from 'mongoose'
import { listCheckpoints } from '../recovery/checkpoints.js'
import { driveConfigured, driveNotConfiguredMessage } from '../recovery/drive.js'
import { mediaStoreConfigured } from '../recovery/mediaStore.js'
import { publicCheckpoint, dryRun, startRestore, listRecentOperations, getOperationPublic, manualRollback } from '../recovery/saga.js'
import { recoveryEvent } from '../recovery/events.js'

const router = Router()
const db = () => mongoose.connection.db
const ttlMs = () => Math.max(1, Number(process.env.RECOVERY_SESSION_TTL_MINUTES || 15)) * 60 * 1000
const meta = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') })

function auditDenied(req, detail) {
  const database = db()
  if (!database) return
  recoveryEvent(database, {
    actor: req.user || null,
    action: 'access_denied',
    result: 'denied',
    detail: `${req.method} ${req.originalUrl}: ${detail}`,
    ...meta(req),
  }).catch(() => {})
}

// Every recovery endpoint starts with session auth + super admin, regardless
// of what the UI shows. The browser-side guard is only a usability nicety.
router.use((req, res, next) => {
  if (!req.isAuthenticated?.() || !req.user || req.user.active === false) {
    auditDenied(req, 'not signed in')
    return res.status(401).json({ message: 'Not signed in' })
  }
  if (req.user.role !== 'admin' || req.user.superAdmin !== true) {
    auditDenied(req, 'not a super admin')
    return res.status(403).json({ message: 'Only the super admin can access recovery' })
  }
  next()
})

function sessionState(req) {
  const state = req.session?.recovery
  if (!state?.at) return { authenticated: false, expiresInSec: 0 }
  const idle = Date.now() - Number(state.lastAt || state.at)
  if (idle > ttlMs()) return { authenticated: false, expiresInSec: 0 }
  return { authenticated: true, expiresInSec: Math.max(0, Math.ceil((ttlMs() - idle) / 1000)) }
}

function touchRecovery(req) {
  const now = Date.now()
  req.session.recovery = { at: req.session.recovery?.at || now, lastAt: now }
}

function requireRecovery(req, res, next) {
  if (!sessionState(req).authenticated) {
    auditDenied(req, 'recovery re-authentication required')
    return res.status(403).json({ message: 'Re-authentication required', code: 'recovery_auth_required' })
  }
  touchRecovery(req)
  next()
}

function ensureConfigured(res) {
  if (!db()) {
    res.status(503).json({ message: 'Database is not connected' })
    return false
  }
  if (!driveConfigured()) {
    res.status(503).json({ message: driveNotConfiguredMessage() })
    return false
  }
  if (!mediaStoreConfigured()) {
    res.status(503).json({ message: 'Media storage is not configured (set BLOB_READ_WRITE_TOKEN)' })
    return false
  }
  return true
}

const reauthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Math.max(1, Number(process.env.RECOVERY_REAUTH_LIMIT || 5)),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${req.user?._id || 'anon'}:${req.ip}`,
  handler: (req, res) => {
    const database = db()
    if (database) {
      recoveryEvent(database, {
        actor: req.user || null,
        action: 'reauth_rate_limited',
        result: 'denied',
        detail: 'Too many failed password attempts',
        ...meta(req),
      }).catch(() => {})
    }
    res.status(429).json({ message: 'Too many failed attempts. Try again later.' })
  },
})

router.get('/session', (req, res) => {
  res.json(sessionState(req))
})

router.post('/session/lock', async (req, res) => {
  delete req.session.recovery
  await recoveryEvent(db(), {
    actor: req.user,
    action: 'recovery_locked',
    detail: 'Elevated recovery access cleared manually',
    ...meta(req),
  })
  res.json({ authenticated: false, expiresInSec: 0 })
})

router.post('/reauth', reauthLimiter, async (req, res, next) => {
  try {
    const password = String(req.body?.password || '')
    if (!password) return res.status(400).json({ message: 'Password is required' })
    const ok = await new Promise((resolve, reject) => {
      req.user.authenticate(password, (err, result) => (err ? reject(err) : resolve(Boolean(result))))
    })
    if (!ok) {
      await recoveryEvent(db(), {
        actor: req.user,
        action: 'reauth_failed',
        result: 'denied',
        detail: 'Incorrect password',
        ...meta(req),
      })
      return res.status(400).json({ message: 'Incorrect password' })
    }
    const now = Date.now()
    req.session.recovery = { at: now, lastAt: now }
    req.session.save(async (err) => {
      if (err) return next(err)
      await recoveryEvent(db(), {
        actor: req.user,
        action: 'reauth_success',
        detail: `Recovery elevated for ${Math.round(ttlMs() / 60000)} minutes of inactivity`,
        ...meta(req),
      })
      res.json({ authenticated: true, expiresInSec: Math.floor(ttlMs() / 1000) })
    })
  } catch (err) {
    next(err)
  }
})

// ── Everything below requires the elevated recovery session ─────────────────
router.use(requireRecovery)

router.get('/checkpoints', async (req, res, next) => {
  try {
    if (!ensureConfigured(res)) return
    const out = await listCheckpoints()
    await recoveryEvent(db(), {
      actor: req.user,
      action: 'inventory_listed',
      detail: `${out.items.length} checkpoint(s) discovered`,
      ...meta(req),
    })
    res.json({ rootFolder: out.rootFolder, items: out.items.map(publicCheckpoint) })
  } catch (err) {
    next(err)
  }
})

router.get('/backup-activity', async (req, res, next) => {
  try {
    const database = db()
    const [runs, events] = await Promise.all([
      database.collection('backup_runs').find({}).sort({ startedAt: -1 }).limit(10).toArray(),
      database
        .collection('auditlogs')
        .find({ $or: [{ targetKind: 'backup' }, { action: { $regex: '^backup_' } }] })
        .sort({ createdAt: -1 })
        .limit(30)
        .toArray(),
    ])
    await recoveryEvent(database, {
      actor: req.user,
      action: 'backup_activity_viewed',
      detail: `${runs.length} backup run(s), ${events.length} backup event(s)`,
      ...meta(req),
    })
    res.json({
      runs: runs.map((run) => ({
        id: String(run._id),
        folder: run.drive?.folderName || null,
        status: run.status,
        startedAt: run.startedAt || null,
        completedAt: run.completedAt || null,
        rotatedAt: run.rotatedAt || null,
        retryAttempts: run.retryAttempts || 0,
        lastError: run.lastError || null,
        docs: run.totals?.dbDocs || 0,
        mediaFiles: run.totals?.mediaFiles || 0,
        mediaBytes: run.totals?.mediaBytes || 0,
      })),
      events: events.map((event) => ({
        at: event.createdAt || null,
        action: event.action,
        targetLabel: event.targetLabel || '',
        detail: event.detail || '',
      })),
    })
  } catch (err) {
    next(err)
  }
})

router.post('/dry-run', async (req, res, next) => {
  try {
    if (!ensureConfigured(res)) return
    const { checkpointId, mode } = req.body || {}
    if (!checkpointId) return res.status(400).json({ message: 'checkpointId is required' })
    const out = await dryRun({ checkpointId, mode, actor: req.user, ...meta(req) })
    res.json(out)
  } catch (err) {
    next(err)
  }
})

router.post('/operations', async (req, res, next) => {
  try {
    if (!ensureConfigured(res)) return
    const { checkpointId, mode, confirmation, acknowledge } = req.body || {}
    if (!checkpointId) return res.status(400).json({ message: 'checkpointId is required' })
    const out = await startRestore({
      checkpointId,
      mode,
      confirmation,
      acknowledge: acknowledge === true,
      actor: req.user,
      ...meta(req),
    })
    res.status(202).json(out)
  } catch (err) {
    next(err)
  }
})

router.get('/operations', async (req, res, next) => {
  try {
    res.json({ items: await listRecentOperations() })
  } catch (err) {
    next(err)
  }
})

router.get('/operations/:id', async (req, res, next) => {
  try {
    res.json({ operation: await getOperationPublic(req.params.id) })
  } catch (err) {
    next(err)
  }
})

router.post('/operations/:id/rollback', async (req, res, next) => {
  try {
    if (!ensureConfigured(res)) return
    const out = await manualRollback({ operationId: req.params.id, actor: req.user, ...meta(req) })
    res.status(202).json(out)
  } catch (err) {
    next(err)
  }
})

export default router
