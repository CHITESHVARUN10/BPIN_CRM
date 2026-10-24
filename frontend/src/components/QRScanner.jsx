import { useEffect, useRef, useState } from 'react'
import { captureRegion, createQRDecoder, scanRegion } from '../utils/qrDecoder'
import { Camera, CameraOff, Flashlight, Minus, Plus, X } from 'lucide-react'

export default function QRScanner({ onResult, onClose }) {
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState('')
  const [ready, setReady] = useState(false)
  const [cameraId, setCameraId] = useState('')
  const [cameras, setCameras] = useState([])
  const [attempt, setAttempt] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [zoomRange, setZoomRange] = useState(null)
  const [torchAvailable, setTorchAvailable] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [focusPoint, setFocusPoint] = useState(null)
  const [focusAvailable, setFocusAvailable] = useState(false)
  const [focusRange, setFocusRange] = useState(null)
  const [focusDistance, setFocusDistance] = useState(0)
  const [manualFocus, setManualFocus] = useState(false)
  const [aspectRatio, setAspectRatio] = useState(4 / 3)
  const onResultRef = useRef(onResult)
  const videoRef = useRef(null)
  const trackRef = useRef(null)
  const sessionRef = useRef(null)
  const lifecycleRef = useRef(Promise.resolve())
  const fileInputRef = useRef(null)
  const focusTimerRef = useRef(null)
  const focusResetRef = useRef(null)
  const focusRequestRef = useRef(0)
  const scanPointRef = useRef({ x: 0.5, y: 0.5 })
  const photoBusyRef = useRef(false)
  const photoDecoderRef = useRef(null)
  const mountedRef = useRef(false)

  useEffect(() => { onResultRef.current = onResult }, [onResult])
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      photoDecoderRef.current?.close()
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let handled = false
    let stream
    let decoder
    let timer
    const video = videoRef.current
    const canvas = document.createElement('canvas')
    const stop = () => {
      clearTimeout(timer)
      stream?.getTracks().forEach((track) => track.stop())
      decoder?.close()
      if (video.srcObject === stream) video.srcObject = null
    }
    const session = {
      finish(text) {
        const value = text?.trim()
        if (cancelled || handled || !value) return
        handled = true
        stop()
        onResultRef.current?.(value)
      },
    }
    sessionRef.current = session
    // Serialize camera requests: a lens must be released before another opens.
    const start = lifecycleRef.current.then(async () => {
      if (cancelled) return
      setReady(false)
      setError(null)
      setZoomRange(null)
      setTorchAvailable(false)
      setTorchOn(false)
      setFocusAvailable(false)
      setFocusRange(null)
      setManualFocus(false)
      setFocusPoint(null)
      scanPointRef.current = { x: 0.5, y: 0.5 }
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setError('Camera needs HTTPS (or localhost). Use a photo or enter the serial number manually.')
        return
      }
      try {
        const camera = cameraId ? { deviceId: { exact: cameraId } } : { facingMode: { ideal: 'environment' } }
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { ...camera, width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: 24 } },
          })
        } catch (err) {
          if (err.name !== 'OverconstrainedError') throw err
          stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: camera })
        }
        if (cancelled) { stop(); return }
        const track = stream.getVideoTracks()[0]
        trackRef.current = track
        video.srcObject = stream
        await video.play()
        if (cancelled) { stop(); return }
        const updateAspect = () => {
          if (!cancelled && video.videoWidth && video.videoHeight) setAspectRatio(video.videoWidth / video.videoHeight)
        }
        video.onresize = updateAspect
        updateAspect()
        setReady(true)
        const settings = track.getSettings()
        const capabilities = track.getCapabilities?.() || {}
        const zoomCap = capabilities.zoom
        if (zoomCap && zoomCap.max > zoomCap.min) {
          const min = zoomCap.min
          const max = Math.min(8, zoomCap.max)
          if (max > min) {
            setZoomRange({ min, max, step: zoomCap.step || 0.1 })
            setZoom(settings.zoom ?? min)
          }
        }
        setTorchAvailable(capabilities.torch === true || capabilities.torch?.includes?.(true) || false)
        const modes = capabilities.focusMode || []
        setFocusAvailable(modes.includes('single-shot') || modes.includes('continuous'))
        const distance = capabilities.focusDistance
        if (modes.includes('manual') && distance?.max > distance?.min) {
          setFocusRange(distance)
          setFocusDistance(settings.focusDistance ?? distance.min)
        }
        if (modes.includes('continuous')) {
          try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }) } catch { /* Optional. */ }
        }
        if (cancelled) { stop(); return }
        decoder = createQRDecoder()
        let frame = 0
        const scan = async () => {
          if (cancelled || handled) return
          try {
            if (!photoBusyRef.current && !document.hidden && video.readyState >= 2 && video.videoWidth) {
              // Alternate native-detail crops with a full-frame pass. Crops keep
              // small modules intact and suppress distracting label text.
              const fraction = [0.4, 0.75, 1][frame++ % 3]
              const region = scanRegion(video.videoWidth, video.videoHeight, scanPointRef.current, fraction)
              const image = captureRegion(video, canvas, region, fraction === 1 ? 2560 : 2048)
              const text = await decoder.decode(image, fraction !== 1)
              if (!photoBusyRef.current) session.finish(text)
            }
          } catch {
            if (!cancelled && !handled) {
              stop()
              setReady(false)
              setError('The QR reader could not run. Reopen the scanner or use a photo.')
              return
            }
          }
          if (!cancelled && !handled) timer = setTimeout(scan, 180)
        }
        void scan()
        try {
          const devices = await navigator.mediaDevices.enumerateDevices()
          if (!cancelled) setCameras(devices.filter((device) => device.kind === 'videoinput' && device.deviceId))
        } catch { /* Camera switching is optional. */ }
      } catch (err) {
        stop()
        if (cancelled) return
        setReady(false)
        const name = String(err?.name || err || '')
        if (name.includes('NotAllowed') || name.includes('Permission')) {
          setError('Camera permission was denied. Allow camera access, use a photo, or enter the serial number manually.')
        } else if (name.includes('NotFound') || name.includes('Devices')) {
          setError('No camera available. Use a photo or enter the serial number manually.')
        } else {
          setError("Couldn't open this camera. Try another camera, use a photo, or enter the serial number manually.")
        }
      }
    })
    lifecycleRef.current = start.catch(() => {})
    return () => {
      cancelled = true
      stop()
      video.onresize = null
      clearTimeout(focusTimerRef.current)
      clearTimeout(focusResetRef.current)
      focusRequestRef.current += 1
      trackRef.current = null
      if (sessionRef.current === session) sessionRef.current = null
      lifecycleRef.current = start.catch(() => {}).then(stop)
    }
  }, [cameraId, attempt])

  const adjustZoom = async (direction) => {
    const track = trackRef.current
    if (!zoomRange || !track || !ready) return
    const value = zoom + direction * 0.5
    const steps = Math.round((value - zoomRange.min) / zoomRange.step)
    const next = Math.min(zoomRange.max, Math.max(zoomRange.min, zoomRange.min + steps * zoomRange.step))
    try {
      await track.applyConstraints({ advanced: [{ zoom: next }] })
      if (trackRef.current === track) setZoom(track.getSettings().zoom ?? zoom)
    } catch {
      setNotice('This camera could not change zoom. Try another lens or use a photo.')
    }
  }

  const toggleTorch = async () => {
    const track = trackRef.current
    if (!track || !ready) return
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn }] })
      if (trackRef.current === track) setTorchOn(Boolean(track.getSettings().torch))
    } catch { setNotice('Flash is unavailable on this camera.') }
  }

  const focusAt = async (event) => {
    const track = trackRef.current
    if (!track || !ready) return
    const element = event.currentTarget
    const rect = element.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left - element.clientLeft) / element.clientWidth))
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top - element.clientTop) / element.clientHeight))
    scanPointRef.current = { x, y }
    const request = ++focusRequestRef.current
    clearTimeout(focusTimerRef.current)
    clearTimeout(focusResetRef.current)
    setFocusPoint({ x, y, id: request })
    focusTimerRef.current = setTimeout(() => setFocusPoint(null), 3000)
    setNotice('Reading the area you tapped. Keep the whole QR visible and hold steady.')
    if (!focusAvailable) {
      setNotice('Reading the tapped area. Lens focus is automatic in this browser; if blurry, move back or use a close-up photo.')
      return
    }
    try {
      const modes = track.getCapabilities?.().focusMode || []
      const mode = modes.includes('single-shot') ? 'single-shot' : 'continuous'
      await track.applyConstraints({ advanced: [{ focusMode: mode, pointsOfInterest: [{ x, y }] }] })
      if (trackRef.current !== track || request !== focusRequestRef.current) return
      if (track.getSettings().focusMode !== mode) {
        setNotice('Reading the tapped area. This browser did not apply lens focus; move back or use a photo if blurry.')
        return
      }
      setManualFocus(false)
      setNotice('Focus requested. Hold steady while the label becomes sharp.')
      if (mode === 'single-shot' && modes.includes('continuous')) {
        focusResetRef.current = setTimeout(() => {
          if (trackRef.current === track && request === focusRequestRef.current) {
            track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {})
          }
        }, 1800)
      }
    } catch { setNotice('Reading the tapped area. Lens focus could not be adjusted; try another camera or a photo.') }
  }

  const changeFocus = async (value) => {
    const track = trackRef.current
    if (!track || !ready) return
    ++focusRequestRef.current
    clearTimeout(focusResetRef.current)
    try {
      await track.applyConstraints({ advanced: [{ focusMode: 'manual', focusDistance: value }] })
      if (trackRef.current !== track) return
      const settings = track.getSettings()
      if (settings.focusMode !== 'manual') throw new Error('Manual focus ignored')
      setManualFocus(true)
      setFocusDistance(settings.focusDistance ?? value)
    } catch { setNotice('Manual focus is unavailable on this camera. Try another camera or use a photo.') }
  }

  const decodePhoto = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || photoBusyRef.current) return
    const session = sessionRef.current
    if (!session) return
    photoBusyRef.current = true
    setPhotoBusy(true)
    clearTimeout(focusResetRef.current)
    const url = URL.createObjectURL(file)
    let decoder
    try {
      const image = new Image()
      image.src = url
      await image.decode()
      if (!mountedRef.current || sessionRef.current !== session) return
      decoder = createQRDecoder()
      photoDecoderRef.current = decoder
      const canvas = document.createElement('canvas')
      const width = image.naturalWidth
      const height = image.naturalHeight
      const regions = [scanRegion(width, height)]
      // Overlapping native-detail tiles also find tiny off-centre QR codes.
      for (const y of [0.25, 0.5, 0.75]) {
        for (const x of [0.25, 0.5, 0.75]) regions.push(scanRegion(width, height, { x, y }, 0.6))
      }
      for (const region of regions) {
        if (!mountedRef.current || sessionRef.current !== session) return
        const text = await decoder.decode(captureRegion(image, canvas, region, 3200), true)
        if (text) { session.finish(text); return }
      }
      setNotice('No QR found in this photo. Take a sharper close-up with the entire code visible, or enter the serial manually.')
    } catch {
      if (mountedRef.current && sessionRef.current === session) {
        setNotice('Could not read that photo. Try another clear close-up or enter the serial manually.')
      }
    } finally {
      decoder?.close()
      photoDecoderRef.current = null
      URL.revokeObjectURL(url)
      photoBusyRef.current = false
      if (mountedRef.current) setPhotoBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] bg-zinc-950/95 flex flex-col">
      <div className="flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <p className="text-white text-[15px] font-semibold">Scan product QR code</p>
        <div className="flex items-center gap-1">
          {ready && torchAvailable && (
            <button
              type="button"
              className={`p-2.5 rounded-xl transition ${torchOn ? 'bg-amber-400 text-zinc-950' : 'text-zinc-300 hover:bg-white/10'}`}
              onClick={toggleTorch}
              aria-label={torchOn ? 'Turn flash off' : 'Turn flash on'}
            >
              <Flashlight size={19} />
            </button>
          )}
          <button
            type="button"
            className="p-2.5 rounded-xl text-zinc-300 hover:bg-white/10"
            onClick={() => {
              onClose('cancelled')
            }}
            aria-label="Close scanner"
          >
            <X size={20} />
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center px-3 pb-5">
        <div className="my-auto shrink-0 w-full" style={{ width: 'min(94vw, 520px)' }}>
          {error && (
            <div className="card bg-white p-6 text-center">
              <div className="mx-auto w-12 h-12 rounded-2xl bg-zinc-100 grid place-items-center text-zinc-500">
                <CameraOff size={22} />
              </div>
              <p className="mt-4 text-sm font-semibold text-zinc-900">Scanner unavailable</p>
              <p className="mt-1 text-[13px] text-zinc-500">{error}</p>
              <button type="button" className="btn mt-4 w-full" disabled={photoBusy} onClick={() => setAttempt((current) => current + 1)}>Retry camera</button>
              <button type="button" className="btn mt-2 w-full" onClick={() => { onClose('cancelled') }}>
                Enter manually
              </button>
            </div>
          )}
          <div
            style={{ aspectRatio }}
            className={`${error ? 'hidden' : ''} qr-scanner-frame relative rounded-3xl overflow-hidden border-4 border-accent bg-black`}
            onClick={focusAt}
          >
            <video ref={videoRef} autoPlay muted playsInline className="qr-camera-video" />
            {focusPoint && (
              <span
                key={focusPoint.id}
                className="pointer-events-none absolute z-10 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-2xl border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
                style={{ left: `${focusPoint.x * 100}%`, top: `${focusPoint.y * 100}%` }}
              />
            )}
            {ready && zoomRange && (
              <div
                className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/70 p-1.5 backdrop-blur"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  className="grid h-8 w-8 place-items-center rounded-full text-white hover:bg-white/15 disabled:opacity-35"
                  onClick={() => adjustZoom(-1)}
                  disabled={zoom <= zoomRange.min}
                  aria-label="Zoom out"
                >
                  <Minus size={16} />
                </button>
                <span className="min-w-10 text-center text-[12px] font-semibold text-white">{zoom.toFixed(1)}×</span>
                <button
                  type="button"
                  className="grid h-8 w-8 place-items-center rounded-full text-white hover:bg-white/15 disabled:opacity-35"
                  onClick={() => adjustZoom(1)}
                  disabled={zoom >= zoomRange.max}
                  aria-label="Zoom in"
                >
                  <Plus size={16} />
                </button>
              </div>
            )}
          </div>
          {cameras.length > 1 && (
            <label className="mt-3 block text-xs text-zinc-300">
              Camera
              <select
                aria-label="Camera"
                className="mt-1 w-full rounded-xl bg-zinc-800 p-2.5 text-white"
                value={cameraId}
                disabled={photoBusy}
                onChange={(event) => { setNotice(''); setCameraId(event.target.value) }}
              >
                <option value="">Automatic rear camera</option>
                {cameras.map((camera, index) => (
                  <option key={camera.deviceId} value={camera.deviceId}>{camera.label || `Camera ${index + 1}`}</option>
                ))}
              </select>
              <span className="mt-1 block text-zinc-400">For close labels, try the main or ultra-wide rear lens. Extra zoom can blur the code.</span>
            </label>
          )}
          {ready && focusRange && (
            <label className="mt-3 block text-xs text-zinc-300">
              {manualFocus ? 'Manual focus — slide until the QR is sharp' : 'Blurry? Adjust focus manually'}
              <input
                type="range"
                aria-label="Manual focus distance"
                className="mt-2 w-full"
                min={focusRange.min}
                max={focusRange.max}
                step={focusRange.step || (focusRange.max - focusRange.min) / 100}
                value={focusDistance}
                onChange={(event) => changeFocus(Number(event.target.value))}
              />
            </label>
          )}
          <div className="mt-4 rounded-2xl bg-white/10 px-4 py-3 text-center">
            <p className="text-[14px] font-medium text-white">
              {photoBusy ? 'Reading photo…' : ready ? (focusAvailable ? 'Tap the QR to focus and read' : 'Tap the QR to read that area') : error ? 'Try a photo of the label' : 'Opening camera…'}
            </p>
            <p className="mt-1 text-[12px] text-zinc-400">
              Keep the whole QR visible. If blurry, move back and use +. For tiny labels, try another rear camera or take a close-up photo.
            </p>
            {notice && <p role="status" className="mt-2 text-xs text-amber-200">{notice}</p>}
            <button
              type="button"
              className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50"
              onClick={() => fileInputRef.current?.click()}
              disabled={photoBusy}
            >
              <Camera size={14} />
              {photoBusy ? 'Reading photo…' : 'Take close-up photo'}
            </button>
          </div>
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        aria-label="Take or choose a QR photo"
        capture="environment"
        className="hidden"
        onChange={decodePhoto}
      />
    </div>
  )
}
