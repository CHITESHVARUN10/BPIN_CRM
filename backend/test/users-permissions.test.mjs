import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import express from 'express'
import mongoose from 'mongoose'

import User from '../models/User.js'
import AuditLog from '../models/AuditLog.js'
import usersRouter from '../routes/users.js'
import authRouter from '../routes/auth.js'

const TEST_URI = 'mongodb://127.0.0.1:27017/bpin_users_permissions_test'
const PASSWORD = 'Password123!'

let server
let base
const accounts = {}

async function makeUser(data) {
  const user = new User(data)
  await user.setPassword(PASSWORD)
  await user.save()
  return user
}

async function call(path, { user = 'admin', method = 'GET', body } = {}) {
  const headers = { 'x-test-user': user }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(base + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => null)
  return { status: res.status, body: data }
}

before(async () => {
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 10000 })
  await mongoose.connection.dropDatabase()

  accounts.super = await makeUser({ name: 'Super Admin', email: 'super@users.test', role: 'admin', superAdmin: true })
  accounts.admin = await makeUser({ name: 'Normal Admin', email: 'admin@users.test', role: 'admin' })
  accounts.otherAdmin = await makeUser({ name: 'Other Admin', email: 'other-admin@users.test', role: 'admin' })
  accounts.technician = await makeUser({ name: 'Engineer', email: 'engineer@users.test', role: 'technician' })
  accounts.promote = await makeUser({ name: 'Promote Candidate', email: 'promote@users.test', role: 'technician' })
  accounts.inactive = await makeUser({ name: 'Disabled Admin', email: 'disabled@users.test', role: 'admin', active: false })

  const app = express()
  app.use(express.json())
  app.use((req, res, next) => {
    req.user = accounts[String(req.headers['x-test-user'] || '')] || null
    req.isAuthenticated = () => Boolean(req.user)
    req.logOut = (cb) => {
      req.user = null
      if (cb) cb()
    }
    next()
  })
  app.use('/api/users', usersRouter)
  app.use('/api/auth', authRouter)
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ message: err.message || 'Internal server error' })
  })

  server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  base = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve))
  await mongoose.connection.dropDatabase().catch(() => {})
  await mongoose.disconnect().catch(() => {})
})

test('a normal admin cannot create another admin', async () => {
  const beforeCount = await User.countDocuments()
  const res = await call('/api/users', {
    method: 'POST',
    body: { name: 'New Admin', email: 'new-admin@users.test', role: 'admin', password: PASSWORD },
  })
  assert.equal(res.status, 403, JSON.stringify(res.body))
  assert.equal(await User.countDocuments(), beforeCount)
  assert.equal(await User.countDocuments({ email: 'new-admin@users.test' }), 0)
})

test('a normal admin can still create a service engineer', async () => {
  const res = await call('/api/users', {
    method: 'POST',
    body: { name: 'New Engineer', email: 'new-engineer@users.test', role: 'technician', password: PASSWORD },
  })
  assert.equal(res.status, 201, JSON.stringify(res.body))
  assert.equal(res.body.item.role, 'technician')
})

test('the super admin can create an admin', async () => {
  const res = await call('/api/users', {
    user: 'super',
    method: 'POST',
    body: { name: 'New Admin', email: 'new-admin@users.test', role: 'admin', password: PASSWORD },
  })
  assert.equal(res.status, 201, JSON.stringify(res.body))
  assert.equal(res.body.item.role, 'admin')
  assert.equal(res.body.item.superAdmin, false)
})

test('a normal admin cannot promote a service engineer to admin', async () => {
  const res = await call(`/api/users/${accounts.promote._id}`, {
    method: 'PATCH',
    body: { role: 'admin' },
  })
  assert.equal(res.status, 403, JSON.stringify(res.body))
  assert.equal((await User.findById(accounts.promote._id)).role, 'technician')
})

test('a normal admin cannot edit, deactivate or reset another admin', async () => {
  const res = await call(`/api/users/${accounts.otherAdmin._id}`, {
    method: 'PATCH',
    body: { name: 'Compromised', active: false, password: 'Compromised123!' },
  })
  assert.equal(res.status, 403, JSON.stringify(res.body))

  const target = await User.findById(accounts.otherAdmin._id)
  assert.equal(target.name, 'Other Admin')
  assert.equal(target.active, true)
  const originalPasswordWorks = await new Promise((resolve, reject) => {
    target.authenticate(PASSWORD, (err, result) => (err ? reject(err) : resolve(Boolean(result))))
  })
  assert.equal(originalPasswordWorks, true)
})

test('a normal admin can manage an engineer and the password reset is audited', async () => {
  const newPassword = 'NewEngineer123!'
  const res = await call(`/api/users/${accounts.technician._id}`, {
    method: 'PATCH',
    body: { name: 'Engineer Updated', active: false, password: newPassword },
  })
  assert.equal(res.status, 200, JSON.stringify(res.body))

  const target = await User.findById(accounts.technician._id)
  assert.ok(target, 'deactivation must keep the user document')
  assert.equal(target.name, 'Engineer Updated')
  assert.equal(target.active, false)
  const newPasswordWorks = await new Promise((resolve, reject) => {
    target.authenticate(newPassword, (err, result) => (err ? reject(err) : resolve(Boolean(result))))
  })
  assert.equal(newPasswordWorks, true)

  const audit = await AuditLog.findOne({
    action: 'user_password_reset',
    actor: accounts.admin._id,
    targetId: String(accounts.technician._id),
  }).lean()
  assert.ok(audit, 'password reset must be written to the audit log')
  assert.match(audit.detail, /Password reset/)
  assert.ok(!audit.detail.includes(newPassword), 'audit log must never contain the password')
})

test('the super admin can promote an engineer and deactivate another admin', async () => {
  const promote = await call(`/api/users/${accounts.promote._id}`, {
    user: 'super',
    method: 'PATCH',
    body: { role: 'admin' },
  })
  assert.equal(promote.status, 200, JSON.stringify(promote.body))
  assert.equal((await User.findById(accounts.promote._id)).role, 'admin')

  const deactivate = await call(`/api/users/${accounts.otherAdmin._id}`, {
    user: 'super',
    method: 'PATCH',
    body: { active: false },
  })
  assert.equal(deactivate.status, 200, JSON.stringify(deactivate.body))
  assert.equal((await User.findById(accounts.otherAdmin._id)).active, false)
})

test('a deactivated user is blocked and /auth/me logs the session out', async () => {
  const blocked = await call('/api/users', { user: 'inactive' })
  assert.equal(blocked.status, 401, JSON.stringify(blocked.body))

  const me = await call('/api/auth/me', { user: 'inactive' })
  assert.equal(me.status, 200)
  assert.equal(me.body.user, null)

  const active = await call('/api/auth/me', { user: 'admin' })
  assert.equal(active.status, 200)
  assert.equal(active.body.user.email, 'admin@users.test')
})
