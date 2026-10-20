import { Router } from 'express'
import Assignment from '../models/Assignment.js'
import Notification from '../models/Notification.js'
import User from '../models/User.js'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import { sendToUser } from '../utils/push.js'
import { formatDateLabel } from '../utils/dates.js'
import { logAudit, ACTIONS } from '../utils/log.js'
import { isObjectId } from '../utils/common.js'

const router = Router()

router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const filter = {}
    if (req.query.status === 'pending' || req.query.status === 'done') filter.status = req.query.status
    if (req.query.technician) {
      if (!isObjectId(req.query.technician)) return res.status(400).json({ message: 'Invalid technician' })
      filter.assignedTo = req.query.technician
    }
    const items = await Assignment.find(filter)
      .sort({ visitDate: -1, createdAt: -1 })
      .populate('assignedTo', 'name phone email region')
      .populate('assignedBy', 'name')
      .populate('serviceRecord', 'tokenNo status createdAt')
      .lean()
    res.json({ items: items.map((item) => ({ ...item, reportFiled: Boolean(item.serviceRecord) })) })
  } catch (err) {
    next(err)
  }
})

router.get('/my', requireAuth, async (req, res, next) => {
  try {
    const filter = { assignedTo: req.user._id }
    if (req.query.status === 'pending' || req.query.status === 'done') filter.status = req.query.status
    const items = await Assignment.find(filter)
      .sort({ visitDate: -1, createdAt: -1 })
      .populate('assignedBy', 'name')
      .populate('serviceRecord', 'tokenNo status createdAt')
      .lean()
    res.json({ items: items.map((item) => ({ ...item, reportFiled: Boolean(item.serviceRecord) })) })
  } catch (err) {
    next(err)
  }
})

router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const body = req.body || {}
    if (!isObjectId(body.assignedTo)) return res.status(400).json({ message: 'Select a valid, active technician' })
    const engineer = await User.findOne({ _id: body.assignedTo, role: 'technician', active: true }).select('name').lean()
    if (!engineer) return res.status(400).json({ message: 'Select a valid, active technician' })
    const customerName = String(body.customerName || '').trim()
    const customerPhone = String(body.customerPhone || '').trim()
    const address = String(body.address || '').trim()
    const timing = String(body.timing || '').trim()
    if (!customerName || !customerPhone || !address || !timing) {
      return res.status(400).json({ message: 'Customer name, phone, address and timing are required' })
    }
    if (customerPhone.replace(/\D/g, '').length < 10) {
      return res.status(400).json({ message: 'Customer phone must have at least 10 digits' })
    }
    const visitDate = body.visitDate ? new Date(body.visitDate) : null
    if (!visitDate || Number.isNaN(visitDate.getTime())) {
      return res.status(400).json({ message: 'Visit date is required' })
    }

    const assignment = await Assignment.create({
      assignedTo: engineer._id,
      assignedBy: req.user._id,
      customerName,
      customerPhone,
      address,
      pincode: String(body.pincode || '').trim(),
      visitDate,
      timing,
      notes: String(body.notes || '').trim(),
    })

    const title = 'New assignment'
    const notificationBody = `${customerName} · ${formatDateLabel(visitDate)} · ${timing}`
    await Notification.create({ recipient: engineer._id, title, body: notificationBody, type: 'assignment' })
    await sendToUser(engineer._id, { title, body: notificationBody, url: '/assignments', tag: 'assignment' })
    await logAudit(req.user, ACTIONS.assignmentCreated, { kind: 'assignment', id: assignment._id, label: `${customerName} → ${engineer.name}` }, `${formatDateLabel(visitDate)} · ${timing}`)

    res.status(201).json({ item: assignment })
  } catch (err) {
    next(err)
  }
})

router.patch('/:id/status', requireAuth, async (req, res, next) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ message: 'Assignment not found' })
    const assignment = await Assignment.findById(req.params.id)
    if (!assignment) return res.status(404).json({ message: 'Assignment not found' })
    const isOwnerEngineer = String(assignment.assignedTo) === String(req.user._id)
    if (!isOwnerEngineer && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Forbidden' })
    }
    if (req.body?.status !== 'pending' && req.body?.status !== 'done') {
      return res.status(400).json({ message: 'Status must be pending or done' })
    }
    if (req.body.status === 'done' && !assignment.serviceRecord) {
      return res.status(400).json({ message: 'File a service report before marking this assignment done' })
    }
    if (req.body.status === 'pending' && assignment.serviceRecord) {
      return res.status(400).json({ message: 'This assignment already has a linked service report' })
    }
    assignment.status = req.body.status
    assignment.doneAt = req.body.status === 'done' ? new Date() : null
    await assignment.save()
    await logAudit(req.user, ACTIONS.assignmentUpdated, { kind: 'assignment', id: assignment._id, label: `${assignment.customerName} → ${String(assignment.assignedTo)}` }, `Marked ${assignment.status}`)
    res.json({ item: assignment })
  } catch (err) {
    next(err)
  }
})

export default router
