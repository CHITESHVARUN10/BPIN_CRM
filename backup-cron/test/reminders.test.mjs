import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'

const TEST_URI = 'mongodb://127.0.0.1:27017/bpin_reminders_test'
process.env.MONGODB_URI = TEST_URI
process.env.CRON_SECRET = 'reminders-test-secret'

const { sendDailyAssignmentReminders } = await import('../lib/reminders.js')

const TODAY = new Date('2026-10-19T06:30:00.000Z') // 12:00 IST
let techId
let pendingId
let filedId
let yesterdayId
let alreadyRemindedId

before(async () => {
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 10000 })
  await mongoose.connection.dropDatabase()
  const db = mongoose.connection.db

  techId = new mongoose.Types.ObjectId()
  pendingId = new mongoose.Types.ObjectId()
  filedId = new mongoose.Types.ObjectId()
  yesterdayId = new mongoose.Types.ObjectId()
  alreadyRemindedId = new mongoose.Types.ObjectId()

  await db.collection('users').insertOne({
    _id: techId,
    name: 'Engineer One',
    email: 'engineer@reminders.test',
    role: 'technician',
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  const base = {
    assignedTo: techId,
    customerName: 'Test Customer',
    customerPhone: '9999999999',
    address: 'Test address',
    timing: '2:00 PM',
    status: 'pending',
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  await db.collection('assignments').insertMany([
    { ...base, _id: pendingId, visitDate: new Date('2026-10-19T00:00:00.000Z'), serviceRecord: null, lastReminderAt: null },
    { ...base, _id: filedId, visitDate: new Date('2026-10-19T00:00:00.000Z'), serviceRecord: new mongoose.Types.ObjectId(), lastReminderAt: null },
    { ...base, _id: yesterdayId, visitDate: new Date('2026-10-18T00:00:00.000Z'), serviceRecord: null, lastReminderAt: null },
    { ...base, _id: alreadyRemindedId, visitDate: new Date('2026-10-19T00:00:00.000Z'), serviceRecord: null, lastReminderAt: new Date('2026-10-19T00:00:00.000Z') },
  ])
})

after(async () => {
  await mongoose.connection.dropDatabase().catch(() => {})
  await mongoose.disconnect().catch(() => {})
})

test('daily check notifies only today\'s assignments without a linked report', async () => {
  const db = mongoose.connection.db
  const result = await sendDailyAssignmentReminders({ now: TODAY })

  assert.equal(result.sent, 1)
  assert.equal(result.skipped, 0)
  assert.equal(result.checked, 1)

  const notifications = await db.collection('notifications').find({ recipient: techId }).toArray()
  assert.equal(notifications.length, 1)
  assert.match(notifications[0].title, /Assessment report pending/)
  assert.match(notifications[0].body, /Test Customer/)
  assert.equal(notifications[0].type, 'reminder')

  const audit = await db.collection('auditlogs').findOne({ action: 'assignment_report_missing' })
  assert.ok(audit)
  assert.equal(audit.targetKind, 'assignment')
  assert.equal(audit.targetId, String(pendingId))

  const pending = await db.collection('assignments').findOne({ _id: pendingId })
  const filed = await db.collection('assignments').findOne({ _id: filedId })
  const yesterday = await db.collection('assignments').findOne({ _id: yesterdayId })
  const already = await db.collection('assignments').findOne({ _id: alreadyRemindedId })
  assert.ok(pending.lastReminderAt)
  assert.ok(!filed.lastReminderAt)
  assert.ok(!yesterday.lastReminderAt)
  assert.equal(already.lastReminderAt.toISOString(), '2026-10-19T00:00:00.000Z')
})

test('a duplicate invocation does not send another notification', async () => {
  const db = mongoose.connection.db
  const beforeCount = await db.collection('notifications').countDocuments({ recipient: techId })
  const result = await sendDailyAssignmentReminders({ now: TODAY })
  const afterCount = await db.collection('notifications').countDocuments({ recipient: techId })

  assert.equal(result.sent, 0)
  assert.equal(afterCount, beforeCount)
})

test('simultaneous invocations claim each assignment once', async () => {
  const db = mongoose.connection.db
  await db.collection('assignments').updateOne({ _id: pendingId }, { $set: { lastReminderAt: null } })
  await db.collection('notifications').deleteMany({ recipient: techId })
  await db.collection('auditlogs').deleteMany({ action: 'assignment_report_missing' })

  const results = await Promise.all([
    sendDailyAssignmentReminders({ now: TODAY }),
    sendDailyAssignmentReminders({ now: TODAY }),
  ])
  assert.equal(results.reduce((sum, r) => sum + r.sent, 0), 1)
  assert.equal(await db.collection('notifications').countDocuments({ recipient: techId }), 1)
})
