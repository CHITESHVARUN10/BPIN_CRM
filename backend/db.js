import mongoose from 'mongoose'

let connectPromise = null

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

function maxPoolSize() {
  const value = Number(process.env.MONGO_MAX_POOL_SIZE)
  if (!Number.isFinite(value) || value < 1) return 10
  return Math.min(Math.floor(value), 50)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function connectWithRetry(uri) {
  const attempts = Math.max(1, Number(process.env.MONGODB_CONNECT_RETRIES) || 3)
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
        maxPoolSize: maxPoolSize(),
        minPoolSize: 0,
        autoIndex: true,
      })
      console.log(`[db] connected → ${mongoUriSource()}`)
      return mongoose.connection
    } catch (err) {
      lastError = err
      if (attempt < attempts) {
        await mongoose.disconnect().catch(() => {})
        await sleep(500 * attempt)
        console.warn(`[db] connection attempt ${attempt} failed; retrying`)
      }
    }
  }
  throw lastError
}

export function connectDB() {
  if (mongoose.connection.readyState === 1) return Promise.resolve(mongoose.connection)
  if (connectPromise) return connectPromise

  const uri = mongoUri()
  if (!uri || uri.includes('<user>')) {
    return Promise.reject(new Error('MongoDB connection string is missing. Set MONGODB_URI_NEW (or DB_URL) in backend/.env.'))
  }

  mongoose.set('strictQuery', true)
  connectPromise = connectWithRetry(uri).catch((err) => {
    connectPromise = null
    throw err
  })
  return connectPromise
}
