import 'dotenv/config'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import session from 'express-session'
import MongoStore from 'connect-mongo'
import helmet from 'helmet'
import morgan from 'morgan'
import mongoose from 'mongoose'
import passport from 'passport'

import { connectDB } from './db.js'
import { initPassport } from './passport.js'
import authRoutes from './routes/auth.js'
import productRoutes from './routes/products.js'
import problemRoutes from './routes/problems.js'
import recordRoutes from './routes/records.js'
import fileRoutes from './routes/files.js'
import assignmentRoutes from './routes/assignments.js'
import notificationRoutes from './routes/notifications.js'
import pushRoutes from './routes/push.js'
import reportRoutes from './routes/reports.js'
import userRoutes from './routes/users.js'
import logRoutes from './routes/logs.js'
import recoveryRoutes from './routes/recovery.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 5000

async function main() {
  try {
    await connectDB()
  } catch (err) {
    console.error(`[bp] MongoDB connection failed: ${err.message}`)
    process.exit(1)
  }

  if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
    console.error('[bp] SESSION_SECRET is required in production')
    process.exit(1)
  }

  initPassport()

  const app = express()
  app.set('trust proxy', 1)
  app.use(helmet({ contentSecurityPolicy: false }))
  app.use(express.json({ limit: '1mb' }))
  if (process.env.NODE_ENV !== 'production') app.use(morgan('tiny'))

  // CORS for separately hosted clients (e.g. Vercel) — allowlisted origins only.
  const allowedOrigins = String(process.env.CLIENT_ORIGINS || '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean)
  if (allowedOrigins.length) {
    app.use((req, res, next) => {
      const origin = req.headers.origin
      if (origin && allowedOrigins.includes(origin.replace(/\/+$/, ''))) {
        res.setHeader('Access-Control-Allow-Origin', origin)
        res.setHeader('Access-Control-Allow-Credentials', 'true')
        res.setHeader('Vary', 'Origin')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS')
      }
      if (req.method === 'OPTIONS') return res.sendStatus(204)
      return next()
    })
  }

  app.use(session({
    name: 'bpin.sid',
    secret: process.env.SESSION_SECRET || 'bpin-dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: process.env.COOKIE_SAMESITE || (process.env.NODE_ENV === 'production' ? 'none' : 'lax'),
      secure: 'auto',
    },
    store: MongoStore.create({ client: mongoose.connection.getClient(), collectionName: 'sessions' }),
  }))
  app.use(passport.initialize())
  app.use(passport.session())

  app.use('/api/auth', authRoutes)
  app.use('/api/products', productRoutes)
  app.use('/api/problems', problemRoutes)
  app.use('/api/records', recordRoutes)
  app.use('/api/files', fileRoutes)
  app.use('/api/assignments', assignmentRoutes)
  app.use('/api/notifications', notificationRoutes)
  app.use('/api/push', pushRoutes)
  app.use('/api/reports', reportRoutes)
  app.use('/api/users', userRoutes)
  app.use('/api/logs', logRoutes)
  app.use('/api/recovery', recoveryRoutes)
  app.get('/api/health', async (req, res) => {
    let db = 'up'
    try {
      await mongoose.connection.db.admin().command({ ping: 1 })
    } catch (err) {
      db = 'down'
    }
    res.status(db === 'up' ? 200 : 503).json({
      ok: db === 'up',
      service: 'bpin-crm-backend',
      db,
      uptimeSec: Math.floor(process.uptime()),
      time: new Date().toISOString(),
    })
  })
  app.use('/api', (req, res) => res.status(404).json({ message: 'Not found' }))

  const dist = path.join(__dirname, '..', 'frontend', 'dist')
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache')
      },
    }))
    app.use((req, res, next) => {
      if (req.method === 'GET' && !req.path.startsWith('/api')) {
        return res.sendFile(path.join(dist, 'index.html'))
      }
      return next()
    })
  }

  app.use((err, req, res, next) => {
    const status = err.status || (err.code === 11000 ? 409 : err.name === 'MulterError' ? 400 : 500)
    if (status >= 500) console.error(err)
    res.status(status).json({ message: err.message || 'Internal server error' })
  })

  function lanAddresses() {
    const out = []
    for (const list of Object.values(os.networkInterfaces())) {
      for (const ni of list || []) {
        if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address)
      }
    }
    return out
  }

  app.listen(PORT, () => {
    console.log('BPIN backend is running:')
    console.log(`  Local:   http://localhost:${PORT}`)
    for (const ip of lanAddresses()) {
      console.log(`  Network: http://${ip}:${PORT}  (same Wi-Fi devices)`)
    }
  })
}

main()
