import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { google } from 'googleapis'

// Read-only Drive access for checkpoints, plus snapshot writes under
// pre-restore/. Two implementations behind one interface:
//   GoogleDrive (service account → Workspace Shared Drive)
//   LocalDrive  (DRIVE_LOCAL_DIR mirror, used by tests and local drills)

const escapeQuery = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")

export const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder'

function serviceAccountRaw() {
  const direct =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    process.env.SERVICE_ACCOUNT_JSON ||
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY ||
    ''
  if (direct) return direct
  const candidates = [process.env.GOOGLE_SERVICE_ACCOUNT_FILE, path.join(process.cwd(), 'service-account.json')].filter(Boolean)
  for (const candidate of candidates) {
    try {
      return fs.readFileSync(candidate, 'utf8')
    } catch {
      // try next
    }
  }
  return ''
}

function parseServiceAccount(raw) {
  const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')
  const sa = JSON.parse(text)
  if (!sa.client_email || !sa.private_key) throw new Error('Service-account key is not valid')
  return sa
}

export function driveConfigured() {
  if (process.env.DRIVE_LOCAL_DIR) return true
  const hasKey = Boolean(serviceAccountRaw())
  const hasDrive = Boolean(process.env.SHARED_DRIVE_ID || process.env.SHARED_DRIVE_NAME || process.env.GOOGLE_SHARED_DRIVE_ID)
  return hasKey && hasDrive
}

export function driveNotConfiguredMessage() {
  if (process.env.DRIVE_LOCAL_DIR) return null
  if (!serviceAccountRaw()) {
    return 'Google Drive is not configured: set GOOGLE_SERVICE_ACCOUNT_JSON (or GOOGLE_SERVICE_ACCOUNT_FILE) on the backend.'
  }
  if (!process.env.SHARED_DRIVE_ID && !process.env.SHARED_DRIVE_NAME) {
    return 'Google Drive is not configured: set SHARED_DRIVE_ID and/or SHARED_DRIVE_NAME on the backend.'
  }
  return null
}

class GoogleDrive {
  constructor({ serviceAccountJson, sharedDriveId, sharedDriveName, rootFolderName }) {
    const credentials = parseServiceAccount(serviceAccountJson)
    const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/drive'] })
    this.drive = google.drive({ version: 'v3', auth })
    this.saEmail = credentials.client_email
    this.sharedDriveId = sharedDriveId
    this.sharedDriveName = sharedDriveName
    this.rootFolderName = rootFolderName
    this.resolvedDriveId = null
    this.rootFolderId = null
    this.cache = new Map()
  }

  async resolveSharedDrive() {
    if (this.resolvedDriveId) return this.resolvedDriveId
    if (this.sharedDriveId) {
      let data
      try {
        const res = await this.drive.drives.get({ driveId: this.sharedDriveId, fields: 'id,name' })
        data = res.data
      } catch (err) {
        throw new Error(
          `Cannot access Shared Drive ${this.sharedDriveId} as ${this.saEmail}. Add this service account as a Content manager of the Shared Drive. [${err.message}]`,
        )
      }
      if (this.sharedDriveName && data.name && data.name !== this.sharedDriveName) {
        throw new Error(`SHARED_DRIVE_ID points at "${data.name}" but SHARED_DRIVE_NAME is "${this.sharedDriveName}"`)
      }
      this.resolvedDriveId = data.id
      return this.resolvedDriveId
    }
    if (this.sharedDriveName) {
      const res = await this.drive.drives.list({ q: `name = '${escapeQuery(this.sharedDriveName)}'`, fields: 'drives(id,name)' })
      const match = (res.data.drives || []).find((d) => d.name === this.sharedDriveName)
      if (!match) throw new Error(`Shared drive "${this.sharedDriveName}" not found for ${this.saEmail} — is the service account a member?`)
      this.resolvedDriveId = match.id
      return this.resolvedDriveId
    }
    throw new Error('Set SHARED_DRIVE_ID or SHARED_DRIVE_NAME')
  }

  async ensureRootFolder() {
    if (this.rootFolderId) return this.rootFolderId
    const driveId = await this.resolveSharedDrive()
    const q = `name = '${escapeQuery(this.rootFolderName)}' and '${escapeQuery(driveId)}' in parents and mimeType = '${DRIVE_FOLDER_MIME}' and trashed = false`
    const found = await this.drive.files.list({ q, supportsAllDrives: true, includeItemsFromAllDrives: true, fields: 'files(id,name)' })
    const existing = found.data.files?.[0]
    if (existing) {
      this.rootFolderId = existing.id
      return this.rootFolderId
    }
    const created = await this.drive.files.create({
      requestBody: { name: this.rootFolderName, mimeType: DRIVE_FOLDER_MIME, parents: [driveId] },
      supportsAllDrives: true,
      fields: 'id',
    })
    this.rootFolderId = created.data.id
    return this.rootFolderId
  }

  async listChildren(parentId) {
    if (this.cache.has(parentId)) return this.cache.get(parentId)
    const out = []
    let pageToken
    do {
      const res = await this.drive.files.list({
        q: `'${escapeQuery(parentId)}' in parents and trashed = false`,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        fields: 'nextPageToken, files(id,name,mimeType,size)',
        pageSize: 1000,
        pageToken,
      })
      for (const f of res.data.files || []) {
        out.push({ id: f.id, name: f.name, mimeType: f.mimeType, size: f.size !== undefined ? Number(f.size) : null })
      }
      pageToken = res.data.nextPageToken || undefined
    } while (pageToken)
    this.cache.set(parentId, out)
    return out
  }

  clearCache() {
    this.cache.clear()
  }

  async findInFolderByName(parentId, name) {
    const children = await this.listChildren(parentId)
    return children.find((c) => c.name === name) || null
  }

  async downloadFile(fileId) {
    const res = await this.drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' })
    return Buffer.from(res.data)
  }

  async createFolder(name, parentId) {
    const created = await this.drive.files.create({
      requestBody: { name, mimeType: DRIVE_FOLDER_MIME, parents: [parentId] },
      supportsAllDrives: true,
      fields: 'id,name,mimeType',
    })
    const child = { id: created.data.id, name, mimeType: DRIVE_FOLDER_MIME, size: null }
    this.cache.set(parentId, [...(this.cache.get(parentId) || []), child])
    return child
  }

  async uploadBuffer(parentId, name, buffer, mimeType = 'application/octet-stream') {
    const res = await this.drive.files.create({
      requestBody: { name, parents: [parentId] },
      media: { mimeType, body: Readable.from([buffer]) },
      supportsAllDrives: true,
      fields: 'id,name,size',
    })
    const child = { id: res.data.id, name, mimeType, size: buffer.length }
    this.cache.set(parentId, [...(this.cache.get(parentId) || []), child])
    return child
  }

  async resolvePath(folderId, relativePath) {
    // Real backups store each file as a flat Drive file whose *name* contains
    // slashes (e.g. "db/users.ndjson.gz"), while local mirrors use nested
    // folders. Try the exact name first, then walk the path segments.
    const direct = await this.findInFolderByName(folderId, String(relativePath))
    if (direct) return direct
    const parts = String(relativePath).split('/').filter(Boolean)
    let parent = folderId
    let entry = null
    for (const part of parts) {
      entry = await this.findInFolderByName(parent, part)
      if (!entry) return null
      parent = entry.id
    }
    return entry
  }

  async downloadAtPath(folderId, relativePath) {
    const entry = await this.resolvePath(folderId, relativePath)
    if (!entry) throw new Error(`Missing file in backup: ${relativePath}`)
    return this.downloadFile(entry.id)
  }

  async uploadAtPath(folderId, relativePath, buffer, mimeType = 'application/octet-stream') {
    const parts = String(relativePath).split('/').filter(Boolean)
    const fileName = parts.pop()
    let parent = folderId
    for (const part of parts) {
      const existing = await this.findInFolderByName(parent, part)
      if (existing) {
        if (existing.mimeType !== DRIVE_FOLDER_MIME) throw new Error(`Expected a folder at ${part}`)
        parent = existing.id
      } else {
        parent = (await this.createFolder(part, parent)).id
      }
    }
    return this.uploadBuffer(parent, fileName, buffer, mimeType)
  }
}

class LocalDrive {
  constructor({ dir, rootFolderName }) {
    this.rootDir = path.resolve(dir)
    this.rootFolderName = rootFolderName
    fs.mkdirSync(path.join(this.rootDir, rootFolderName), { recursive: true })
    this.cache = new Map()
  }

  abs(id) {
    const resolved = path.resolve(this.rootDir, id)
    if (resolved !== this.rootDir && !resolved.startsWith(this.rootDir + path.sep)) {
      throw new Error('Drive path escapes the local mirror')
    }
    return resolved
  }

  join(parentId, name) {
    return `${String(parentId).replace(/\/+$/, '')}/${name}`
  }

  async resolveSharedDrive() {
    return this.rootFolderName
  }

  async ensureRootFolder() {
    return this.rootFolderName
  }

  async listChildren(parentId) {
    if (this.cache.has(parentId)) return this.cache.get(parentId)
    let entries = []
    try {
      entries = await fsp.readdir(this.abs(parentId), { withFileTypes: true })
    } catch {
      entries = []
    }
    const out = []
    for (const entry of entries) {
      const id = this.join(parentId, entry.name)
      let size = null
      if (!entry.isDirectory()) {
        try {
          size = (await fsp.stat(this.abs(id))).size
        } catch {
          size = null
        }
      }
      out.push({ id, name: entry.name, mimeType: entry.isDirectory() ? DRIVE_FOLDER_MIME : 'application/octet-stream', size })
    }
    this.cache.set(parentId, out)
    return out
  }

  clearCache() {
    this.cache.clear()
  }

  async findInFolderByName(parentId, name) {
    return (await this.listChildren(parentId)).find((c) => c.name === name) || null
  }

  async downloadFile(fileId) {
    return fsp.readFile(this.abs(fileId))
  }

  async createFolder(name, parentId) {
    const id = this.join(parentId, name)
    await fsp.mkdir(this.abs(id), { recursive: true })
    const child = { id, name, mimeType: DRIVE_FOLDER_MIME, size: null }
    this.cache.set(parentId, [...(this.cache.get(parentId) || []), child])
    return child
  }

  async uploadBuffer(parentId, name, buffer) {
    const id = this.join(parentId, name)
    const target = this.abs(id)
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.writeFile(target, buffer)
    const child = { id, name, mimeType: 'application/octet-stream', size: buffer.length }
    this.cache.set(parentId, [...(this.cache.get(parentId) || []), child])
    return child
  }

  async resolvePath(folderId, relativePath) {
    const direct = await this.findInFolderByName(folderId, String(relativePath))
    if (direct) return direct
    const parts = String(relativePath).split('/').filter(Boolean)
    let parent = folderId
    let entry = null
    for (const part of parts) {
      entry = await this.findInFolderByName(parent, part)
      if (!entry) return null
      parent = entry.id
    }
    return entry
  }

  async downloadAtPath(folderId, relativePath) {
    const entry = await this.resolvePath(folderId, relativePath)
    if (!entry) throw new Error(`Missing file in backup: ${relativePath}`)
    return this.downloadFile(entry.id)
  }

  async uploadAtPath(folderId, relativePath, buffer) {
    const parts = String(relativePath).split('/').filter(Boolean)
    const fileName = parts.pop()
    let parent = folderId
    for (const part of parts) {
      const existing = await this.findInFolderByName(parent, part)
      if (existing) parent = existing.id
      else parent = (await this.createFolder(part, parent)).id
    }
    return this.uploadBuffer(parent, fileName, buffer)
  }
}

let singleton = null

export async function getDrive() {
  if (!singleton) {
    if (process.env.DRIVE_LOCAL_DIR) {
      singleton = new LocalDrive({
        dir: process.env.DRIVE_LOCAL_DIR,
        rootFolderName: process.env.DRIVE_ROOT_FOLDER_NAME || 'BPIN CRM Backups',
      })
    } else {
      singleton = new GoogleDrive({
        serviceAccountJson: serviceAccountRaw(),
        sharedDriveId: process.env.SHARED_DRIVE_ID || process.env.GOOGLE_SHARED_DRIVE_ID || '',
        sharedDriveName: process.env.SHARED_DRIVE_NAME || process.env.GOOGLE_SHARED_DRIVE_NAME || '',
        rootFolderName: process.env.DRIVE_ROOT_FOLDER_NAME || 'BPIN CRM Backups',
      })
    }
  }
  return singleton
}
