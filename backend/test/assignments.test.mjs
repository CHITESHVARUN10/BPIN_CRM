import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import express from 'express'
import mongoose from 'mongoose'

import User from '../models/User.js'
import Product from '../models/Product.js'
import Problem from '../models/Problem.js'
import Assignment from '../models/Assignment.js'
import ServiceRecord from '../models/ServiceRecord.js'
import assignmentsRouter from '../routes/assignments.js'
import recordsRouter from '../routes/records.js'

const TEST_URI = 'mongodb://127.0.0.1:27017/bpin_assignments_test'
const PASSWORD = 'Password123!'

let server
let base
let product
let problem
const accounts = {}
let linkedAssignment
let otherAssignment
let noReportAssignment

async function makeUser(data) {
  const user = new User(data)
  await user.setPassword(PASSWORD)
  await user.save()
  return user
}

async function call(path, { user = 'tech', method = 'GET', body } = {}) {
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

async function fileReport({ user = 'tech', assignmentId, serialNumber = 'SN-1', submissionId } = {}) {
  const res = await fetch(base + '/api/records', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-user': user },
    body: JSON.stringify({
      sku: product.sku,
      serialNumber,
      customerReport: 'Customer reported a fault',
      problemId: String(problem._id),
      visitDate: '2026-10-19',
      ...(assignmentId ? { assignmentId: String(assignmentId) } : {}),
      ...(submissionId ? { submissionId } : {}),
      images: [],
      videos: [],
    }),
  })
  const data = await res.json().catch(() => null)
  return { status: res.status, body: data }
}

async function makeAssignment(assignedTo, overrides = {}) {
  return Assignment.create({
    assignedTo,
    assignedBy: accounts.admin._id,
    customerName: 'Assignment Customer',
    customerPhone: '9999999999',
    address: 'Test address',
    pincode: '400001',
    visitDate: new Date('2026-10-19T00:00:00.000Z'),
    timing: '2:00 PM – 4:00 PM',
    ...overrides,
  })
}

before(async () => {
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 10000 })
  await mongoose.connection.dropDatabase()

  accounts.super = await makeUser({ name: 'Super Admin', email: 'super@assignments.test', role: 'admin', superAdmin: true })
  accounts.admin = await makeUser({ name: 'Admin', email: 'admin@assignments.test', role: 'admin' })
  accounts.tech = await makeUser({ name: 'Engineer', email: 'engineer@assignments.test', role: 'technician' })
  accounts.otherTech = await makeUser({ name: 'Other Engineer', email: 'other@assignments.test', role: 'technician' })

  product = await Product.create({ sku: 'SKU-ASSIGN', description: 'Assignment product', category: 'Unit' })
  problem = await Problem.create({ name: 'Assignment problem' })

  linkedAssignment = await makeAssignment(accounts.tech._id)
  otherAssignment = await makeAssignment(accounts.tech._id, { customerName: 'Other Customer' })
  noReportAssignment = await makeAssignment(accounts.tech._id, { customerName: 'No Report Customer' })

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
  app.use('/api/assignments', assignmentsRouter)
  app.use('/api/records', recordsRouter)
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

test('filing a report from an assignment links and completes it', async () => {
  const res = await fileReport({ assignmentId: linkedAssignment._id, serialNumber: 'SN-LINKED', submissionId: 'submission-linked-1' })
  assert.equal(res.status, 201, JSON.stringify(res.body))

  const record = await ServiceRecord.findOne({ tokenNo: res.body.record.tokenNo })
  assert.ok(record)

  const assignment = await Assignment.findById(linkedAssignment._id)
  assert.equal(String(assignment.serviceRecord), String(record._id))
  assert.equal(assignment.status, 'done')
  assert.ok(assignment.doneAt)

  const adminList = await call('/api/assignments', { user: 'admin' })
  assert.equal(adminList.status, 200)
  const adminItem = adminList.body.items.find((item) => item._id === String(linkedAssignment._id))
  assert.equal(adminItem.reportFiled, true)
  assert.equal(adminItem.serviceRecord.tokenNo, record.tokenNo)

  const myList = await call('/api/assignments/my', { user: 'tech' })
  assert.equal(myList.status, 200)
  const myItem = myList.body.items.find((item) => item._id === String(linkedAssignment._id))
  assert.equal(myItem.reportFiled, true)
})

test('retrying the same submission id returns the existing record', async () => {
  const record = await ServiceRecord.findOne({ submissionId: 'submission-linked-1' })
  const res = await fileReport({
    assignmentId: linkedAssignment._id,
    serialNumber: 'SN-LINKED',
    submissionId: 'submission-linked-1',
  })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.record.tokenNo, record.tokenNo)
  assert.equal(await ServiceRecord.countDocuments({ submissionId: 'submission-linked-1' }), 1)
})

test('the same assignment cannot produce a second linked report', async () => {
  const res = await fileReport({ assignmentId: linkedAssignment._id, serialNumber: 'SN-SECOND' })
  assert.equal(res.status, 400, JSON.stringify(res.body))
  assert.match(res.body.message, /already has a service report/)
})

test('another engineer cannot file a report for someone else\'s assignment', async () => {
  const res = await fileReport({ user: 'otherTech', assignmentId: otherAssignment._id, serialNumber: 'SN-OTHER' })
  assert.equal(res.status, 403, JSON.stringify(res.body))
  const assignment = await Assignment.findById(otherAssignment._id)
  assert.equal(assignment.serviceRecord, null)
})

test('manual status changes cannot bypass the linked report rule', async () => {
  const doneWithoutReport = await call(`/api/assignments/${noReportAssignment._id}/status`, {
    user: 'admin',
    method: 'PATCH',
    body: { status: 'done' },
  })
  assert.equal(doneWithoutReport.status, 400, JSON.stringify(doneWithoutReport.body))

  const reopenLinked = await call(`/api/assignments/${linkedAssignment._id}/status`, {
    user: 'admin',
    method: 'PATCH',
    body: { status: 'pending' },
  })
  assert.equal(reopenLinked.status, 400, JSON.stringify(reopenLinked.body))
})

test('closing a record accepts JSON and is idempotent', async () => {
  const record = await ServiceRecord.findOne({ submissionId: 'submission-linked-1' })
  const body = { workDone: 'Fixed and tested the unit', submissionId: 'close-submission-1' }

  const first = await call(`/api/records/${record._id}/close`, { user: 'tech', method: 'POST', body })
  assert.equal(first.status, 200, JSON.stringify(first.body))
  assert.equal(first.body.record.status, 'closed')

  const replay = await call(`/api/records/${record._id}/close`, { user: 'tech', method: 'POST', body })
  assert.equal(replay.status, 200, JSON.stringify(replay.body))
  assert.equal(replay.body.record.replay, true)
})

test('follow-up accepts JSON and is idempotent', async () => {
  const record = await ServiceRecord.create({
    tokenNo: 'FOLLOW-TEST-1',
    technician: accounts.tech._id,
    productSnapshot: { sku: product.sku, description: product.description },
    serialNumber: 'SN-FOLLOW',
    customerReport: 'Initial report',
    problem: { ref: problem._id, name: problem.name },
    images: [],
  })
  const body = {
    customerReport: 'Follow-up visit completed',
    problemId: String(problem._id),
    notes: 'Checked again',
    submissionId: 'follow-submission-1',
    images: [],
    videos: [],
  }

  const first = await call(`/api/records/${record._id}/follow-up`, { user: 'tech', method: 'POST', body })
  assert.equal(first.status, 200, JSON.stringify(first.body))

  const replay = await call(`/api/records/${record._id}/follow-up`, { user: 'tech', method: 'POST', body })
  assert.equal(replay.status, 200, JSON.stringify(replay.body))
  assert.equal(replay.body.record.replay, true)

  const saved = await ServiceRecord.findById(record._id)
  assert.equal(saved.followUps.length, 1)
  assert.equal(saved.followUps[0].submissionId, 'follow-submission-1')
})
