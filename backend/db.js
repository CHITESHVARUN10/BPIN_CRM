import mongoose from 'mongoose'

export function mongoUri() {
  return (
    process.env.MONGODB_URI_NEW ||
    process.env.DB_URL ||
    'mongodb://127.0.0.1:27017/bpin'
  )
}

export function mongoUriSource() {
  if (process.env.MONGODB_URI_NEW) return 'MONGODB_URI_NEW (company Atlas)'
  if (process.env.DB_URL) return 'DB_URL (local development)'
  return 'local default'
}

export async function connectDB() {
  const uri = mongoUri()
  if (!uri || uri.includes('<user>')) {
    throw new Error('MongoDB connection string is missing. Set MONGODB_URI_NEW (or DB_URL) in backend/.env.')
  }
  mongoose.set('strictQuery', true)
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000, autoIndex: true })
  console.log(`[db] connected → ${mongoUriSource()}`)
}
