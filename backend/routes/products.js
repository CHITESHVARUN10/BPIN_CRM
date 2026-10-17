import { Router } from 'express'
import Product from '../models/Product.js'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import { escapeRx } from '../utils/common.js'
import { logAudit, ACTIONS } from '../utils/log.js'

const router = Router()

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25))
    const q = String(req.query.q || '').trim()
    const category = String(req.query.category || '').trim()
    const filter = {}
    if (q) filter.$or = [{ sku: new RegExp(escapeRx(q), 'i') }, { description: new RegExp(escapeRx(q), 'i') }]
    if (category) filter.category = category
    const total = await Product.countDocuments(filter)
    const items = await Product.find(filter).sort({ sku: 1 }).skip((page - 1) * limit).limit(limit).lean()
    res.json({ items, total, page, pages: Math.max(1, Math.ceil(total / limit)) })
  } catch (err) {
    next(err)
  }
})

router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const sku = String(req.body?.sku || '').trim()
    const description = String(req.body?.description || '').trim()
    const category = String(req.body?.category || '').trim() || 'Others'
    if (!sku || !description) return res.status(400).json({ message: 'SKU and description are required' })
    const exists = await Product.findOne({ sku }).lean()
    if (exists) return res.status(409).json({ message: `SKU ${sku} already exists` })
    const item = await Product.create({ sku, description, category })
    await logAudit(req.user, ACTIONS.productCreated, { kind: 'product', id: item._id, label: `${sku} — ${description}` }, `Category: ${category}`)
    res.status(201).json({ item })
  } catch (err) {
    next(err)
  }
})

router.patch('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id)
    if (!product) return res.status(404).json({ message: 'Product not found' })

    const changes = []
    if (req.body?.sku !== undefined && String(req.body.sku).trim() !== product.sku) {
      const sku = String(req.body.sku).trim()
      if (!sku) return res.status(400).json({ message: 'SKU cannot be empty' })
      const dupe = await Product.findOne({ sku, _id: { $ne: product._id } }).lean()
      if (dupe) return res.status(409).json({ message: `SKU ${sku} already belongs to another product` })
      changes.push(`SKU: ${product.sku} → ${sku}`)
      product.sku = sku
    }
    if (req.body?.description !== undefined && String(req.body.description).trim() !== product.description) {
      const description = String(req.body.description).trim()
      if (!description) return res.status(400).json({ message: 'Description cannot be empty' })
      changes.push(`Description: ${product.description} → ${description}`)
      product.description = description
    }
    if (req.body?.category !== undefined && String(req.body.category).trim() !== product.category) {
      changes.push(`Category: ${product.category} → ${String(req.body.category).trim()}`)
      product.category = String(req.body.category).trim()
    }

    await product.save()
    if (changes.length) {
      await logAudit(req.user, ACTIONS.productUpdated, { kind: 'product', id: product._id, label: `${product.sku} — ${product.description}` }, changes.join(' | '))
    }
    res.json({ item: product })
  } catch (err) {
    next(err)
  }
})

router.post('/import', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const products = Array.isArray(req.body?.products) ? req.body.products : null
    if (!products || !products.length) return res.status(400).json({ message: 'products array required' })
    const valid = products
      .map((p) => ({ sku: String(p.sku || '').trim(), description: String(p.description || '').trim(), category: String(p.category || '').trim() || 'Others' }))
      .filter((p) => p.sku && p.description)
    if (!valid.length) return res.status(400).json({ message: 'No valid rows' })
    await Product.bulkWrite(
      valid.map((p) => ({ updateOne: { filter: { sku: p.sku }, update: { $set: { description: p.description, category: p.category } }, upsert: true } })),
      { ordered: false },
    )
    res.json({ saved: valid.length })
  } catch (err) {
    next(err)
  }
})

export default router
