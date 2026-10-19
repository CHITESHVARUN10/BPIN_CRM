import { Router } from 'express'
import { handleUpload } from '@vercel/blob/client'
import ServiceRecord from '../models/ServiceRecord.js'
import { requireAuth } from '../middleware/auth.js'
import {
  IMAGE_CONTENT_TYPES,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  VIDEO_CONTENT_TYPES,
  blobToken,
  deleteStagedMedia,
  mediaUploadPrefix,
  storageEnabled,
} from '../utils/blob.js'

const router = Router()

const EXTENSIONS = {
  image: new Set(['jpg', 'jpeg', 'png', 'webp']),
  video: new Set(['mp4', 'webm', 'mov']),
}

router.get('/config', requireAuth, (req, res) => {
  res.json({
    enabled: storageEnabled(),
    uploadUrl: '/api/media/upload',
    prefix: mediaUploadPrefix(req.user._id),
    limits: {
      images: 4,
      imageBytes: MAX_IMAGE_BYTES,
      videos: 1,
      videoBytes: MAX_VIDEO_BYTES,
    },
  })
})

router.post('/upload', requireAuth, async (req, res, next) => {
  try {
    if (!storageEnabled()) return res.status(503).json({ message: 'Media storage is not configured' })
    const userId = String(req.user._id)
    const prefix = mediaUploadPrefix(userId)

    const result = await handleUpload({
      token: blobToken(),
      request: req,
      body: req.body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!pathname || pathname.includes('..') || !pathname.startsWith(prefix)) {
          const err = new Error('Invalid upload path')
          err.status = 400
          throw err
        }

        let payload
        try {
          payload = JSON.parse(clientPayload || '{}')
        } catch {
          payload = {}
        }
        const kind = payload.kind === 'video' ? 'video' : payload.kind === 'image' ? 'image' : ''
        if (!kind) {
          const err = new Error('Upload kind must be image or video')
          err.status = 400
          throw err
        }

        const ext = pathname.split('.').pop()?.toLowerCase() || ''
        if (!EXTENSIONS[kind].has(ext)) {
          const err = new Error('Invalid file extension for this media type')
          err.status = 400
          throw err
        }

        return {
          allowedContentTypes: kind === 'video' ? VIDEO_CONTENT_TYPES : IMAGE_CONTENT_TYPES,
          maximumSizeInBytes: kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES,
          addRandomSuffix: false,
          allowOverwrite: false,
          tokenPayload: JSON.stringify({ userId, kind }),
        }
      },
    })

    return res.json(result)
  } catch (err) {
    if (!err.status) err.status = 400
    return next(err)
  }
})

router.delete('/', requireAuth, async (req, res, next) => {
  try {
    if (!storageEnabled()) return res.status(503).json({ message: 'Media storage is not configured' })
    const pathname = String(req.query.path || '').trim()
    if (!pathname) return res.status(400).json({ message: 'Media path is required' })
    const prefix = mediaUploadPrefix(req.user._id)
    if (pathname.includes('..') || !pathname.startsWith(prefix)) {
      return res.status(400).json({ message: 'Invalid uploaded media path' })
    }

    const referenced = await ServiceRecord.exists({
      $or: [
        { 'images.publicId': pathname },
        { 'closure.images.publicId': pathname },
        { 'followUps.images.publicId': pathname },
      ],
    })
    if (referenced) {
      return res.status(409).json({ message: 'This file is attached to a report and cannot be removed' })
    }

    await deleteStagedMedia(pathname, req.user._id)
    return res.json({ ok: true })
  } catch (err) {
    return next(err)
  }
})

export default router
