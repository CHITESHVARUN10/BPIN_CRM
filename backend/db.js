import mongoose from 'mongoose'

export function mongoUri() {
  return (
    process.env.mongo_uri_txt ||
    process.env.MONGO_URI_DEPLOY ||
    process.env.DB_URL ||
    'mongodb://127.0.0.1:27017/bpin'
  )
}

export async function connectDB() {
  const uri = mongoUri()
  if (!uri || uri.includes('<user>')) {
    throw new Error('MongoDB connection string is missing. Set mongo_uri_txt (or DB_URL) in backend/.env.')
  }
  mongoose.set('strictQuery', true)
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000, autoIndex: true })
}
