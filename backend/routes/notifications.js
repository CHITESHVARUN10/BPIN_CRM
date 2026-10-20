import { Router } from 'express'
import Notification from '../models/Notification.js'
import User from '../models/User.js'
import ServiceRecord from '../models/ServiceRecord.js'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import { sendToUser } from '../utils/push.js'
import { formatDateLabel, parseDateInput, startOfDay, endOfDay } from '../utils/dates.js'
import { isObjectId } from '../utils/common.js'

const router = Router()

router.get('/my', requireAuth, async (req, res, next) => {
  try {
    const recipient = req.user._id
    const [items, unread] = await Promise.all([
      Notification.find({ recipient }).sort('-createdAt').limit(50).lean(),
      Notification.countDocuments({ recipient, readAt: null }),
    ])
    res.json({ items, unread })
  } catch (err) {
    next(err)
  }
})

router.patch('/:id/read', requireAuth, async (req, res, next) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ message: 'Notification not found' })
    const item = await Notification.findOne({ _id: req.params.id, recipient: req.user._id })
    if (!item) return res.status(404).json({ message: 'Notification not found' })
    if (!item.readAt) {
      item.readAt = new Date()
      await item.save()
    }
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

router.post('/remind', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const date = parseDateInput(req.body?.date, 'reminder') || new Date()
    const from = startOfDay(date)
    const to = endOfDay(date)

    let users = []
    const userIds = Array.isArray(req.body?.userIds) ? req.body.userIds : null
    if (userIds?.length) {
      if (userIds.some((id) => !isObjectId(id))) return res.status(400).json({ message: 'Invalid technician' })
      users = await User.find({ _id: { $in: userIds }, role: 'technician', active: true }).lean()
    } else {
      const activeToday = await ServiceRecord.distinct('technician', { visitDate: { $gte: from, $lte: to } })
      const activeSet = new Set(activeToday.map(String))
      const allTechs = await User.find({ role: 'technician', active: true }).lean()
      users = allTechs.filter((u) => !activeSet.has(String(u._id)))
    }

    const title = String(req.body?.title || '').trim() || 'Pending service report'
    const body = String(req.body?.body || '').trim() || `You have not filed a service report for ${formatDateLabel(date)}. Please submit today's assessment.`

    const docs = await Notification.insertMany(users.map((u) => ({ recipient: u._id, title, body, type: 'reminder' })))
    await Promise.all(users.map((u) => sendToUser(u._id, { title, body, url: '/notifications' })))

    res.json({ sent: docs.length, recipients: users.map((u) => u.name) })
  } catch (err) {
    next(err)
  }
})

export default router
