import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
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
  const scannerRef = useRef(null)
  const sessionRef = useRef(null)
  const lifecycleRef = useRef(Promise.resolve())
  const frameRef = useRef(null)
  const fileInputRef = useRef(null)
  const focusTimerRef = useRef(null)
  const focusResetRef = useRef(null)
  const focusRequestRef = useRef(0)
  const mountedRef = useRef(false)

  useEffect(() => {
    onResultRef.current = onResult
  }, [onResult])

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    // html5-qrcode decodes at the element's layout resolution, not videoWidth.
    // Keep a 1920px surface and scale only its presentation down to the phone.
    const frame = frameRef.current
    const observer = new ResizeObserver(() => {
      frame.style.setProperty('--qr-preview-scale', frame.clientWidth / 1920)
    })
    observer.observe(frame)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let cancelled = false
    let scanner
    let closing
    let handled = false
    const session = {
      photo: false,
      finish(text) {
        const value = text?.trim()
        if (cancelled || handled || !value) return
        handled = true
        void stopCamera()
        onResultRef.current?.(value)
      },
      stop: () => stopCamera(),
    }
    const stopCamera = () => {
      if (!scanner) return Promise.resolve()
      if (!closing) {
        closing = (async () => {
          try {
            if (scanner.isScanning) await scanner.stop()
          } catch {
            // A scan result can arrive while camera startup is completing.
          }
          try { scanner.clear() } catch { /* Already cleared. */ }
        })()
      }
      return closing
    }

    // Serialize startup/teardown, including StrictMode and camera changes.
    const start = lifecycleRef.current.then(async () => {
      if (cancelled) return
      setReady(false)
      setError(null)
      setNotice('')
      setZoomRange(null)
      setTorchAvailable(false)
      setTorchOn(false)
      setFocusAvailable(false)
      setFocusRange(null)
      setManualFocus(false)
      setFocusPoint(null)
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setError('Camera needs HTTPS (or localhost). Use a photo or enter the serial number manually.')
        return
      }
      scanner = new Html5Qrcode('qr-scan-box', {
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        verbose: false,
      })
      scannerRef.current = scanner
      sessionRef.current = session
      try {
        await scanner.start(
          cameraId || { facingMode: 'environment' },
          {
            fps: 8,
            disableFlip: true,
            // Scan the whole frame, retaining detail and accepting off-centre labels.
            videoConstraints: {
              ...(cameraId ? { deviceId: { exact: cameraId } } : { facingMode: { ideal: 'environment' } }),
              width: { ideal: 3840 },
              height: { ideal: 2160 },
              frameRate: { ideal: 24, max: 30 },
            },
          },
          (text) => { if (!session.photo) session.finish(text) },
          () => {},
        )
        if (cancelled || handled) { await stopCamera(); return }
        const video = document.querySelector('#qr-scan-box video')
        if (video?.videoWidth && video.videoHeight) setAspectRatio(video.videoWidth / video.videoHeight)
        setReady(true)
        // These capabilities are optional; an unsupported control must not fail startup.
        const settings = scanner.getRunningTrackSettings()
        let capabilities = {}
        try { capabilities = scanner.getRunningTrackCapabilities() } catch { /* Older Safari. */ }
        const zoomCap = capabilities.zoom
        if (zoomCap && zoomCap.max > zoomCap.min) {
          const min = zoomCap.min
          const max = Math.min(8, zoomCap.max)
          if (max > min) {
            setZoomRange({ min, max, step: Math.max(0.1, zoomCap.step || 0.1) })
            setZoom(Number.isFinite(settings.zoom) ? settings.zoom : min)
          }
        }
        setTorchAvailable(Boolean(capabilities.torch))
        const modes = capabilities.focusMode || []
        setFocusAvailable(modes.includes('single-shot') || modes.includes('continuous'))
        const distance = capabilities.focusDistance
        if (modes.includes('manual') && distance?.max > distance?.min) {
          setFocusRange(distance)
          setFocusDistance(settings.focusDistance ?? distance.min)
        }
        if (modes.includes('continuous')) {
          try { await scanner.applyVideoConstraints({ advanced: [{ focusMode: 'continuous' }] }) } catch { /* Optional. */ }
        }
        try {
          const devices = await navigator.mediaDevices.enumerateDevices()
          if (!cancelled) setCameras(devices.filter((device) => device.kind === 'videoinput'))
        } catch { /* Camera switching is optional. */ }
      } catch (err) {
        if (cancelled) return
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
      clearTimeout(focusTimerRef.current)
      clearTimeout(focusResetRef.current)
      focusRequestRef.current += 1
      if (sessionRef.current === session) sessionRef.current = null
      if (scannerRef.current === scanner) scannerRef.current = null
      lifecycleRef.current = start.catch(() => {}).then(stopCamera)
    }
  }, [cameraId, attempt])

  const adjustZoom = async (direction) => {
    const scanner = scannerRef.current
    if (!zoomRange || !scanner || !ready) return
    const next = Math.min(zoomRange.max, Math.max(zoomRange.min, Number((zoom + direction * 0.5).toFixed(2))))
    try {
      await scanner.applyVideoConstraints({ advanced: [{ zoom: next }] })
      if (scannerRef.current === scanner) setZoom(scanner.getRunningTrackSettings().zoom ?? zoom)
    } catch {
      setNotice('This camera could not change zoom. Try another lens or use a photo.')
    }
  }

  const toggleTorch = async () => {
    const scanner = scannerRef.current
    if (!scanner || !ready) return
    try {
      const next = !torchOn
      await scanner.applyVideoConstraints({ advanced: [{ torch: next }] })
      if (scannerRef.current === scanner) setTorchOn(Boolean(scanner.getRunningTrackSettings().torch))
    } catch {
      setNotice('Flash is unavailable on this camera.')
    }
  }

  const focusAt = async (event) => {
    const scanner = scannerRef.current
    if (!scanner || !ready || !focusAvailable) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left - event.currentTarget.clientLeft) / event.currentTarget.clientWidth))
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top - event.currentTarget.clientTop) / event.currentTarget.clientHeight))
    const request = ++focusRequestRef.current
    clearTimeout(focusTimerRef.current)
    clearTimeout(focusResetRef.current)
    try {
      const capabilities = scanner.getRunningTrackCapabilities()
      const modes = capabilities.focusMode || []
      const mode = modes.includes('single-shot') ? 'single-shot' : 'continuous'
      // Request the advertised mode only. Browsers may silently ignore advanced constraints.
      await scanner.applyVideoConstraints({ advanced: [{ focusMode: mode, pointsOfInterest: [{ x, y }] }] })
      if (scannerRef.current !== scanner || request !== focusRequestRef.current) return
      const settings = scanner.getRunningTrackSettings()
      if (settings.focusMode !== mode) {
        setNotice('Tap focus is unavailable here. Move back, try another camera, or use a photo.')
        return
      }
      setManualFocus(false)
      setFocusPoint({ x, y, id: request })
      setNotice('Focus requested. Hold steady while the label becomes sharp.')
      focusTimerRef.current = setTimeout(() => setFocusPoint(null), 1200)
      if (mode === 'single-shot' && modes.includes('continuous')) {
        focusResetRef.current = setTimeout(() => {
          if (scannerRef.current === scanner && request === focusRequestRef.current) {
            scanner.applyVideoConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {})
          }
        }, 1800)
      }
    } catch {
      setNotice('This browser cannot refocus this camera. Try another camera or use a photo.')
    }
  }

  const changeFocus = async (value) => {
    const scanner = scannerRef.current
    if (!scanner || !ready) return
    ++focusRequestRef.current
    clearTimeout(focusResetRef.current)
    try {
      await scanner.applyVideoConstraints({ advanced: [{ focusMode: 'manual', focusDistance: value }] })
      if (scannerRef.current !== scanner) return
      const settings = scanner.getRunningTrackSettings()
      if (settings.focusMode !== 'manual') throw new Error('Manual focus ignored')
      setManualFocus(true)
      setFocusDistance(settings.focusDistance ?? value)
    } catch {
      setNotice('Manual focus is unavailable on this camera. Try another camera or use a photo.')
    }
  }

  const decodePhoto = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || photoBusy) return
    const session = sessionRef.current
    if (!session) return
    session.photo = true
    setPhotoBusy(true)
    setReady(false)
    clearTimeout(focusResetRef.current)
    // Use a separate, hidden decoder so photo errors never remove the camera surface.
    const target = document.createElement('div')
    target.id = `qr-photo-${Date.now()}`
    target.hidden = true
    document.body.appendChild(target)
    const decoder = new Html5Qrcode(target.id, { formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE], verbose: false })
    try {
      await session.stop()
      const result = await decoder.scanFileV2(file, false)
      if (!result?.decodedText?.trim()) throw new Error('No QR code found')
      session.finish(result.decodedText)
    } catch {
      if (mountedRef.current && sessionRef.current === session) {
        setAttempt((current) => current + 1)
        setNotice('No QR found. Try a sharper photo with the code filling more of the picture.')
      }
    } finally {
      decoder.clear()
      target.remove()
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
      <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center px-3 pb-5">
        <div className="w-full" style={{ width: 'min(94vw, 520px)' }}>
          {error && (
            <div className="card bg-white p-6 text-center">
              <div className="mx-auto w-12 h-12 rounded-2xl bg-zinc-100 grid place-items-center text-zinc-500">
                <CameraOff size={22} />
              </div>
              <p className="mt-4 text-sm font-semibold text-zinc-900">Scanner unavailable</p>
              <p className="mt-1 text-[13px] text-zinc-500">{error}</p>
              <button type="button" className="btn mt-5 w-full" onClick={() => { onClose('cancelled') }}>
                Enter manually
              </button>
            </div>
          )}
            <div
              ref={frameRef}
              style={{ aspectRatio }}
              className={`${error ? 'hidden' : ''} qr-scanner-frame relative rounded-3xl overflow-hidden border-4 border-accent bg-black`}
              onClick={focusAt}
            >
              <div className="qr-scan-scale">
                <div id="qr-scan-box" className="qr-scan-box" />
              </div>
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
                onChange={(event) => setCameraId(event.target.value)}
              >
                <option value="">Automatic rear camera</option>
                {cameras.map((camera, index) => (
                  <option key={camera.deviceId} value={camera.deviceId}>{camera.label || `Camera ${index + 1}`}</option>
                ))}
              </select>
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
              {photoBusy ? 'Reading photo…' : ready ? (focusAvailable ? 'Tap the QR code to refocus' : 'Hold steady while the camera focuses') : error ? 'Try a photo of the label' : 'Opening camera…'}
            </p>
            <p className="mt-1 text-[12px] text-zinc-400">
              Keep the whole QR visible. If blurry, move back and use +. For tiny labels, try another rear camera or take a close-up photo.
            </p>
            {notice && <p role="status" className="mt-2 text-xs text-amber-200">{notice}</p>}
            <button
              type="button"
              className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-medium text-accent hover:text-white disabled:opacity-50"
              onClick={() => fileInputRef.current?.click()}
              disabled={photoBusy}
            >
              <Camera size={14} />
              {photoBusy ? 'Reading photo…' : 'Use a photo instead'}
            </button>
          </div>
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={decodePhoto}
      />
    </div>
  )
}
