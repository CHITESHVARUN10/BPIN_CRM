import { Router } from 'express'
import mongoose from 'mongoose'
import multer from 'multer'
import ServiceRecord from '../models/ServiceRecord.js'
import Assignment from '../models/Assignment.js'
import Product from '../models/Product.js'
import Problem from '../models/Problem.js'
import User from '../models/User.js'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import { nextToken } from '../utils/token.js'
import { escapeRx } from '../utils/common.js'
import { startOfDay, startOfMonth, parseBounds } from '../utils/dates.js'
import { storageEnabled, uploadMedia } from '../utils/blob.js'
import { logAudit, ACTIONS } from '../utils/log.js'
import Notification from '../models/Notification.js'
import { sendToUser } from '../utils/push.js'
import { formatDateLabel } from '../utils/dates.js'

const router = Router()

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime'])
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'videos') {
      if (VIDEO_TYPES.has(file.mimetype)) return cb(null, true)
      const err = new Error('Only MP4, WebM or MOV videos are allowed')
      err.status = 400
      return cb(err)
    }
    if (IMAGE_TYPES.has(file.mimetype)) return cb(null, true)
    const err = new Error('Only JPEG, PNG or WebP images are allowed')
    err.status = 400
    return cb(err)
  },
})
const uploadMediaFiles = upload.fields([
  { name: 'images', maxCount: 4 },
  { name: 'videos', maxCount: 1 },
])

async function collectMedia(req) {
  const images = req.files?.images || []
  const videos = req.files?.videos || []
  if ((images.length || videos.length) && !storageEnabled()) {
    const err = new Error('Media upload is not configured on the server')
    err.status = 400
    throw err
  }
  const media = []
  for (const file of images) {
    if (file.size > 10 * 1024 * 1024) {
      const err = new Error('Each photo must be under 10MB')
      err.status = 400
      throw err
    }
    media.push(await uploadMedia(file.buffer, { contentType: file.mimetype, kind: 'image' }))
  }
  for (const file of videos) {
    media.push(await uploadMedia(file.buffer, { contentType: file.mimetype, kind: 'video' }))
  }
  return media
}

router.post('/', requireAuth, uploadMediaFiles, async (req, res, next) => {
  try {
    const body = req.body
    const serial = String(body.serialNumber || '').trim()
    if (!serial) return res.status(400).json({ message: 'Serial number is required' })

    const product = await Product.findOne({ sku: String(body.sku || '').trim() }).lean()
    if (!product) return res.status(404).json({ message: 'Unknown SKU' })

    const customerReport = String(body.customerReport || '').trim()
    if (!customerReport) return res.status(400).json({ message: 'Customer reported problem is required' })

    const isOther = String(body.isOther || '').toLowerCase() === 'true' || body.isOther === true
    let problemSub
    if (isOther) {
      const title = String(body.problemOtherTitle || '').trim()
      const otherDesc = String(body.problemOtherDescription || '').trim()
      if (!title) return res.status(400).json({ message: 'Please name the other problem' })
      if (!otherDesc) return res.status(400).json({ message: 'Description is required for other problems' })
      problemSub = { ref: null, name: title, isOther: true, otherDescription: otherDesc }
    } else {
      const problem = await Problem.findOne({ _id: body.problemId, archived: false }).lean()
      if (!problem) return res.status(400).json({ message: 'Select a problem from the list' })
      problemSub = { ref: problem._id, name: problem.name, isOther: false }
    }

    let assignment = null
    const assignmentId = String(body.assignmentId || '').trim()
    if (assignmentId) {
      if (!mongoose.isValidObjectId(assignmentId)) {
        return res.status(400).json({ message: 'Invalid assignment' })
      }
      assignment = await Assignment.findById(assignmentId)
      if (!assignment) return res.status(404).json({ message: 'Assignment not found' })
      if (String(assignment.assignedTo) !== String(req.user._id)) {
        return res.status(403).json({ message: 'This assignment is not assigned to you' })
      }
      if (assignment.serviceRecord) {
        return res.status(400).json({ message: 'This assignment already has a service report' })
      }
    }

    const uploads = await collectMedia(req)

    const create = async () => ServiceRecord.create({
      tokenNo: await nextToken(),
      technician: req.user._id,
      product: product._id,
      productSnapshot: { sku: product.sku, description: product.description, category: product.category },
      serialNumber: serial,
      customerReport,
      problem: problemSub,
      notes: String(body.notes || '').trim(),
      vehicle: { make: String(body.vehicleMake || '').trim(), model: String(body.vehicleModel || '').trim() },
      images: uploads,
      visitDate: body.visitDate ? new Date(body.visitDate) : undefined,
    })

    let record
    try {
      record = await create()
    } catch (err) {
      if (err?.code === 11000 && err?.keyPattern?.tokenNo) record = await create()
      else throw err
    }

    await logAudit(req.user, ACTIONS.caseCreated, { kind: 'record', id: record._id, label: record.tokenNo }, `${product.sku} · ${problemSub.name}`)

    if (assignment) {
      await Assignment.updateOne(
        { _id: assignment._id, serviceRecord: null },
        { $set: { serviceRecord: record._id, status: 'done', doneAt: new Date(), updatedAt: new Date() } },
      )
      await logAudit(req.user, ACTIONS.assignmentUpdated, { kind: 'assignment', id: assignment._id, label: `${assignment.customerName} → ${req.user.name}` }, `Report filed: ${record.tokenNo}`)
    }

    return res.status(201).json({ record: { _id: record._id, tokenNo: record.tokenNo, serialNumber: record.serialNumber } })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/close', requireAuth, uploadMediaFiles, async (req, res, next) => {
  try {
    const record = await ServiceRecord.findById(req.params.id)
    if (!record) return res.status(404).json({ message: 'Record not found' })
    if (String(record.technician) !== String(req.user._id) && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only the opening service engineer or an admin can close this case' })
    }
    if (record.status === 'closed') {
      return res.status(400).json({ message: 'This case is already closed' })
    }

    const workDone = String(req.body.workDone || '').trim()
    if (!workDone) return res.status(400).json({ message: 'Please describe the work done before closing' })

    const uploads = await collectMedia(req)

    record.closure = {
      closedBy: req.user._id,
      closedByRole: req.user.role,
      closedByName: req.user.name,
      workDone,
      images: uploads,
      closedAt: new Date(),
    }
    record.status = 'closed'
    await record.save()

    await logAudit(req.user, ACTIONS.caseClosed, { kind: 'record', id: record._id, label: record.tokenNo }, `Closed by ${req.user.role} · ${workDone.slice(0, 120)}`)

    return res.json({ record: { _id: record._id, tokenNo: record.tokenNo, status: record.status } })
  } catch (err) {
    next(err)
  }
})

router.patch('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const record = await ServiceRecord.findById(req.params.id)
    if (!record) return res.status(404).json({ message: 'Record not found' })
    if (record.status === 'closed') {
      return res.status(400).json({ message: 'Closed cases cannot be edited — reopen the case instead' })
    }

    const body = req.body || {}
    const changes = []
    const serial = String(body.serialNumber ?? '').trim()
    if (body.serialNumber !== undefined && serial && serial !== record.serialNumber) {
      changes.push(`Serial: ${record.serialNumber} → ${serial}`)
      record.serialNumber = serial
    }
    const customerReport = String(body.customerReport ?? '').trim()
    if (body.customerReport !== undefined && customerReport && customerReport !== record.customerReport) {
      changes.push('Customer report updated')
      record.customerReport = customerReport
    }
    if (body.notes !== undefined && String(body.notes).trim() !== record.notes) {
      changes.push('Assessment details updated')
      record.notes = String(body.notes).trim()
    }
    if (body.vehicleMake !== undefined && String(body.vehicleMake).trim() !== (record.vehicle?.make || '')) {
      changes.push(`Vehicle make: ${record.vehicle?.make || '—'} → ${String(body.vehicleMake).trim() || '—'}`)
      record.vehicle.make = String(body.vehicleMake).trim()
    }
    if (body.vehicleModel !== undefined && String(body.vehicleModel).trim() !== (record.vehicle?.model || '')) {
      changes.push(`Vehicle model: ${record.vehicle?.model || '—'} → ${String(body.vehicleModel).trim() || '—'}`)
      record.vehicle.model = String(body.vehicleModel).trim()
    }

    const isOther = String(body.isOther || '').toLowerCase() === 'true' || body.isOther === true
    if (body.problemId !== undefined || isOther) {
      let problemSub
      if (isOther) {
        const title = String(body.problemOtherTitle || '').trim()
        const otherDesc = String(body.problemOtherDescription || '').trim()
        if (!title || !otherDesc) return res.status(400).json({ message: 'Other problems need both a name and a description' })
        problemSub = { ref: null, name: title, isOther: true, otherDescription: otherDesc }
      } else {
        const problem = await Problem.findOne({ _id: body.problemId, archived: false }).lean()
        if (!problem) return res.status(400).json({ message: 'Select a problem from the list' })
        problemSub = { ref: problem._id, name: problem.name, isOther: false }
      }
      if (problemSub.name !== record.problem?.name || problemSub.isOther !== record.problem?.isOther) {
        changes.push(`Problem: ${record.problem?.name}${record.problem?.isOther ? ' (Other)' : ''} → ${problemSub.name}${problemSub.isOther ? ' (Other)' : ''}`)
        record.problem = problemSub
      }
    }

    if (!changes.length) return res.json({ record, changed: false })

    await record.save()
    await logAudit(req.user, ACTIONS.caseEdited, { kind: 'record', id: record._id, label: record.tokenNo }, changes.join(' | '))
    res.json({ record, changed: true })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/reopen', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const record = await ServiceRecord.findById(req.params.id).populate('technician', 'name')
    if (!record) return res.status(404).json({ message: 'Record not found' })
    if (record.status === 'open') return res.status(400).json({ message: 'This case is already open' })

    record.status = 'open'
    record.closure = null
    await record.save()

    const title = 'Case reopened'
    const body = `${record.tokenNo} was reopened by ${req.user.name}. Please review the case and add follow-ups if needed.`
    await Notification.create({ recipient: record.technician, title, body, type: 'broadcast' })
    await sendToUser(record.technician, { title, body, url: `/records/${record._id}` })

    await logAudit(req.user, ACTIONS.caseReopened, { kind: 'record', id: record._id, label: record.tokenNo }, `Reopened for ${record.technician?.name || 'technician'}`)
    res.json({ record: { _id: record._id, tokenNo: record.tokenNo, status: record.status } })
  } catch (err) {
    next(err)
  }
})

router.get('/my', requireAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const filter = {}
    if (req.user.role === 'admin') {
      if (req.query.technician) filter.technician = req.query.technician
    } else {
      filter.technician = req.user._id
    }

    const q = String(req.query.q || '').trim()
    if (q) {
      const rx = new RegExp(escapeRx(q), 'i')
      filter.$or = [{ tokenNo: rx }, { serialNumber: rx }]
    }
    const { from, to } = parseBounds(req.query.from, req.query.to)
    if (from && to) filter.visitDate = { $gte: from, $lte: to }
    else if (from) filter.visitDate = { $gte: from }
    else if (to) filter.visitDate = { $lte: to }

    if (req.query.problem) filter['problem.ref'] = req.query.problem
    if (req.query.sku) filter['productSnapshot.sku'] = String(req.query.sku)
    if (req.query.status === 'open' || req.query.status === 'closed') filter.status = req.query.status

    const per = 20
    const total = await ServiceRecord.countDocuments(filter)
    const items = await ServiceRecord.find(filter)
      .sort('-createdAt')
      .skip((page - 1) * per)
      .limit(per)
      .select('tokenNo visitDate serialNumber images productSnapshot problem status followUps technician createdAt')
      .populate('technician', 'name')
      .lean()
    res.json({ items, total, page, pages: Math.max(1, Math.ceil(total / per)) })
  } catch (err) {
    next(err)
  }
})

router.get('/my-stats', requireAuth, async (req, res, next) => {
  try {
    const filter = { technician: req.user._id }
    const [today, month, total] = await Promise.all([
      ServiceRecord.countDocuments({ ...filter, visitDate: { $gte: startOfDay() } }),
      ServiceRecord.countDocuments({ ...filter, visitDate: { $gte: startOfMonth() } }),
      ServiceRecord.countDocuments(filter),
    ])
    res.json({ today, month, total })
  } catch (err) {
    next(err)
  }
})

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const record = await ServiceRecord.findById(req.params.id)
      .populate('technician', 'name email phone region')
      .populate('product', 'sku description category')
      .populate('problem.ref', 'name archived')
      .populate('closure.closedBy', 'name role')
    if (!record) return res.status(404).json({ message: 'Record not found' })
    if (String(record.technician._id) !== String(req.user._id) && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Forbidden' })
    }
    res.json({ record })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/follow-up', requireAuth, uploadMediaFiles, async (req, res, next) => {
  try {
    const record = await ServiceRecord.findById(req.params.id)
    if (!record) return res.status(404).json({ message: 'Record not found' })
    if (String(record.technician) !== String(req.user._id) && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Forbidden' })
    }
    if (record.status === 'closed') {
      return res.status(400).json({ message: 'This record is already closed' })
    }

    const body = req.body
    const customerReport = String(body.customerReport || '').trim()
    if (!customerReport) return res.status(400).json({ message: 'Customer reported problem is required' })

    const isOther = String(body.isOther || '').toLowerCase() === 'true' || body.isOther === true
    let problemSub
    if (isOther) {
      const title = String(body.problemOtherTitle || '').trim()
      const otherDesc = String(body.problemOtherDescription || '').trim()
      if (!title) return res.status(400).json({ message: 'Please name the other problem' })
      if (!otherDesc) return res.status(400).json({ message: 'Description is required for other problems' })
      problemSub = { ref: null, name: title, isOther: true, otherDescription: otherDesc }
    } else {
      const problem = await Problem.findOne({ _id: body.problemId, archived: false }).lean()
      if (!problem) return res.status(400).json({ message: 'Select a problem from the list' })
      problemSub = { ref: problem._id, name: problem.name, isOther: false }
    }

    const uploads = await collectMedia(req)

    const closes = String(body.closes || '').toLowerCase() === 'true' || body.closes === true
    record.followUps.push({
      customerReport,
      problem: problemSub,
      notes: String(body.notes || '').trim(),
      images: uploads,
      closes,
      filedAt: new Date(),
    })
    if (closes) record.status = 'closed'
    await record.save()

    return res.json({ record: { _id: record._id, tokenNo: record.tokenNo, status: record.status } })
  } catch (err) {
    next(err)
  }
})

export default router
