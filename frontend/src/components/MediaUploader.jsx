import { useRef, useState } from 'react'
import { Camera, ImagePlus, Video, X } from 'lucide-react'

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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const addImages = async (fileList) => {
    setBusy(true)
    const room = maxImages - images.length
    const picked = Array.from(fileList).slice(0, Math.max(0, room))
    const compressed = []
    for (const f of picked) compressed.push(await compress(f))
    const next = compressed.map((file) => ({ file, previewUrl: URL.createObjectURL(file) }))
    onImagesChange([...images, ...next])
    setBusy(false)
  }

  const removeImage = (i) => {
    URL.revokeObjectURL(images[i].previewUrl)
    onImagesChange(images.filter((_, idx) => idx !== i))
  }

  const addVideo = (fileList) => {
    setError('')
    const picked = Array.from(fileList)[0]
    if (!picked) return
    if (picked.size > videoMaxMB * 1024 * 1024) {
      setError(`Video must be under ${videoMaxMB}MB — trim it or record a shorter clip`)
      return
    }
    for (const old of videos) URL.revokeObjectURL(old.previewUrl)
    onVideosChange([{ file: picked, previewUrl: URL.createObjectURL(picked) }].slice(0, maxVideos))
  }

  const removeVideo = () => {
    for (const old of videos) URL.revokeObjectURL(old.previewUrl)
    onVideosChange([])
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-outline btn-sm flex-1" onClick={() => cameraRef.current?.click()} disabled={busy || images.length >= maxImages}>
          <Camera size={15} />
          Take photo
        </button>
        <button type="button" className="btn btn-outline btn-sm flex-1" onClick={() => galleryRef.current?.click()} disabled={busy || images.length >= maxImages}>
          <ImagePlus size={15} />
          Gallery
        </button>
      </div>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { addImages(e.target.files); e.target.value = '' }} />
      <input ref={galleryRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addImages(e.target.files); e.target.value = '' }} />

      {images.length > 0 && (
        <div className="mt-3 grid grid-cols-4 gap-2">
          {images.map((item, i) => (
            <div key={i} className="relative aspect-square rounded-xl overflow-hidden border border-zinc-200">
              <img src={item.previewUrl} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
              <button type="button" onClick={() => removeImage(i)} className="absolute top-1 right-1 w-5 h-5 grid place-items-center rounded-full bg-zinc-900/80 text-white" aria-label="Remove photo">
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
          <button type="button" className="btn btn-outline btn-sm flex-1" onClick={() => videoCameraRef.current?.click()}>
            <Video size={15} />
            Record video
          </button>
          <button type="button" className="btn btn-outline btn-sm flex-1" onClick={() => videoRef.current?.click()}>
            <Video size={15} />
            Choose video
          </button>
        </div>
      ) : (
        <div className="relative rounded-xl overflow-hidden border border-zinc-200 bg-black">
          <video src={videos[0].previewUrl} controls playsInline className="w-full max-h-64" />
          <button type="button" onClick={removeVideo} className="absolute top-2 right-2 w-6 h-6 grid place-items-center rounded-full bg-zinc-900/80 text-white" aria-label="Remove video">
            <X size={13} />
          </button>
        </div>
      )}
      <input ref={videoCameraRef} type="file" accept="video/*" capture="environment" hidden onChange={(e) => { addVideo(e.target.files); e.target.value = '' }} />
      <input ref={videoRef} type="file" accept="video/mp4,video/webm,video/quicktime,video/*" hidden onChange={(e) => { addVideo(e.target.files); e.target.value = '' }} />
      <p className="mt-2 text-[12px] text-zinc-400">
        1 video · up to {videoMaxMB}MB (optional) — recording opens the camera app, no extra permission needed
      </p>

      {error ? <p className="mt-1 text-[12px] text-red-600">{error}</p> : null}
    </div>
  )
}
