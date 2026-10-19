import { Readable } from 'node:stream'
import { del, get, list } from '@vercel/blob'
import { getEnv } from './env.js'

export async function listAllBlobs() {
  const token = getEnv().blobToken
  const blobs = []
  let cursor
  do {
    const page = await list({ token, cursor })
    for (const b of page.blobs) {
      blobs.push({
        pathname: b.pathname,
        size: b.size ?? null,
        uploadedAt: b.uploadedAt ? new Date(b.uploadedAt).toISOString() : null,
        contentType: b.contentType || null,
      })
    }
    cursor = page.cursor
  } while (cursor)
  return blobs
}

export async function openBlobStream(pathname) {
  const token = getEnv().blobToken
  const res = await get(pathname, { access: 'private', token })
  if (!res?.stream) throw new Error(`Blob not found in store: ${pathname}`)
  // The SDK hands back a WHATWG ReadableStream; normalize to a Node stream
  // so callers can pipe/attach error handlers as usual.
  const stream = res.stream instanceof Readable ? res.stream : Readable.fromWeb(res.stream)
  return {
    stream,
    contentType: res.blob?.contentType || null,
    size: res.blob?.size ?? null,
  }
}

// Maps every blob pathname -> the ServiceRecord fields that reference it,
// so the manifest can tie stored identifiers to DB records for recovery.
export async function buildBlobRefMap(db) {
  const map = new Map()
  const add = (pathname, ref) => {
    if (!pathname) return
    const list = map.get(pathname) || []
    list.push(ref)
    map.set(pathname, list)
  }
  const cursor = db
    .collection('servicerecords')
    .find({}, { projection: { tokenNo: 1, images: 1, followUps: 1, closure: 1 } })
  for await (const record of cursor) {
    const base = { recordId: String(record._id), tokenNo: record.tokenNo }
    ;(record.images || []).forEach((m, i) =>
      add(m?.publicId, { ...base, section: `images[${i}]`, url: m?.url, kind: m?.kind || 'image' }),
    )
    ;((record.closure && record.closure.images) || []).forEach((m, i) =>
      add(m?.publicId, { ...base, section: `closure.images[${i}]`, url: m?.url, kind: m?.kind || 'image' }),
    )
    ;(record.followUps || []).forEach((f, j) =>
      (f?.images || []).forEach((m, i) =>
        add(m?.publicId, { ...base, section: `followUps[${j}].images[${i}]`, url: m?.url, kind: m?.kind || 'image' }),
      ),
    )
  }
  return map
}

// Direct client uploads are staged under bpin/tmp/<userId>/. Once a report is
// saved, the pathname is referenced by a ServiceRecord and is skipped forever.
// Unreferenced staged blobs older than the TTL are safe to remove.
export async function cleanupStagedMedia(db, { now = new Date(), olderThanMs = 24 * 60 * 60 * 1000 } = {}) {
  const token = getEnv().blobToken
  if (!token) return { scanned: 0, deleted: 0, skipped: 0 }

  const refs = await buildBlobRefMap(db)
  let cursor
  let scanned = 0
  let deleted = 0
  let skipped = 0

  do {
    const page = await list({ token, prefix: 'bpin/tmp/', cursor })
    for (const blob of page.blobs) {
      scanned += 1
      if (refs.has(blob.pathname)) {
        skipped += 1
        continue
      }
      const uploadedAt = blob.uploadedAt ? new Date(blob.uploadedAt) : null
      if (!uploadedAt || now.getTime() - uploadedAt.getTime() < olderThanMs) {
        skipped += 1
        continue
      }
      try {
        await del(blob.pathname, { token })
        deleted += 1
      } catch {
        skipped += 1
      }
    }
    cursor = page.cursor
  } while (cursor)

  return { scanned, deleted, skipped }
}
