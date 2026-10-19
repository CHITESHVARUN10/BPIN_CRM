import { useEffect, useRef, useState } from 'react'
import { upload } from '@vercel/blob/client'
import { AlertCircle, Camera, ImagePlus, Loader2, RotateCcw, Video, X } from 'lucide-react'
import api from '../api/client.js'
import { canonicalMediaUrl, extFor, newId } from '../utils/media.js'

const MAX_W = 1600

async function compress(file) {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_W / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82))
    if (!blob) return file
    return new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' })
  } catch {
    return file
  }
}

export default function MediaUploader({
  images,
  onImagesChange,
  videos = [],
  onVideosChange,
  maxImages = 4,
  maxVideos = 1,
  videoMaxMB = 50,
}) {
  const cameraRef = useRef(null)
  const galleryRef = useRef(null)
  const videoCameraRef = useRef(null)
  const videoRef = useRef(null)
  const [config, setConfig] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    api
      .get('/media/config')
      .then((res) => {
        if (alive) setConfig(res.data)
      })
      .catch(() => {
        if (alive) setConfig({ enabled: false })
      })
    return () => {
      alive = false
    }
  }, [])

  const updateItem = (kind, id, patch) => {
    const setter = kind === 'image' ? onImagesChange : onVideosChange
    setter((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  const uploadItem = async (kind, file) => {
    if (!config?.enabled) {
      setError('Media uploads are unavailable right now. You can still submit without media.')
      return
    }

    const limit = kind === 'video' ? config.limits.videoBytes : config.limits.imageBytes
    setError('')
    const setter = kind === 'image' ? onImagesChange : onVideosChange
    let prepared = file
    if (kind === 'image') prepared = await compress(file)
    if (prepared.size > limit) {
      setError(kind === 'video' ? `Video must be under ${Math.round(limit / 1024 / 1024)}MB` : 'Each photo must be under 10MB')
      return
    }

    const id = newId()
    const previewUrl = URL.createObjectURL(prepared)
    const item = {
      id,
      kind,
      name: prepared.name,
      size: prepared.size,
      contentType: prepared.type,
      status: 'uploading',
      progress: 0,
      previewUrl,
      file: prepared,
    }

    if (kind === 'video') {
      setter(() => [item])
    } else {
      setter((prev) => [...prev, item])
    }

    try {
      const pathname = `${config.prefix}${kind}-${id}.${extFor(prepared.type)}`
      const blob = await upload(pathname, prepared, {
        access: 'private',
        handleUploadUrl: config.uploadUrl,
        clientPayload: JSON.stringify({ kind }),
        contentType: prepared.type,
        onUploadProgress: ({ percentage }) => {
          updateItem(kind, id, { progress: Math.max(0, Math.min(100, Math.round(percentage || 0))) })
        },
      })

      updateItem(kind, id, {
        status: 'uploaded',
        progress: 100,
        pathname: blob.pathname,
        url: canonicalMediaUrl(blob.pathname),
        contentType: blob.contentType || prepared.type,
        size: prepared.size,
        file: undefined,
      })
    } catch (err) {
      updateItem(kind, id, {
        status: 'error',
        error: err?.message || 'Upload failed',
      })
      setError('Some media failed to upload. Retry it, or remove it and choose the file again.')
    }
  }

  const addImages = async (fileList) => {
    const room = maxImages - images.length
    const picked = Array.from(fileList || []).slice(0, Math.max(0, room))
    for (const file of picked) {
      if (!file.type.startsWith('image/')) {
        setError('Only image files can be attached as photos.')
        continue
      }
      await uploadItem('image', file)
    }
  }

  const addVideo = async (fileList) => {
    setError('')
    const picked = Array.from(fileList || [])[0]
    if (!picked) return
    if (!picked.type.startsWith('video/')) {
      setError('Choose a video file.')
      return
    }
    const limit = config?.limits?.videoBytes || videoMaxMB * 1024 * 1024
    if (picked.size > limit) {
      setError(`Video must be under ${Math.round(limit / 1024 / 1024)}MB — trim it or record a shorter clip`)
      return
    }
    const previous = videos[0]
    if (previous) removeItem('video', previous.id)
    await uploadItem('video', picked)
  }

  const removeItem = (kind, id) => {
    const current = (kind === 'image' ? images : videos).find((item) => item.id === id)
    if (current?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(current.previewUrl)
    if (current?.pathname) api.delete('/media', { params: { path: current.pathname } }).catch(() => {})
    const setter = kind === 'image' ? onImagesChange : onVideosChange
    setter((prev) => prev.filter((item) => item.id !== id))
  }

  const removeVideo = () => {
    const current = videos[0]
    if (current) removeItem('video', current.id)
  }

  const retryItem = async (kind, item) => {
    if (!item.file) {
      setError('This file could not be restored after reload. Remove it and choose it again.')
      return
    }
    if (item.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl)
    const setter = kind === 'image' ? onImagesChange : onVideosChange
    setter((prev) => prev.filter((entry) => entry.id !== item.id))
    await uploadItem(kind, item.file)
  }

  const videoLimitMB = config ? Math.round(config.limits.videoBytes / 1024 / 1024) : videoMaxMB
  const mediaDisabled = !config?.enabled

  return (
    <div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn btn-outline btn-sm flex-1"
          onClick={() => cameraRef.current?.click()}
          disabled={mediaDisabled || images.length >= maxImages}
        >
          <Camera size={15} />
          Take photo
        </button>
        <button
          type="button"
          className="btn btn-outline btn-sm flex-1"
          onClick={() => galleryRef.current?.click()}
          disabled={mediaDisabled || images.length >= maxImages}
        >
          <ImagePlus size={15} />
          Gallery
        </button>
      </div>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { addImages(e.target.files); e.target.value = '' }} />
      <input ref={galleryRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addImages(e.target.files); e.target.value = '' }} />

      {images.length > 0 && (
        <div className="mt-3 grid grid-cols-4 gap-2">
          {images.map((item, i) => (
            <div key={item.id || i} className="relative aspect-square rounded-xl overflow-hidden border border-zinc-200 bg-zinc-100">
              <img src={item.previewUrl} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
              {item.status === 'uploading' ? (
                <div className="absolute inset-0 bg-zinc-900/55 text-white grid place-items-center">
                  <div className="text-center">
                    <Loader2 size={15} className="animate-spin mx-auto" />
                    <p className="mt-1 text-[10px] font-medium">{item.progress || 0}%</p>
                  </div>
                </div>
              ) : null}
              {item.status === 'error' ? (
                <div className="absolute inset-0 bg-red-950/70 text-white p-1.5 grid place-items-center text-center">
                  <div>
                    <AlertCircle size={15} className="mx-auto" />
                    <button type="button" onClick={() => retryItem('image', item)} className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium">
                      <RotateCcw size={10} /> Retry
                    </button>
                  </div>
                </div>
              ) : null}
              <button type="button" onClick={() => removeItem('image', item.id)} className="absolute top-1 right-1 w-5 h-5 grid place-items-center rounded-full bg-zinc-900/80 text-white" aria-label="Remove photo">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="mt-2 text-[12px] text-zinc-400">
        {images.length} / {maxImages} photos
      </p>

      <div className="divider my-3" />

      {videos.length === 0 ? (
        <div className="flex items-center gap-2">
          <button type="button" className="btn btn-outline btn-sm flex-1" onClick={() => videoCameraRef.current?.click()} disabled={mediaDisabled || maxVideos === 0}>
            <Video size={15} />
            Record video
          </button>
          <button type="button" className="btn btn-outline btn-sm flex-1" onClick={() => videoRef.current?.click()} disabled={mediaDisabled || maxVideos === 0}>
            <Video size={15} />
            Choose video
          </button>
        </div>
      ) : (
        <div className="relative rounded-xl overflow-hidden border border-zinc-200 bg-black">
          <video src={videos[0].previewUrl} controls playsInline className="w-full max-h-64" />
          {videos[0].status === 'uploading' ? (
            <div className="absolute inset-0 bg-zinc-900/55 text-white grid place-items-center">
              <div className="text-center">
                <Loader2 size={18} className="animate-spin mx-auto" />
                <p className="mt-1 text-[11px] font-medium">Uploading · {videos[0].progress || 0}%</p>
              </div>
            </div>
          ) : null}
          {videos[0].status === 'error' ? (
            <div className="absolute inset-0 bg-red-950/70 text-white grid place-items-center text-center p-3">
              <div>
                <AlertCircle size={18} className="mx-auto" />
                <p className="mt-1 text-[11px]">Video upload failed</p>
                <button type="button" onClick={() => retryItem('video', videos[0])} className="btn btn-sm btn-outline mt-2">
                  <RotateCcw size={13} /> Retry
                </button>
              </div>
            </div>
          ) : null}
          <button type="button" onClick={removeVideo} className="absolute top-2 right-2 w-6 h-6 grid place-items-center rounded-full bg-zinc-900/80 text-white" aria-label="Remove video">
            <X size={13} />
          </button>
        </div>
      )}
      <input ref={videoCameraRef} type="file" accept="video/*" capture="environment" hidden onChange={(e) => { addVideo(e.target.files); e.target.value = '' }} />
      <input ref={videoRef} type="file" accept="video/mp4,video/webm,video/quicktime,video/*" hidden onChange={(e) => { addVideo(e.target.files); e.target.value = '' }} />
      <p className="mt-2 text-[12px] text-zinc-400">
        1 video · up to {videoLimitMB}MB (optional) — recording opens the camera app, no extra permission needed
      </p>

      {config === null ? <p className="mt-1 text-[12px] text-zinc-400">Preparing media upload…</p> : null}
      {config?.enabled === false ? <p className="mt-1 text-[12px] text-amber-700">Media uploads are unavailable right now. You can still submit without media.</p> : null}
      {error ? <p className="mt-1 text-[12px] text-red-600">{error}</p> : null}
    </div>
  )
}
