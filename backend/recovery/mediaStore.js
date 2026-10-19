import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { get, put } from '@vercel/blob'
import { readStreamToBuffer } from './format.js'

// Asset storage abstraction used by the recovery workflow.
//   production → private Vercel Blob store (BLOB_READ_WRITE_TOKEN)
//   tests/dev  → local filesystem mirror (BLOB_LOCAL_DIR) so destructive
//                drills never touch production storage.

class VercelBlobStore {
  constructor(token) {
    this.token = token
  }

  async read(pathname) {
    const res = await get(pathname, { access: 'private', token: this.token })
    if (!res?.stream) return null
    const stream = res.stream instanceof Readable ? res.stream : Readable.fromWeb(res.stream)
    const buffer = await readStreamToBuffer(stream)
    return { buffer, contentType: res.blob?.contentType || null }
  }

  async write(pathname, buffer, contentType) {
    await put(pathname, buffer, {
      access: 'private',
      contentType,
      addRandomSuffix: false,
      token: this.token,
    })
  }
}

class LocalBlobStore {
  constructor(dir) {
    this.dir = path.resolve(dir)
    fs.mkdirSync(this.dir, { recursive: true })
  }

  abs(pathname) {
    const resolved = path.resolve(this.dir, pathname)
    if (resolved !== this.dir && !resolved.startsWith(this.dir + path.sep)) {
      throw new Error('Blob path escapes the local store')
    }
    return resolved
  }

  async read(pathname) {
    try {
      return { buffer: await fsp.readFile(this.abs(pathname)), contentType: null }
    } catch (err) {
      if (err?.code === 'ENOENT') return null
      throw err
    }
  }

  async write(pathname, buffer) {
    const target = this.abs(pathname)
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.writeFile(target, buffer)
  }
}

let singleton = null

export function getMediaStore() {
  if (!singleton) {
    singleton = process.env.BLOB_LOCAL_DIR
      ? new LocalBlobStore(process.env.BLOB_LOCAL_DIR)
      : new VercelBlobStore(process.env.BLOB_READ_WRITE_TOKEN || '')
  }
  return singleton
}

export function mediaStoreConfigured() {
  return Boolean(process.env.BLOB_LOCAL_DIR || process.env.BLOB_READ_WRITE_TOKEN)
}
