import { Router } from 'express'
import AuditLog from '../models/AuditLog.js'
import { requireAuth, requireAdmin } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth, requireAdmin)

const VALID_ACTIONS = [
  'user_created', 'user_updated',
  'case_created', 'case_edited', 'case_closed', 'case_reopened',
  'product_created', 'product_updated',
  'assignment_created', 'assignment_updated',
  'problem_created', 'problem_updated',
]

router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const per = 30
    const filter = {}
    if (VALID_ACTIONS.includes(req.query.action)) filter.action = req.query.action
    if (req.query.actor) filter.actor = req.query.actor
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
