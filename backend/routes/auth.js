import { Router } from 'express'
import passport from 'passport'
import rateLimit from 'express-rate-limit'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many login attempts. Try again later.' },
})

function out(user) {
  if (!user) return null
  return { _id: user._id, name: user.name, email: user.email, phone: user.phone, region: user.region, role: user.role, superAdmin: !!user.superAdmin }
}

router.post('/login', loginLimiter, (req, res, next) => {
  if (!req.body?.email && typeof req.body?.username === 'string') req.body.email = req.body.username
  passport.authenticate('local', (err, user, info) => {
    if (err) return next(err)
    if (!user) return res.status(401).json({ message: info?.message || 'Invalid email or password' })
    if (user.active === false) {
      req.logOut(() => {})
      return res.status(403).json({ message: 'Account disabled' })
    }
    req.logIn(user, (e) => {
      if (e) return next(e)
      res.json({ user: out(user) })
    })
  })(req, res, next)
})

router.post('/logout', (req, res, next) => {
  req.logOut((e) => {
    if (e) return next(e)
    res.json({ ok: true })
  })
})

router.get('/me', (req, res) => {
  if (req.user?.active === false) {
    req.logOut(() => {})
    return res.json({ user: null })
  }
  res.json({ user: req.user ? out(req.user) : null })
})

router.post('/change-password', requireAuth, (req, res, next) => {
  const { currentPassword, newPassword } = req.body || {}
  const nextPwd = String(newPassword ?? '')
  if (!currentPassword || nextPwd.length < 6) {
    return res.status(400).json({ message: 'New password must be at least 6 characters' })
  }
  req.user.authenticate(currentPassword, (err, result) => {
    if (err) return next(err)
    if (!result) return res.status(400).json({ message: 'Current password is incorrect' })
    req.user.setPassword(nextPwd, (e) => {
      if (e) return next(e)
      req.user.save().then(() => res.json({ ok: true })).catch(next)
    })
  })
})

export default router
