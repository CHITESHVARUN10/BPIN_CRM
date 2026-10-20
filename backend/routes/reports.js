import { Router } from 'express'
import User from '../models/User.js'
import ServiceRecord from '../models/ServiceRecord.js'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import { parseBounds, parseDateInput, startOfDay, subDaysToStart } from '../utils/dates.js'
import { buildRecordCsv, buildRecordPdf } from '../utils/exporters.js'

const router = Router()
router.use(requireAuth, requireAdmin)

router.get('/activity', async (req, res, next) => {
  try {
    const date = parseDateInput(req.query.date, 'activity') || new Date()
    const dayStart = startOfDay(date)
    const match = { visitDate: { $gte: dayStart, $lte: new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1) } }
    const grouped = await ServiceRecord.aggregate([
      { $match: { ...match, technician: { $exists: true } } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$technician', count: { $sum: 1 }, lastAt: { $first: '$createdAt' } } },
    ])
    const byTech = new Map(grouped.map((g) => [String(g._id), g]))
    const technicians = await User.find({ role: 'technician' }).lean()
    const items = technicians.map((u) => {
      const g = byTech.get(String(u._id))
      return {
        userId: u._id,
        name: u.name,
        email: u.email,
        region: u.region || '',
        active: u.active,
        count: g?.count || 0,
        lastAt: g?.lastAt || null,
      }
    })
    res.json({ date: req.query.date || new Date().toISOString().slice(0, 10), items })
  } catch (err) {
    next(err)
  }
})

router.get('/summary', async (req, res, next) => {
  try {
    let { from, to } = parseBounds(req.query.from, req.query.to)
    if (!from) from = subDaysToStart(30)
    if (!to) to = new Date()
    const match = { visitDate: { $gte: from, $lte: to } }
    const rangeStr = (d) => d.toISOString().slice(0, 10)

    const [records, perDay, perTech, perModel, topProblems] = await Promise.all([
      ServiceRecord.countDocuments(match),
      ServiceRecord.aggregate([
        { $match: match },
        { $group: { _id: { $substr: ['$visitDate', 0, 10] }, ts: { $first: '$visitDate' }, count: { $sum: 1 } } },
        { $sort: { ts: 1 } },
        { $project: { _id: { $concat: [{ $substr: ['$ts', 8, 2] }, '/', { $substr: ['$ts', 5, 2] }] }, count: 1 } },
      ]),
      ServiceRecord.aggregate([
        { $match: match },
        { $group: { _id: '$technician', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      ServiceRecord.aggregate([
        { $match: match },
        { $group: { _id: { sku: '$productSnapshot.sku', description: '$productSnapshot.description' }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      ServiceRecord.aggregate([
        { $match: match },
        { $group: { _id: '$problem.name', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
    ])

    const techIds = perTech.map((t) => t._id)
    const techs = techIds.length ? await User.find({ _id: { $in: techIds } }).lean() : []
    const nameById = new Map(techs.map((t) => [String(t._id), t.name]))

    res.json({
      range: { from: rangeStr(from), to: rangeStr(to) },
      totals: {
        records,
        technicians: perTech.length,
        models: perModel.length,
      },
      perDay,
      perTechnician: perTech.map((t) => ({ _id: t._id, name: nameById.get(String(t._id)) || 'Unknown', count: t.count })),
      perModel: perModel.map((m) => ({ sku: m._id.sku, description: m._id.description, count: m.count })),
      topProblems: topProblems.map((p) => ({ name: p._id || 'Other', count: p.count })),
    })
  } catch (err) {
    next(err)
  }
})

function parseExportQuery(req) {
  const { from, to } = parseBounds(req.query.from, req.query.to)
  const match = {}
  if (from && to) match.visitDate = { $gte: from, $lte: to }
  else if (from) match.visitDate = { $gte: from }
  else if (to) match.visitDate = { $lte: to }
  return { match, from, to }
}

router.get('/export.csv', async (req, res, next) => {
  try {
    const { match } = parseExportQuery(req)
    const records = await ServiceRecord.find(match).sort('visitDate').populate('technician', 'name region').limit(5000).lean()
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="bpin-service-report.csv"')
    res.send(buildRecordCsv(records))
  } catch (err) {
    next(err)
  }
})

router.get('/export.pdf', async (req, res, next) => {
  try {
    const { match, from, to } = parseExportQuery(req)
    const records = await ServiceRecord.find(match).sort('visitDate').populate('technician', 'name region').limit(500).lean()
    await buildRecordPdf(records, { from, to }, res)
  } catch (err) {
    next(err)
  }
})

export default router
