import mongoose from 'mongoose'
import { getEnv } from './env.js'

// Business collections captured by every backup. `sessions` is deliberately
// excluded — it is ephemeral auth state, not business data. The backup_*
// collections that hold this job's own bookkeeping are excluded too.
export const APP_COLLECTIONS = [
  'users',
  'products',
  'problems',
  'servicerecords',
  'assignments',
  'notifications',
  'auditlogs',
  'counters',
]

let indexesReady = null

export async function connect() {
  const { mongoUri } = getEnv()
  if (!mongoUri) throw new Error('MONGODB_URI is not set')
  if (mongoose.connection.readyState !== 1) {
    mongoose.set('strictQuery', true)
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15000, maxPoolSize: 5 })
  }
  const db = mongoose.connection.db
  if (!indexesReady) {
    indexesReady = (async () => {
      await db.collection('backup_runs').createIndex({ status: 1, completedAt: -1 })
      await db.collection('backup_items').createIndex({ runId: 1, status: 1 })
      await db.collection('backup_items').createIndex({ runId: 1, type: 1, key: 1 }, { unique: true })
      await db.collection('backup_lock').createIndex({ expiresAt: 1 })
    })().catch((err) => {
      indexesReady = null
      throw err
    })
  }
  await indexesReady
  return db
}
