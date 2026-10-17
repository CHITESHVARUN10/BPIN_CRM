import { Router } from 'express'
import Problem from '../models/Problem.js'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import { logAudit, ACTIONS } from '../utils/log.js'

const router = Router()

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const filter = req.user.role === 'admin' && req.query.all === 'true' ? {} : { archived: false }
    const items = await Problem.find(filter).sort({ name: 1 }).lean()
    res.json({ items })
  } catch (err) {
    next(err)
  }
})

router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim()
    if (!name) return res.status(400).json({ message: 'Name is required' })
    const exists = await Problem.findOne({ name }).lean()
    if (exists) return res.status(409).json({ message: 'Problem already exists' })
    const item = await Problem.create({ name })
    await logAudit(req.user, ACTIONS.problemCreated, { kind: 'problem', id: item._id, label: item.name })
    res.status(201).json({ item })
  } catch (err) {
    next(err)
  }
})

router.patch('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const update = {}
    if (typeof req.body?.name === 'string') update.name = req.body.name.trim()
    if (typeof req.body?.archived === 'boolean') update.archived = req.body.archived
    const item = await Problem.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true })
    if (!item) return res.status(404).json({ message: 'Problem not found' })
    await logAudit(req.user, ACTIONS.problemUpdated, { kind: 'problem', id: item._id, label: item.name }, Object.keys(update).join(', '))
    res.json({ item })
  } catch (err) {
    next(err)
  }
})

export default router
