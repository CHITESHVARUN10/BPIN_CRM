import { useRef, useState } from 'react'
import { Camera, ImagePlus, X } from 'lucide-react'

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

export default function ImageUploader({ value, onChange, max = 4 }) {
  const cameraRef = useRef(null)
  const galleryRef = useRef(null)
  const [busy, setBusy] = useState(false)

  const addFiles = async (fileList) => {
    setBusy(true)
    const room = max - value.length
    const picked = Array.from(fileList).slice(0, Math.max(0, room))
    const compressed = []
    for (const f of picked) compressed.push(await compress(f))
    const next = compressed.map((file) => ({ file, previewUrl: URL.createObjectURL(file) }))
    onChange([...value, ...next])
    setBusy(false)
  }

  const remove = (i) => {
    URL.revokeObjectURL(value[i].previewUrl)
    onChange(value.filter((_, idx) => idx !== i))
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-outline btn-sm flex-1" onClick={() => cameraRef.current?.click()} disabled={busy || value.length >= max}>
          <Camera size={15} />
          Take photo
        </button>
        <button type="button" className="btn btn-outline btn-sm flex-1" onClick={() => galleryRef.current?.click()} disabled={busy || value.length >= max}>
          <ImagePlus size={15} />
          Gallery
        </button>
      </div>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
      <input ref={galleryRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
      {value.length > 0 && (
        <div className="mt-3 grid grid-cols-4 gap-2">
          {value.map((item, i) => (
            <div key={i} className="relative aspect-square rounded-xl overflow-hidden border border-zinc-200">
              <img src={item.previewUrl} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
              <button type="button" onClick={() => remove(i)} className="absolute top-1 right-1 w-5 h-5 grid place-items-center rounded-full bg-zinc-900/80 text-white" aria-label="Remove photo">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="mt-2 text-[12px] text-zinc-400">
        {value.length} / {max} photos
      </p>
    </div>
  )
}
