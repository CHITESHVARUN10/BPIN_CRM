import { del, get, head } from '@vercel/blob'

// Vercel Blob private store. Auth uses BLOB_READ_WRITE_TOKEN because this API
// can run outside Vercel. The SDK reads the env var automatically, but we pass
// it explicitly so a misconfigured environment fails loudly.

export const IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const VIDEO_CONTENT_TYPES = ['video/mp4', 'video/webm', 'video/quicktime']
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024

const IMAGE_TYPES = new Set(IMAGE_CONTENT_TYPES)
const VIDEO_TYPES = new Set(VIDEO_CONTENT_TYPES)

export function storageEnabled() {
  return !!process.env.BLOB_READ_WRITE_TOKEN
}

export function blobToken() {
  const value = process.env.BLOB_READ_WRITE_TOKEN
  if (!value) throw new Error('Media storage is not configured')
  return value
}

export function mediaUploadPrefix(userId) {
  return `bpin/tmp/${String(userId)}/`
}

export function canonicalMediaUrl(pathname) {
  return `/api/files?path=${encodeURIComponent(pathname)}`
}

function badRequest(message) {
  const err = new Error(message)
  err.status = 400
  return err
}

function assertUploadPath(pathname, userId) {
  const prefix = mediaUploadPrefix(userId)
  if (!pathname || pathname.includes('..') || !pathname.startsWith(prefix)) {
    throw badRequest('Invalid uploaded media path')
  }
}

// Verifies a client-uploaded blob exists, belongs to the signed-in user, and
// matches the expected media kind. Returns exactly the shape stored in MongoDB.
export async function resolveUploadedMedia(rawItems, { userId, kind, maxCount }) {
  if (rawItems == null) return []
  if (!Array.isArray(rawItems)) throw badRequest('Invalid media list')
  if (rawItems.length > maxCount) {
    throw badRequest(`You can attach at most ${maxCount} ${kind === 'video' ? 'video' : 'photos'}`)
  }
  if (!rawItems.length) return []

  const allowed = kind === 'video' ? VIDEO_TYPES : IMAGE_TYPES
  const maxBytes = kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES
  const seen = new Set()
  const items = []

  for (const raw of rawItems) {
    const pathname = String(raw?.pathname || '').trim()
    assertUploadPath(pathname, userId)
    if (!storageEnabled()) throw badRequest('Media storage is not configured')
    if (seen.has(pathname)) throw badRequest('The same file was attached twice')
    seen.add(pathname)

    let meta
    try {
      meta = await head(pathname, { token: blobToken() })
    } catch {
      throw badRequest('An uploaded file is missing or expired. Remove it and upload it again.')
    }

    const contentType = String(meta.contentType || '').toLowerCase().split(';')[0]
    if (!allowed.has(contentType)) {
      throw badRequest(kind === 'video' ? 'Only MP4, WebM or MOV videos are allowed' : 'Only JPEG, PNG or WebP images are allowed')
    }
    if (Number(meta.size) > maxBytes) {
      throw badRequest(kind === 'video' ? 'Video must be under 50MB' : 'Each photo must be under 10MB')
    }

    items.push({
      url: canonicalMediaUrl(pathname),
      publicId: pathname,
      kind,
      contentType,
    })
  }

  return items
}

export async function deleteStagedMedia(pathname, userId) {
  const value = String(pathname || '').trim()
  assertUploadPath(value, userId)
  await del(value, { token: blobToken() })
}

export async function getBlob(pathname, { ifNoneMatch } = {}) {
  return get(pathname, { access: 'private', ifNoneMatch, token: blobToken() })
}
