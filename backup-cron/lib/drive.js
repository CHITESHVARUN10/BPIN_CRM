import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { Transform } from 'node:stream'
import { google } from 'googleapis'
import { getEnv, parseServiceAccount } from './env.js'

// All Drive access goes through one of two implementations behind the same
// small interface: GoogleDrive (service account into a Workspace Shared
// Drive) or LocalDrive (mirror to a local folder, dev/testing only).
//
// Note on service accounts: they have zero storage quota and cannot own
// files, so every upload must live in a Shared Drive the SA is a member of.

function countBytes() {
  let bytes = 0
  const t = new Transform({
    transform(chunk, _enc, cb) {
      bytes += chunk.length
      cb(null, chunk)
    },
  })
  return { transform: t, bytes: () => bytes }
}

const escapeQuery = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")

let googleDriveSingleton = null

class GoogleDrive {
  constructor({ serviceAccountJson, sharedDriveId, rootFolderName }) {
    const credentials = parseServiceAccount(serviceAccountJson)
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive'],
    })
    this.drive = google.drive({ version: 'v3', auth })
    this.sharedDriveId = sharedDriveId
    this.rootFolderName = rootFolderName
    this.rootFolderId = null
  }

  async ensureRootFolder() {
    if (this.rootFolderId) return this.rootFolderId
    const q = `name = '${escapeQuery(this.rootFolderName)}' and '${escapeQuery(this.sharedDriveId)}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
    const found = await this.drive.files.list({
      q,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      fields: 'files(id,name)',
    })
    const existing = found.data.files?.[0]
    if (existing) {
      this.rootFolderId = existing.id
      return this.rootFolderId
    }
    const created = await this.drive.files.create({
      requestBody: {
        name: this.rootFolderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [this.sharedDriveId],
      },
      supportsAllDrives: true,
      fields: 'id',
    })
    this.rootFolderId = created.data.id
    return this.rootFolderId
  }

  async createFolder(name, parentId) {
    const created = await this.drive.files.create({
      requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
      supportsAllDrives: true,
      fields: 'id',
    })
    return { id: created.data.id }
  }

  async findInFolderByName(parentId, name) {
    const q = `name = '${escapeQuery(name)}' and '${escapeQuery(parentId)}' in parents and trashed = false`
    const res = await this.drive.files.list({
      q,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      fields: 'files(id,name,mimeType)',
    })
    const file = res.data.files?.[0]
    return file ? { id: file.id, name: file.name, mimeType: file.mimeType } : null
  }

  async uploadStream({ parentId, name, mimeType, stream }) {
    const counter = countBytes()
    stream.pipe(counter.transform)
    const res = await this.drive.files.create({
      requestBody: { name, parents: [parentId] },
      media: { mimeType, body: counter.transform },
      supportsAllDrives: true,
      fields: 'id,name,size',
    })
    return { id: res.data.id, bytes: counter.bytes() }
  }

  async deleteFile(fileId) {
    await this.drive.files.delete({ fileId, supportsAllDrives: true })
  }

  async listChildren(parentId) {
    const out = []
    let pageToken
    do {
      const res = await this.drive.files.list({
        q: `'${escapeQuery(parentId)}' in parents and trashed = false`,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        fields: 'nextPageToken, files(id,name,mimeType)',
        pageSize: 1000,
        pageToken,
      })
      for (const f of res.data.files || []) out.push({ id: f.id, name: f.name, mimeType: f.mimeType })
      pageToken = res.data.nextPageToken || undefined
    } while (pageToken)
    return out
  }

  async deleteFolderRecursive(folderId) {
    const children = await this.listChildren(folderId)
    for (const child of children) {
      if (child.mimeType === 'application/vnd.google-apps.folder') await this.deleteFolderRecursive(child.id)
      else await this.deleteFile(child.id)
    }
    await this.deleteFile(folderId)
  }
}

class LocalDrive {
  constructor({ dir, rootFolderName }) {
    this.root = path.resolve(dir, rootFolderName)
    fs.mkdirSync(this.root, { recursive: true })
  }

  idFor(...parts) {
    return parts.map((p) => String(p).replace(/\/+$/, '')).join('/')
  }

  abs(id) {
    const rel = id.startsWith(this.root) ? path.relative(this.root, id) : id
    const resolved = path.resolve(this.root, rel)
    if (!resolved.startsWith(this.root)) throw new Error('LocalDrive path escapes the root folder')
    return resolved
  }

  async ensureRootFolder() {
    return this.root
  }

  async createFolder(name, parentId) {
    const id = this.idFor(parentId, name)
    await fsp.mkdir(this.abs(id), { recursive: true })
    return { id }
  }

  async findInFolderByName(parentId, name) {
    const id = this.idFor(parentId, name)
    try {
      const stat = await fsp.stat(this.abs(id))
      return { id, name, mimeType: stat.isDirectory() ? 'application/vnd.google-apps.folder' : 'application/octet-stream' }
    } catch {
      return null
    }
  }

  async uploadStream({ parentId, name, mimeType, stream }) {
    const id = this.idFor(parentId, name)
    const target = this.abs(id)
    await fsp.mkdir(path.dirname(target), { recursive: true })
    const counter = countBytes()
    stream.pipe(counter.transform)
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(target)
      counter.transform.pipe(out)
      counter.transform.on('error', reject)
      out.on('error', reject)
      out.on('finish', resolve)
    })
    return { id, bytes: counter.bytes(), mimeType }
  }

  async deleteFile(fileId) {
    await fsp.rm(this.abs(fileId), { force: true })
  }

  async listChildren(parentId) {
    const dir = this.abs(parentId)
    let entries = []
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return []
    }
    return entries.map((e) => ({
      id: this.idFor(parentId, e.name),
      name: e.name,
      mimeType: e.isDirectory() ? 'application/vnd.google-apps.folder' : 'application/octet-stream',
    }))
  }

  async deleteFolderRecursive(folderId) {
    await fsp.rm(this.abs(folderId), { recursive: true, force: true })
  }
}

export async function getDrive() {
  if (!googleDriveSingleton) {
    const env = getEnv()
    googleDriveSingleton = env.localDriveDir
      ? new LocalDrive({ dir: env.localDriveDir, rootFolderName: env.rootFolderName })
      : new GoogleDrive(env)
  }
  return googleDriveSingleton
}
