import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { Camera, CameraOff, Flashlight, Minus, Plus, X } from 'lucide-react'

export default function QRScanner({ onResult, onClose }) {
  const [error, setError] = useState(null)
  const [zoom, setZoom] = useState(1)
  const [zoomRange, setZoomRange] = useState(null)
  const [torchAvailable, setTorchAvailable] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [focusPoint, setFocusPoint] = useState(null)
  const onResultRef = useRef(onResult)
  const scannerRef = useRef(null)
  const fileInputRef = useRef(null)
  const focusTimerRef = useRef(null)

  useEffect(() => {
    onResultRef.current = onResult
  }, [onResult])

  useEffect(() => {
    // Browsers only expose getUserMedia on HTTPS or localhost — fail fast with a clear message.
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError('Camera needs HTTPS (or localhost). On this link, please enter the serial number manually.')
      return undefined
    }

    const scanner = new Html5Qrcode('qr-scan-box')
    scannerRef.current = scanner
    let timer = null
    let stopped = false
    let handled = false

    const stopCamera = () => {
      try {
        scanner.pause(true)
      } catch {
        // Scanner may not have reached the scanning state yet.
      }
      try {
        scanner
          .stop()
          .then(() => scanner.clear())
          .catch(() => {})
      } catch {
        // Scanner already stopped.
      }
    }

    const stop = () => {
      if (stopped) return
      stopped = true
      clearTimeout(timer)
      stopCamera()
    }

    scanner
      .start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: (viewfinderWidth, viewfinderHeight) => {
            const edge = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.86)
            return { width: edge, height: edge }
          },
          videoConstraints: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1440 },
            height: { ideal: 1080 },
            aspectRatio: { ideal: 4 / 3 },
            advanced: [{ focusMode: 'continuous' }],
          },
        },
        (text) => {
          if (stopped || handled) return
          handled = true
          stop()
          onResultRef.current?.(text.trim())
        },
        () => {},
      )
      .then(() => {
        // StrictMode can unmount while camera startup is still pending.
        if (stopped) {
          stopCamera()
          return
        }
        try {
          const capabilities = scanner.getRunningTrackCapabilities()
          const settings = scanner.getRunningTrackSettings()
          const zoomCap = capabilities?.zoom
          if (
            zoomCap &&
            Number.isFinite(zoomCap.min) &&
            Number.isFinite(zoomCap.max) &&
            zoomCap.max > zoomCap.min
          ) {
            const min = Math.max(1, zoomCap.min)
            const max = Math.min(4, zoomCap.max)
            if (max > min) {
              const current = Number(settings?.zoom)
              setZoomRange({ min, max, step: Number(zoomCap.step) || 0.5 })
              setZoom(Math.min(max, Math.max(min, Number.isFinite(current) ? current : min)))
            }
          }
          const torch = scanner.getRunningTrackCameraCapabilities?.().torchFeature?.()
          setTorchAvailable(Boolean(torch?.isSupported?.()))
        } catch {
          // Zoom and torch are optional browser capabilities.
        }
      })
      .catch((err) => {
        if (stopped) return
        const name = String(err?.name || err || '')
        if (name.includes('NotAllowed') || name.includes('Permission')) {
          setError('Camera permission was denied. Allow camera access, or enter the serial number manually.')
        } else if (name.includes('NotFound') || name.includes('Devices')) {
          setError('No camera available on this device. Enter the serial number manually.')
        } else {
          setError("Couldn't open the camera. Enter the serial number manually.")
        }
      })

    timer = setTimeout(() => {
      if (!stopped && !handled) {
        stop()
        setError("Couldn't scan. Point steadily at the QR code, or enter it manually.")
      }
    }, 20000)

    return () => {
      clearTimeout(focusTimerRef.current)
      if (scannerRef.current === scanner) scannerRef.current = null
      stop()
    }
  }, [])

  const adjustZoom = async (direction) => {
    if (!zoomRange || !scannerRef.current) return
    const next = Math.min(
      zoomRange.max,
      Math.max(zoomRange.min, Number((zoom + direction * zoomRange.step).toFixed(2))),
    )
    setZoom(next)
    try {
      await scannerRef.current.applyVideoConstraints({ advanced: [{ zoom: next }] })
    } catch {
      // Zoom is best-effort on browsers that expose it.
    }
  }

  const toggleTorch = async () => {
    const scanner = scannerRef.current
    if (!scanner) return
    try {
      const torch = scanner.getRunningTrackCameraCapabilities().torchFeature()
      const next = !torchOn
      await torch.apply(next)
      setTorchOn(next)
    } catch {
      // Torch is best-effort on browsers that expose it.
    }
  }

  const focusAt = async (event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
    setFocusPoint({ x, y, id: Date.now() })
    clearTimeout(focusTimerRef.current)
    focusTimerRef.current = setTimeout(() => setFocusPoint(null), 1100)

    const scanner = scannerRef.current
    if (!scanner) return
    try {
      await scanner.applyVideoConstraints({
        advanced: [{ focusMode: 'single-shot', pointsOfInterest: [{ x, y }] }],
      })
    } catch {
      try {
        await scanner.applyVideoConstraints({
          advanced: [{ focusMode: 'continuous', pointsOfInterest: [{ x, y }] }],
        })
      } catch {
        // Focus control is best-effort on browsers that expose it.
      }
    }
    setTimeout(() => {
      try {
        scanner.applyVideoConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {})
      } catch {
        // Scanner may have closed after the tap.
      }
    }, 1400)
  }

  const decodePhoto = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !scannerRef.current) return
    setPhotoBusy(true)
    try {
      const scanner = scannerRef.current
      try {
        await scanner.stop()
      } catch {
        // Camera may already be stopped.
      }
      try {
        scanner.clear()
      } catch {
        // Clearing an already-empty scan region is harmless.
      }
      const result = await scanner.scanFileV2(file, false)
      const text = result?.decodedText?.trim()
      if (!text) throw new Error('No QR code found')
      onResultRef.current?.(text)
    } catch {
      setError('No QR code was found in that photo. Try again with the code filling the photo, or enter it manually.')
    } finally {
      setPhotoBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] bg-zinc-950/95 flex flex-col">
      <div className="flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <p className="text-white text-[15px] font-semibold">Scan product QR code</p>
        <div className="flex items-center gap-1">
          {torchAvailable && (
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
      <div className="flex-1 flex flex-col items-center justify-center px-3 pb-5">
        <div className="w-full" style={{ width: 'min(94vw, 520px)' }}>
          {error ? (
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
          ) : (
            <div
              className="qr-scanner-frame relative rounded-3xl overflow-hidden border-4 border-accent bg-black aspect-[4/3]"
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
              {zoomRange && (
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
          )}
          <div className="mt-4 rounded-2xl bg-white/10 px-4 py-3 text-center">
            <p className="text-[14px] font-medium text-white">Tap the label to focus</p>
            <p className="mt-1 text-[12px] text-zinc-400">
              Align the QR code with the frame. Too close and blurry? Move back; use + if it appears.
            </p>
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
