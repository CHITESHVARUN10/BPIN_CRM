import { Router } from 'express'
import { Readable } from 'node:stream'
import ServiceRecord from '../models/ServiceRecord.js'
import { getBlob, mediaUploadPrefix, storageEnabled } from '../utils/blob.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

// Streams a private Blob file to an authenticated session. The blob store is
// private, so direct URLs are not readable — this route is the only way media
// reaches the browser. Auth is enforced here, next to the read (per Vercel's
// private-storage guidance). Technicians may only read their own staged files
// or media referenced by one of their own records.
router.get('/', requireAuth, async (req, res, next) => {
  try {
    if (!storageEnabled()) return res.status(503).json({ message: 'Media storage is not configured' })

    const pathname = typeof req.query.path === 'string' ? req.query.path : ''
    if (!pathname.startsWith('bpin/') || pathname.includes('..')) {
      return res.status(404).json({ message: 'Not found' })
    }

    if (req.user.role !== 'admin' && !pathname.startsWith(mediaUploadPrefix(req.user._id))) {
      const owned = await ServiceRecord.exists({
        technician: req.user._id,
        $or: [
          { 'images.publicId': pathname },
          { 'closure.images.publicId': pathname },
          { 'followUps.images.publicId': pathname },
        ],
      })
      if (!owned) return res.status(404).json({ message: 'Not found' })
    }

    const result = await getBlob(pathname, { ifNoneMatch: req.headers['if-none-match'] })
    if (!result) return res.status(404).json({ message: 'Not found' })

    if (result.statusCode === 304) {
      res.setHeader('ETag', result.blob.etag)
      res.setHeader('Cache-Control', 'private, no-cache')
      return res.status(304).end()
    }

    res.setHeader('Content-Type', result.blob.contentType || 'application/octet-stream')
    if (result.blob.size) res.setHeader('Content-Length', String(result.blob.size))
    res.setHeader('ETag', result.blob.etag)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Cache-Control', 'private, no-cache')

    const stream = Readable.fromWeb(result.stream)
    stream.on('error', () => res.destroy())
    stream.pipe(res)
    return undefined
  } catch (err) {
    return next(err)
  }
})

export default router
