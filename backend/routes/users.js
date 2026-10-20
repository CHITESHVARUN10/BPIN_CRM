import { Router } from 'express'
import User from '../models/User.js'
import { requireAuth, requireAdmin, safeUser } from '../middleware/auth.js'
import { logAudit, ACTIONS } from '../utils/log.js'
import { isObjectId } from '../utils/common.js'

const router = Router()
router.use(requireAuth, requireAdmin)

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

router.get('/', async (req, res, next) => {
  try {
    const items = await User.find({}).sort({ role: 1, name: 1 }).lean()
    res.json({ items: items.map(safeUser) })
  } catch (err) {
    next(err)
  }
})

router.post('/', async (req, res, next) => {
  try {
    const { name, email, phone, region, role, password } = req.body || {}
    if (!name?.trim()) return res.status(400).json({ message: 'Name is required' })
    const cleanedEmail = String(email || '').trim().toLowerCase()
    if (!EMAIL_RX.test(cleanedEmail)) return res.status(400).json({ message: 'Valid email is required' })
    if (!['technician', 'admin'].includes(role)) return res.status(400).json({ message: 'Role must be technician or admin' })
    if (role === 'admin' && req.user.superAdmin !== true) {
      return res.status(403).json({ message: 'Only the super admin can create administrator accounts' })
    }
    if (!password || String(password).length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' })

    const exists = await User.findOne({ email: cleanedEmail }).lean()
    if (exists) return res.status(409).json({ message: 'An account with this email already exists' })

    const user = new User({
      name: name.trim(),
      email: cleanedEmail,
      phone: String(phone || '').trim(),
      region: String(region || '').trim(),
      role,
    })
    await user.setPassword(String(password))
    await user.save()
    await logAudit(req.user, ACTIONS.userCreated, { kind: 'user', id: user._id, label: `${user.name} (${user.email})` }, `Role: ${user.role}${user.region ? ` · Region: ${user.region}` : ''}`)
    res.status(201).json({ item: safeUser(user) })
  } catch (err) {
    next(err)
  }
})

router.patch('/:id', async (req, res, next) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ message: 'User not found' })
    const user = await User.findById(req.params.id)
    if (!user) return res.status(404).json({ message: 'User not found' })

    const isSuperAdmin = req.user.superAdmin === true
    const isSelf = String(user._id) === String(req.user._id)
    if (user.role === 'admin' && !isSelf && !isSuperAdmin) {
      return res.status(403).json({ message: 'Only the super admin can manage other administrators' })
    }

    const b = req.body || {}
    if (b.name !== undefined) user.name = String(b.name).trim()
    if (b.phone !== undefined) user.phone = String(b.phone).trim()
    if (b.region !== undefined) user.region = String(b.region).trim()
    if (b.role !== undefined) {
      if (!['technician', 'admin'].includes(b.role)) return res.status(400).json({ message: 'Invalid role' })
      if (b.role === 'admin' && !isSuperAdmin) {
        return res.status(403).json({ message: 'Only the super admin can make someone an administrator' })
      }
      if (isSelf && b.role !== 'admin') {
        return res.status(400).json({ message: 'You cannot remove your own admin role' })
      }
      user.role = b.role
    }
    if (b.active !== undefined) {
      if (isSelf && b.active === false) {
        return res.status(400).json({ message: 'You cannot deactivate your own account' })
      }
      user.active = Boolean(b.active)
    }

    const setPassword = () => new Promise((resolve, reject) => user.setPassword(String(b.password), (e) => (e ? reject(e) : resolve())))
    if (b.password !== undefined) {
      if (String(b.password).length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' })
      await setPassword()
    }

    await user.save()
    const updatedFields = Object.keys(b).filter((key) => b[key] !== undefined && key !== 'password')
    if (updatedFields.length) {
      await logAudit(req.user, ACTIONS.userUpdated, { kind: 'user', id: user._id, label: `${user.name} (${user.email})` }, `Updated: ${updatedFields.join(', ')}`)
    }
    if (b.password !== undefined) {
      if (isSelf) {
        await logAudit(req.user, ACTIONS.userUpdated, { kind: 'user', id: user._id, label: `${user.name} (${user.email})` }, 'Updated: password')
      } else {
        await logAudit(
          req.user,
          ACTIONS.userPasswordReset,
          { kind: 'user', id: user._id, label: `${user.name} (${user.email})` },
          `Password reset for ${user.name} (${user.email})`,
        )
      }
    }
    res.json({ item: safeUser(user) })
  } catch (err) {
    next(err)
  }
})

export default router
