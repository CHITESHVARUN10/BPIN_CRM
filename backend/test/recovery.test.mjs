import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mongoose from 'mongoose'

import User from '../models/User.js'
import Product from '../models/Product.js'
import Problem from '../models/Problem.js'
import ServiceRecord from '../models/ServiceRecord.js'
import Counter from '../models/Counter.js'
import { APP_COLLECTIONS, dumpCollectionBuffer, sha256 } from '../recovery/format.js'

// ─────────────────────────────────────────────────────────────────────────────
// Isolated resources only: a throwaway Mongo database, a temp "Drive" mirror
// and a temp Blob mirror. Nothing here ever touches production.
// ─────────────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BACKEND_DIR = path.resolve(__dirname, '..')
const TEST_URI = 'mongodb://127.0.0.1:27017/bpin_recovery_test'
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bpin-recovery-test-'))
const DRIVE_DIR = path.join(TMP_DIR, 'drive')
const BLOB_DIR = path.join(TMP_DIR, 'blob')
const ROOT_NAME = 'BPIN CRM Backups'
const CKPT_NAME = 'bpin-backup-2026-10-01_0300'
const CORRUPT_NAME = 'bpin-backup-2026-09-01_0300'
const BROKEN_NAME = 'bpin-backup-2026-08-01_0300'

const ASSETS = {
  match: { pathname: 'bpin/test/asset-match.jpg', buffer: Buffer.from('MATCH-ASSET-BYTES-'.repeat(40)), contentType: 'image/jpeg' },
  missing: { pathname: 'bpin/test/asset-missing.png', buffer: Buffer.from('MISSING-ASSET-BYTES-'.repeat(40)), contentType: 'image/png' },
  mismatch: { pathname: 'bpin/test/asset-mismatch.webm', buffer: Buffer.from('BACKUP-MISMATCH-BYTES-'.repeat(40)), contentType: 'video/webm' },
  newer: { pathname: 'bpin/test/asset-newer.mp4', buffer: Buffer.from('NEWER-ASSET-BYTES-'.repeat(40)) },
}
const LEGACY_URL = 'https://res.cloudinary.com/demo/image/upload/sample.jpg'
const UNENCODED_MATCH_URL = '/api/files?path=bpin/test/asset-match.jpg'
const CANONICAL_MATCH_URL = `/api/files?path=${encodeURIComponent(ASSETS.match.pathname)}`

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const servers = []

// ── HTTP client with a cookie jar ───────────────────────────────────────────

class Client {
  constructor(base) {
    this.base = base
    this.cookie = ''
  }

  async req(pathname, { method = 'GET', body } = {}) {
    const headers = {}
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (this.cookie) headers.cookie = this.cookie
    const res = await fetch(this.base + pathname, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
    const raw = setCookies[0] || res.headers.get('set-cookie')
    if (raw) {
      const first = raw.split(';')[0]
      if (first && !first.endsWith('=')) this.cookie = first
    }
    const text = await res.text()
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = text
    }
    return { status: res.status, body: parsed }
  }
}

async function login(base, email, password) {
  const client = new Client(base)
  const res = await client.req('/api/auth/login', { method: 'POST', body: { email, password } })
  assert.equal(res.status, 200, `login failed for ${email}: ${JSON.stringify(res.body)}`)
  return client
}

async function reauth(client, password) {
  return client.req('/api/recovery/reauth', { method: 'POST', body: { password } })
}

const TERMINAL = ['completed', 'partial_failure', 'rolled_back', 'failed', 'manual_intervention_required']

async function pollOperation(client, operationId, timeoutMs = 120000) {
  const started = Date.now()
  let last = null
  while (Date.now() - started < timeoutMs) {
    const res = await client.req(`/api/recovery/operations/${operationId}`)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    last = res.body.operation
    if (TERMINAL.includes(last.status)) return last
    await sleep(250)
  }
  throw new Error(`operation ${operationId} did not finish: ${JSON.stringify(last)}`)
}

async function runOperation(client, { checkpointId, mode }) {
  const started = await client.req('/api/recovery/operations', {
    method: 'POST',
    body: { checkpointId, mode, confirmation: 'RESTORE BPIN CRM', acknowledge: true },
  })
  assert.equal(started.status, 202, JSON.stringify(started.body))
  return pollOperation(client, started.body.operationId)
}

// ── Fixtures ────────────────────────────────────────────────────────────────

async function spawnServer(port, faults = '') {
  const child = spawn(process.execPath, ['index.js'], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      MONGODB_URI_NEW: TEST_URI,
      DB_URL: TEST_URI,
      SESSION_SECRET: 'recovery-test-secret',
      NODE_ENV: 'test',
      COOKIE_SAMESITE: 'lax',
      CLIENT_ORIGINS: '',
      DRIVE_LOCAL_DIR: DRIVE_DIR,
      BLOB_LOCAL_DIR: BLOB_DIR,
      DRIVE_ROOT_FOLDER_NAME: ROOT_NAME,
      RECOVERY_SESSION_TTL_MINUTES: '15',
      RECOVERY_TEST_FAULTS: faults,
      GOOGLE_SERVICE_ACCOUNT_JSON: '',
      SHARED_DRIVE_ID: '',
      SHARED_DRIVE_NAME: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  child.stdout.on('data', (chunk) => { log += chunk })
  child.stderr.on('data', (chunk) => { log += chunk })
  servers.push(child)

  const base = `http://127.0.0.1:${port}`
  const started = Date.now()
  while (Date.now() - started < 30000) {
    if (child.exitCode !== null) throw new Error(`server ${port} exited early:\n${log}`)
    try {
      const res = await fetch(`${base}/api/health`)
      if (res.ok) return { base, child, log: () => log }
    } catch {
      // not listening yet
    }
    await sleep(200)
  }
  throw new Error(`server ${port} did not become healthy:\n${log}`)
}

async function seedCheckpointState() {
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 10000 })
  await mongoose.connection.db.dropDatabase()

  const super1 = await User.register(new User({ name: 'Super One', email: 'super1@test.local', role: 'admin', superAdmin: true }), 'Super@123')
  const super2 = await User.register(new User({ name: 'Super Two', email: 'super2@test.local', role: 'admin', superAdmin: true }), 'Super@123')
  await User.register(new User({ name: 'Staff Admin', email: 'staff@test.local', role: 'admin' }), 'Admin@123')
  const tech = await User.register(new User({ name: 'Tech One', email: 'tech@test.local', role: 'technician' }), 'Tech@123')

  await Product.create([
    { sku: 'SKU-1', description: 'Product one', category: 'Unit' },
    { sku: 'SKU-2', description: 'Product two', category: 'Unit' },
    { sku: 'SKU-3', description: 'Product three', category: 'Unit' },
  ])
  await Problem.create([{ name: 'Problem A' }, { name: 'Problem B' }])
  await Counter.create({ _id: '01102026', seq: 1 })

  await ServiceRecord.create({
    tokenNo: '01102026-0001',
    technician: tech._id,
    productSnapshot: { sku: 'SKU-1', description: 'Product one', category: 'Unit' },
    serialNumber: 'SN-TEST-1',
    customerReport: 'Test report',
    problem: { name: 'Problem A', isOther: false },
    images: [
      { url: UNENCODED_MATCH_URL, publicId: ASSETS.match.pathname, kind: 'image', contentType: 'image/jpeg' },
      { url: `/api/files?path=${encodeURIComponent(ASSETS.missing.pathname)}`, publicId: ASSETS.missing.pathname, kind: 'image', contentType: 'image/png' },
      { url: `/api/files?path=${encodeURIComponent(ASSETS.mismatch.pathname)}`, publicId: ASSETS.mismatch.pathname, kind: 'video', contentType: 'video/webm' },
      { url: LEGACY_URL, publicId: 'demo/sample', kind: 'image' },
    ],
    visitDate: new Date('2026-10-01T09:00:00Z'),
  })

  return { super1, super2 }
}

async function buildCheckpoint(folderName, { corruptSha = false } = {}) {
  const db = mongoose.connection.db
  const folder = path.join(DRIVE_DIR, ROOT_NAME, folderName)
  const dbDir = path.join(folder, 'db')
  const mediaDir = path.join(folder, 'media')
  fs.mkdirSync(dbDir, { recursive: true })
  fs.mkdirSync(mediaDir, { recursive: true })

  const collections = []
  for (const name of APP_COLLECTIONS) {
    const dump = await dumpCollectionBuffer(db, name)
    fs.writeFileSync(path.join(dbDir, `${name}.ndjson.gz`), dump.buffer)
    collections.push({
      name,
      file: `db/${name}.ndjson.gz`,
      docs: dump.docs,
      bytes: dump.bytes,
      sha256: corruptSha && collections.length === 0 ? '0'.repeat(64) : dump.sha256,
      status: 'done',
    })
  }

  const mediaFiles = []
  for (const asset of [ASSETS.match, ASSETS.missing, ASSETS.mismatch]) {
    const target = path.join(mediaDir, asset.pathname)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, asset.buffer)
    mediaFiles.push({
      pathname: asset.pathname,
      file: `media/${asset.pathname}`,
      url: `/api/files?path=${encodeURIComponent(asset.pathname)}`,
      contentType: asset.contentType,
      storeSize: asset.buffer.length,
      storeUploadedAt: new Date().toISOString(),
      bytes: asset.buffer.length,
      sha256: sha256(asset.buffer),
      driveFileId: null,
      referenced: true,
      refs: [{ recordId: 'fixture', tokenNo: '01102026-0001', section: 'images' }],
    })
  }

  const manifest = {
    version: 1,
    kind: 'bpin-crm-backup',
    runId: folderName,
    status: 'completed',
    startedAt: '2026-10-01T03:00:00.000Z',
    cutoffAt: '2026-10-01T03:00:00.000Z',
    completedAt: '2026-10-01T03:02:00.000Z',
    retention: { keep: 2 },
    db: {
      database: 'BPIN (MongoDB Atlas)',
      collections,
    },
    media: {
      store: 'vercel-blob (private)',
      files: mediaFiles,
      totals: { files: mediaFiles.length, bytes: mediaFiles.reduce((a, f) => a + f.bytes, 0) },
    },
    checks: {
      items: collections.length + mediaFiles.length,
      done: collections.length + mediaFiles.length,
      failed: 0,
      dbDocs: collections.reduce((a, c) => a + c.docs, 0),
    },
  }
  fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify(manifest, null, 2))
  return { folder, manifest }
}

function seedBlobMirror() {
  const write = (asset, buffer) => {
    const target = path.join(BLOB_DIR, asset.pathname)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, buffer)
  }
  write(ASSETS.match, ASSETS.match.buffer)
  write(ASSETS.mismatch, Buffer.from('CORRUPTED-CURRENT-BYTES'))
  write(ASSETS.newer, ASSETS.newer.buffer)
  // ASSETS.missing intentionally absent
}

async function mutateLiveDatabase() {
  const db = mongoose.connection.db
  await Product.deleteOne({ sku: 'SKU-2' })
  await Problem.updateOne({ name: 'Problem A' }, { $set: { name: 'Problem A changed' } })
  await Counter.updateOne({ _id: '01102026' }, { $set: { seq: 9 } })
  const tech = await User.findOne({ email: 'tech@test.local' })
  await ServiceRecord.create({
    tokenNo: '01102026-9999',
    technician: tech._id,
    productSnapshot: { sku: 'SKU-3', description: 'Product three', category: 'Unit' },
    serialNumber: 'SN-NEWER',
    customerReport: 'Newer record created after the checkpoint',
    problem: { name: 'Problem B', isOther: false },
    images: [{ url: `/api/files?path=${encodeURIComponent(ASSETS.newer.pathname)}`, publicId: ASSETS.newer.pathname, kind: 'video' }],
    visitDate: new Date('2026-10-02T09:00:00Z'),
  })
}

function walkFiles(dir, prefix = '') {
  const out = {}
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) Object.assign(out, walkFiles(full, rel))
    else out[rel] = sha256(fs.readFileSync(full))
  }
  return out
}

// Audit logs are excluded from the comparison: recovery events are mirrored
// there by design, so the collection legitimately grows during operations.
const BUSINESS_COLLECTIONS = APP_COLLECTIONS.filter((name) => name !== 'auditlogs')

async function dbCounts() {
  const db = mongoose.connection.db
  const out = {}
  for (const name of BUSINESS_COLLECTIONS) out[name] = await db.collection(name).countDocuments({})
  return out
}

let serverA
let baseA
let clientSuper
let ckptId
let corruptId

before(async () => {
  fs.mkdirSync(path.join(DRIVE_DIR, ROOT_NAME), { recursive: true })
  const { super1 } = await seedCheckpointState()
  assert.ok(super1)

  const built = await buildCheckpoint(CKPT_NAME)
  await buildCheckpoint(CORRUPT_NAME, { corruptSha: true })
  fs.mkdirSync(path.join(DRIVE_DIR, ROOT_NAME, BROKEN_NAME), { recursive: true })

  seedBlobMirror()
  await mutateLiveDatabase()

  const server = await spawnServer(5101)
  serverA = server
  baseA = server.base
  clientSuper = await login(baseA, 'super1@test.local', 'Super@123')
})

after(async () => {
  for (const child of servers) {
    try {
      child.kill('SIGKILL')
    } catch {
      // already gone
    }
  }
  await mongoose.disconnect().catch(() => {})
  fs.rmSync(TMP_DIR, { recursive: true, force: true })
})

// ── Tests ───────────────────────────────────────────────────────────────────

test('1-3. unauthenticated, technician and ordinary admin are refused', async () => {
  const anon = new Client(baseA)
  assert.equal((await anon.req('/api/recovery/checkpoints')).status, 401)
  assert.equal((await anon.req('/api/recovery/reauth', { method: 'POST', body: { password: 'x' } })).status, 401)
  assert.equal((await anon.req('/api/recovery/operations')).status, 401)

  const tech = await login(baseA, 'tech@test.local', 'Tech@123')
  assert.equal((await tech.req('/api/recovery/checkpoints')).status, 403)
  assert.equal((await reauth(tech, 'Tech@123')).status, 403)

  const staff = await login(baseA, 'staff@test.local', 'Admin@123')
  assert.equal((await staff.req('/api/recovery/checkpoints')).status, 403)
  assert.equal((await staff.req('/api/recovery/operations')).status, 403)
})

test('4. super admin needs re-authentication before any recovery data', async () => {
  const res = await clientSuper.req('/api/recovery/checkpoints')
  assert.equal(res.status, 403)
  assert.equal(res.body.code, 'recovery_auth_required')

  const dry = await clientSuper.req('/api/recovery/dry-run', { method: 'POST', body: { checkpointId: 'x', mode: 'db' } })
  assert.equal(dry.status, 403)
  assert.equal(dry.body.code, 'recovery_auth_required')
})

test('5. wrong passwords are rejected and rate-limited', async () => {
  const wrong = await reauth(clientSuper, 'not-the-password')
  assert.equal(wrong.status, 400)

  const super2 = await login(baseA, 'super2@test.local', 'Super@123')
  for (let i = 0; i < 5; i++) {
    const res = await reauth(super2, 'wrong-password')
    assert.equal(res.status, 400, `attempt ${i + 1} should be 400`)
  }
  const limited = await reauth(super2, 'Super@123')
  assert.equal(limited.status, 429)

  const ok = await reauth(clientSuper, 'Super@123')
  assert.equal(ok.status, 200)
  assert.equal(ok.body.authenticated, true)
})

test('6. inventory lists valid, corrupt and unusable checkpoints', async () => {
  const res = await clientSuper.req('/api/recovery/checkpoints')
  assert.equal(res.status, 200)
  const items = res.body.items
  const valid = items.find((c) => c.name === CKPT_NAME)
  const corrupt = items.find((c) => c.name === CORRUPT_NAME)
  const broken = items.find((c) => c.name === BROKEN_NAME)
  assert.ok(valid && corrupt && broken)
  ckptId = valid.id
  corruptId = corrupt.id

  assert.equal(valid.valid, true)
  assert.equal(valid.db.valid, true)
  assert.equal(valid.media.files, 3)
  assert.equal(valid.restorable.both, true)

  assert.equal(broken.valid, false)
  assert.ok(broken.errors.length > 0)
  assert.equal(corrupt.db.valid, true) // structural inventory check passes; content is verified in dry-run
})

test('7. a corrupt checkpoint cannot be restored', async () => {
  const dry = await clientSuper.req('/api/recovery/dry-run', { method: 'POST', body: { checkpointId: corruptId, mode: 'db' } })
  assert.equal(dry.status, 200)
  assert.equal(dry.body.plan.canProceed, false)
  assert.ok(dry.body.plan.errors.some((e) => /checksum/i.test(e)))

  const before = await dbCounts()
  const op = await runOperation(clientSuper, { checkpointId: corruptId, mode: 'db' })
  assert.equal(op.status, 'failed')
  assert.deepEqual(await dbCounts(), before)
})

test('8. database-only restore rolls back the DB, leaves blobs untouched, warns about missing media', async () => {
  const blobBefore = walkFiles(BLOB_DIR)
  const dry = await clientSuper.req('/api/recovery/dry-run', { method: 'POST', body: { checkpointId: ckptId, mode: 'db' } })
  assert.equal(dry.status, 200)
  assert.equal(dry.body.plan.canProceed, true)
  assert.ok(dry.body.plan.db.collections.length === APP_COLLECTIONS.length)

  const op = await runOperation(clientSuper, { checkpointId: ckptId, mode: 'db' })
  assert.equal(op.status, 'completed', JSON.stringify(op.errors))

  const counts = await dbCounts()
  assert.equal(counts.products, 3, 'deleted products are restored')
  assert.equal(counts.servicerecords, 1, 'records created after the checkpoint are gone')
  assert.equal(await Product.countDocuments({ sku: 'SKU-2' }), 1)
  assert.equal(await Problem.countDocuments({ name: 'Problem A' }), 1)
  assert.equal(await Problem.countDocuments({ name: 'Problem A changed' }), 0)
  assert.equal((await Counter.findById('01102026'))?.seq, 1)

  assert.deepEqual(walkFiles(BLOB_DIR), blobBefore, 'mode A must not modify blob storage')

  const missing = op.result.refs.missing.map((m) => m.pathname)
  assert.ok(missing.includes(ASSETS.missing.pathname))
  assert.ok(!missing.includes(ASSETS.match.pathname))
  assert.ok(op.verification.refs.missing.length >= 1)
})

test('9-12, 19. assets-only restore fixes media, never touches the DB, and keeps newer assets', async () => {
  const countsBefore = await dbCounts()
  const newerBefore = sha256(fs.readFileSync(path.join(BLOB_DIR, ASSETS.newer.pathname)))
  const matchBefore = sha256(fs.readFileSync(path.join(BLOB_DIR, ASSETS.match.pathname)))

  const op = await runOperation(clientSuper, { checkpointId: ckptId, mode: 'assets' })
  assert.equal(op.status, 'completed', JSON.stringify(op.errors))
  assert.deepEqual(await dbCounts(), countsBefore, 'mode B must not modify MongoDB')

  const missingPath = path.join(BLOB_DIR, ASSETS.missing.pathname)
  assert.ok(fs.existsSync(missingPath), 'missing asset restored')
  assert.equal(sha256(fs.readFileSync(missingPath)), sha256(ASSETS.missing.buffer))

  assert.equal(sha256(fs.readFileSync(path.join(BLOB_DIR, ASSETS.match.pathname))), matchBefore, 'matching asset reused untouched')

  const mismatchPath = path.join(BLOB_DIR, ASSETS.mismatch.pathname)
  assert.equal(sha256(fs.readFileSync(mismatchPath)), sha256(ASSETS.mismatch.buffer), 'mismatched asset replaced with backup bytes')

  assert.equal(sha256(fs.readFileSync(path.join(BLOB_DIR, ASSETS.newer.pathname))), newerBefore, 'newer asset untouched')

  assert.ok(op.result.assets.reused >= 1)
  assert.ok(op.result.assets.restored >= 1)
  assert.ok(op.result.assets.replaced >= 1)
  assert.equal(op.result.assets.failed.length, 0)
})

test('10-12. combined restore reconciles references and verifies everything', async () => {
  const op = await runOperation(clientSuper, { checkpointId: ckptId, mode: 'both' })
  assert.equal(op.status, 'completed', JSON.stringify(op.errors))
  assert.equal(op.result.assets.failed.length, 0)
  assert.equal(op.verification.refs.passed, true)
  assert.equal(op.verification.refs.missing.length, 0)
  assert.ok(op.verification.assets.required >= 3)
  assert.equal(op.verification.assets.available, op.verification.assets.required)

  const record = await ServiceRecord.findOne({ tokenNo: '01102026-0001' }).lean()
  assert.ok(record)
  assert.equal(record.images[0].url, CANONICAL_MATCH_URL, 'non-canonical URL repaired')
  assert.equal(record.images[3].url, LEGACY_URL, 'legacy Cloudinary reference left untouched')
})

test('17. concurrent restore attempts are blocked by the lock', async () => {
  const db = mongoose.connection.db
  await db.collection('recovery_lock').updateOne(
    { _id: 'restore' },
    { $set: { holder: 'another-restore', expiresAt: new Date(Date.now() + 5 * 60 * 1000), updatedAt: new Date() } },
    { upsert: true },
  )
  const blocked = await clientSuper.req('/api/recovery/operations', {
    method: 'POST',
    body: { checkpointId: ckptId, mode: 'db', confirmation: 'RESTORE BPIN CRM', acknowledge: true },
  })
  assert.equal(blocked.status, 409, JSON.stringify(blocked.body))

  await db.collection('recovery_lock').deleteOne({ _id: 'restore', holder: 'another-restore' })
  const allowed = await clientSuper.req('/api/recovery/operations', {
    method: 'POST',
    body: { checkpointId: ckptId, mode: 'db', confirmation: 'RESTORE BPIN CRM', acknowledge: true },
  })
  assert.equal(allowed.status, 202, JSON.stringify(allowed.body))
  const op = await pollOperation(clientSuper, allowed.body.operationId)
  assert.equal(op.status, 'completed')
})

test('18. interrupted operations are detected and marked for manual intervention', async () => {
  const db = mongoose.connection.db
  const { insertedId } = await db.collection('recovery_operations').insertOne({
    status: 'restoring_database',
    mode: 'db',
    phase: 'Restoring database',
    progress: 50,
    checkpoint: { id: 'fixture', name: CKPT_NAME },
    steps: [],
    warnings: [],
    errors: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    heartbeatAt: new Date(Date.now() - 10 * 60 * 1000),
  })

  const list = await clientSuper.req('/api/recovery/operations')
  assert.equal(list.status, 200)
  const stale = list.body.items.find((o) => o.id === String(insertedId))
  assert.ok(stale)
  assert.equal(stale.status, 'manual_intervention_required')

  const one = await clientSuper.req(`/api/recovery/operations/${insertedId}`)
  assert.equal(one.body.operation.status, 'manual_intervention_required')
})

test('20. privileged actions are recorded in the durable recovery audit', async () => {
  const db = mongoose.connection.db
  const actions = ['reauth_success', 'reauth_failed', 'reauth_rate_limited', 'access_denied', 'dry_run', 'restore_requested', 'restore_completed']
  for (const action of actions) {
    assert.ok((await db.collection('recovery_events').countDocuments({ action })) >= 1, `missing recovery event: ${action}`)
  }
  const completed = await db.collection('recovery_events').findOne({ action: 'restore_completed' })
  assert.ok(completed.actor?.email === 'super1@test.local')
  assert.ok(completed.operationId)
})

test('14. a failure after production changes triggers a verified rollback', async () => {
  const marker = await Product.create({ sku: 'MARKER-ROLLBACK', description: 'Marker product', category: 'Unit' })
  const countsBefore = await dbCounts()

  const faultServer = await spawnServer(5102, 'fail_after_first_db_collection')
  try {
    const client = await login(faultServer.base, 'super1@test.local', 'Super@123')
    const auth = await reauth(client, 'Super@123')
    assert.equal(auth.status, 200)

    const op = await runOperation(client, { checkpointId: ckptId, mode: 'db' })
    assert.equal(op.status, 'rolled_back', JSON.stringify({ errors: op.errors, lastError: op.lastError }))
    assert.equal(op.rollback?.attempted, true)

    assert.deepEqual(await dbCounts(), countsBefore, 'rollback restores the pre-restore state')
    assert.ok(await Product.findById(marker._id), 'records created before the restore survive the rollback')
  } finally {
    faultServer.child.kill('SIGKILL')
  }
})

test('15. asset restore failures are reported as a partial failure', async () => {
  // Make one asset genuinely need restoring so the injected asset fault triggers.
  fs.rmSync(path.join(BLOB_DIR, ASSETS.missing.pathname), { force: true })
  const countsBefore = await dbCounts()
  const faultServer = await spawnServer(5104, 'fail_assets_all')
  try {
    const client = await login(faultServer.base, 'super1@test.local', 'Super@123')
    await reauth(client, 'Super@123')
    const op = await runOperation(client, { checkpointId: ckptId, mode: 'assets' })
    assert.equal(op.status, 'partial_failure')
    assert.ok(op.result.assets.failed.length >= 1)
    assert.deepEqual(await dbCounts(), countsBefore, 'database is never touched by mode B')
  } finally {
    faultServer.child.kill('SIGKILL')
  }
})

test('16. a failed rollback requires manual intervention', async () => {
  const faultServer = await spawnServer(5103, 'fail_after_first_db_collection,fail_rollback')
  try {
    const client = await login(faultServer.base, 'super1@test.local', 'Super@123')
    await reauth(client, 'Super@123')
    const op = await runOperation(client, { checkpointId: ckptId, mode: 'db' })
    assert.equal(op.status, 'manual_intervention_required', JSON.stringify({ lastError: op.lastError }))
    assert.equal(op.rollback?.status, 'failed')
    assert.ok(op.rollback?.error)
  } finally {
    faultServer.child.kill('SIGKILL')
  }
})
