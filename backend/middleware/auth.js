export function requireAuth(req, res, next) {
  if (req.isAuthenticated?.() && req.user && req.user.active !== false) return next()
  return res.status(401).json({ message: 'Not signed in' })
}

export function requireAdmin(req, res, next) {
  if (req.isAuthenticated?.() && req.user && req.user.role === 'admin') return next()
  return res.status(403).json({ message: 'Forbidden' })
}

export function requireSuperAdmin(req, res, next) {
  if (req.isAuthenticated?.() && req.user && req.user.role === 'admin' && req.user.superAdmin === true) return next()
  return res.status(403).json({ message: 'Only the super admin can manage other administrators' })
}

export function safeUser(user) {
  if (!user) return null
  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    region: user.region,
    role: user.role,
    superAdmin: Boolean(user.superAdmin),
    active: user.active,
    createdAt: user.createdAt,
  }
}
