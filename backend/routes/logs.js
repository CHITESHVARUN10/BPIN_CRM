import { Router } from 'express'
import AuditLog from '../models/AuditLog.js'
import { requireAuth, requireAdmin } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth, requireAdmin)

const VALID_ACTIONS = [
  'user_created', 'user_updated', 'user_password_reset',
  'case_created', 'case_edited', 'case_closed', 'case_reopened',
  'product_created', 'product_updated',
  'assignment_created', 'assignment_updated',
  'problem_created', 'problem_updated',
  'backup_started', 'backup_completed', 'backup_failed', 'backup_retry', 'backup_retry_manual',
  'backup_rotated', 'backup_attempt_skipped', 'backup_attempt_failed', 'backup_worker_failed',
  'recovery_reauth_success', 'recovery_reauth_failed', 'recovery_reauth_rate_limited',
  'recovery_access_denied', 'recovery_inventory_listed', 'recovery_dry_run',
  'recovery_restore_requested', 'recovery_snapshot_created', 'recovery_database_restored',
  'recovery_assets_restored', 'recovery_references_repaired', 'recovery_restore_completed',
  'recovery_restore_partial_failure', 'recovery_restore_failed', 'recovery_rollback_started',
  'recovery_rollback_completed', 'recovery_rollback_failed', 'recovery_rollback_manual_requested',
  'recovery_recovery_locked', 'recovery_backup_activity_viewed',
]

router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const per = 30
    const filter = {}
    if (VALID_ACTIONS.includes(req.query.action)) filter.action = req.query.action
    if (req.query.actor) filter.actor = req.query.actor
    // Backup pipeline logs are visible only to the super admin. Ordinary
    // admins see all other audit activity.
    if (req.user?.superAdmin !== true) filter.targetKind = { $ne: 'backup' }
    const total = await AuditLog.countDocuments(filter)
    const items = await AuditLog.find(filter)
      .sort('-createdAt')
      .skip((page - 1) * per)
      .limit(per)
      .lean()
    res.json({ items, total, page, pages: Math.max(1, Math.ceil(total / per)) })
  } catch (err) {
    next(err)
  }
})

export default router
