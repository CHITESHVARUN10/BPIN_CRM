import 'dotenv/config'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import XLSX from 'xlsx'
import mongoose from 'mongoose'
import { connectDB } from '../db.js'
import User from '../models/User.js'
import Product from '../models/Product.js'
import Problem from '../models/Problem.js'

// Never hardcode seed passwords — if the env var is missing, fall back to a
// random value that is printed ONCE in the console of the seeding run.
const fallbackAdminPassword = crypto.randomBytes(12).toString('base64url')
const fallbackTechPassword = crypto.randomBytes(12).toString('base64url')
let adminFallbackUsed = false
let techFallbackUsed = false
const adminPassword = () => {
  const value = process.env.ADMIN_PASSWORD
  if (!value) adminFallbackUsed = true
  return value || fallbackAdminPassword
}
const techPassword = () => {
  const value = process.env.TECH_DEFAULT_PASSWORD
  if (!value) techFallbackUsed = true
  return value || fallbackTechPassword
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const CSV_DIR = path.resolve(ROOT, '..', 'csvs')

const CURATED_PROBLEMS = [
  'No Sound', 'Touch Not Working', 'Display Faulty', 'Camera Faulty', 'Camera Blur',
  'Camera Not Working', 'Reverse Camera Not Working', 'No Signal', 'No Power', 'Hang On Logo',
  'WiFi Not Working', 'LED Faulty', 'LED Not Working', 'Mic Faulty', 'Hanging Issue',
  'Battery Drain Issue', 'SD Card Slot', 'SD Port Not Working', 'Canbus Faulty', 'No Defect Found',
  'Software Update', 'MAIN PCB Faulty', 'Replace From Float', 'Buttons Not Working', 'Motor Not Working',
]

function readRows(file, options = {}) {
  const workbook = XLSX.readFile(file, { cellDates: true })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  return XLSX.utils.sheet_to_json(sheet, options)
}

async function seedProducts() {
  const rows = readRows(path.join(CSV_DIR, 'BPIN Product Listing.xlsx'))
  const seen = new Map()
  for (const row of rows) {
    const sku = String(row['SKU Code'] ?? '').trim()
    const description = String(row['Descript'] ?? '').trim()
    const category = String(row['Category'] ?? '').trim() || 'Others'
    if (!sku || !description || seen.has(sku)) continue
    seen.set(sku, { description, category })
  }
  const entries = [...seen.entries()]
  for (let i = 0; i < entries.length; i += 500) {
    const chunk = entries.slice(i, i + 500).map(([sku, val]) => ({
      updateOne: { filter: { sku }, update: { $set: val }, upsert: true },
    }))
    await Product.bulkWrite(chunk, { ordered: false })
  }
  return entries.length
}

async function seedEngineers() {
  const rows = readRows(path.join(CSV_DIR, 'BASC Service Enginner Details.xlsx'), { header: 1, defval: '' })
  const headerIdx = rows.findIndex((cells) => cells.includes('Name'))
  if (headerIdx < 0) throw new Error('Could not find engineer header row')
  const heads = rows[headerIdx].map((h) => String(h))
  const col = (probe) => heads.findIndex((h) => h.includes(probe))
  const nameCol = col('Name')
  const phoneCol = col('Contact')
  const emailCol = col('Mail')
  const regionCol = col('Region')

  let created = 0
  for (const cells of rows.slice(headerIdx + 1)) {
    const name = String(cells[nameCol] ?? '').trim()
    const email = String(cells[emailCol] ?? '').trim().toLowerCase()
    const phone = String(cells[phoneCol] ?? '').trim()
    const region = String(cells[regionCol] ?? '').trim()
    if (!name || !email.includes('@')) continue

    const existing = await User.findOne({ email }).lean()
    if (existing) {
      await User.updateOne({ _id: existing._id }, { $set: { name, phone, region } })
      continue
    }
    const user = new User({ name, email, phone, region, role: 'technician' })
    await user.setPassword(techPassword())
    await user.save()
    created++
  }
  return created
}

// Super-admin rights are NEVER granted or revoked by this seed. They are read
// only from the `superAdmin` flag already stored in MongoDB.
async function seedProblems() {
  const names = new Set(CURATED_PROBLEMS.map((n) => n.trim()))
  try {
    const rows = readRows(path.join(CSV_DIR, 'CRM Warranty Report.xlsx'))
    for (const row of rows) {
      const value = String(row['Complaint'] ?? '').trim()
      if (value && value.toUpperCase() !== 'NA') names.add(value)
    }
  } catch {
    // warranty file is optional for the problem list
  }
  await Problem.bulkWrite(
    [...names].filter(Boolean).map((name) => ({
      updateOne: { filter: { name }, update: { $set: { name, archived: false } }, upsert: true },
    })),
    { ordered: false },
  )
  return names.size
}

const ADMIN_ACCOUNTS = [
  { name: 'Riyaz', email: 'riyaz.tamboli@blaupunktcar.in', phone: '9930310905' },
  { name: 'Sakir', email: 'sakir.hussain@blaupunktcar.in', phone: '9930310904' },
  { name: 'Murugesh', email: 'murugesh.palanidurai@blaupunktcar.in', phone: '9930310901' },
  { name: 'Kailash', email: 'kailash.rewale@blaupunktcar.in', phone: '9870125046' },
  { name: 'Subhash', email: 'subhash.rajaiah@blaupunktcar.in', phone: '9821516832' },
  { name: 'Pankaj Sir', email: 'pankaj.jagwani@blaupunktcar.in', phone: '9821031712' },
  { name: 'Kiran', email: 'kiran.mehetre@blaupunktcar.in', phone: '9967417504' },
]

async function seedStaffAdmins() {
  const password = adminPassword()
  let created = 0
  for (const account of ADMIN_ACCOUNTS) {
    const email = account.email.toLowerCase()
    const existing = await User.findOne({ email }).lean()
    if (existing) {
      const patch = {}
      if (existing.role !== 'admin') patch.role = 'admin'
      if (existing.name !== account.name) patch.name = account.name
      if (existing.phone !== account.phone) patch.phone = account.phone
      // Never touch superAdmin here — it is managed directly in MongoDB.
      if (Object.keys(patch).length) await User.updateOne({ _id: existing._id }, { $set: patch })
      continue
    }
    const admin = new User({ name: account.name, email, phone: account.phone, role: 'admin', active: true })
    await admin.setPassword(password)
    await admin.save()
    created++
  }
  return created
}

async function main() {
  try {
    await connectDB()
    const products = await seedProducts()
    const techsCreated = await seedEngineers()
    const problems = await seedProblems()
    const staffAdminsCreated = await seedStaffAdmins()
    console.log({
      products,
      technicians: { created: techsCreated, total: await count(User, 'technician') },
      admins: { staffCreated: staffAdminsCreated, total: await count(User, 'admin') },
      problems,
    })
    if (adminFallbackUsed) console.log(`ADMIN_PASSWORD was not set — used one-off password for admins: ${fallbackAdminPassword}`)
    if (techFallbackUsed) console.log(`TECH_DEFAULT_PASSWORD was not set — used one-off password for engineers: ${fallbackTechPassword}`)
    await mongoose.disconnect()
    console.log('Seed complete')
  } catch (err) {
    console.error(`[seed] ${err.message}`)
    console.error('Check backend/.env DB_URL and the csvs/ folder, then try again.')
    try { await mongoose.disconnect() } catch { /* ignore */ }
    process.exit(1)
  }

  function count(model, role) {
    return model.countDocuments(role ? { role } : {})
  }
}

main()
