import { randomUUID } from 'node:crypto'
import { put, get } from '@vercel/blob'

// Vercel Blob private store. Auth uses BLOB_READ_WRITE_TOKEN because this API
// runs outside Vercel (Render). SDK reads the env var automatically, we pass it
// explicitly so a misconfigured environment fails loudly instead of silently.

const EXT_BY_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
}

export function storageEnabled() {
  return !!process.env.BLOB_READ_WRITE_TOKEN
}

function extFor(contentType) {
  return EXT_BY_TYPE[contentType] || 'bin'
}

function dateFolder(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function token() {
  const value = process.env.BLOB_READ_WRITE_TOKEN
  if (!value) throw new Error('Media storage is not configured')
  return value
}

// Stores the file privately and returns the record item we persist in Mongo.
// `url` is a same-origin app route (not the raw private blob URL) so <img>/<video>
// work everywhere, including through the Vercel → Render proxy.
export async function uploadMedia(buffer, { contentType, kind = 'image' }) {
  const pathname = `bpin/records/${dateFolder()}/${kind}-${randomUUID().slice(0, 8)}.${extFor(contentType)}`
  const blob = await put(pathname, buffer, {
    access: 'private',
    contentType,
    addRandomSuffix: false,
    token: token(),
  })
  return {
    url: `/api/files?path=${encodeURIComponent(blob.pathname)}`,
    publicId: blob.pathname,
    kind,
    contentType,
  }
}

export async function getBlob(pathname, { ifNoneMatch } = {}) {
  return get(pathname, { access: 'private', ifNoneMatch, token: token() })
}
