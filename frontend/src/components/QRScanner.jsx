import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { CameraOff, X } from 'lucide-react'

export default function QRScanner({ onResult, onClose }) {
  const [error, setError] = useState(null)
  const onResultRef = useRef(onResult)

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
            const edge = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.72)
            return { width: edge, height: edge }
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
        if (stopped) stopCamera()
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

    return () => stop()
  }, [])

  return (
    <div className="fixed inset-0 z-[80] bg-zinc-950/95 flex flex-col">
      <div className="flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <p className="text-white text-[15px] font-semibold">Scan product QR code</p>
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
      <div className="flex-1 flex flex-col items-center justify-center px-3 pb-5">
        <div
          className="w-full"
          style={{ width: 'min(92vw, 430px, calc(100svh - 190px))' }}
        >
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
            <div className="qr-scanner-frame rounded-3xl overflow-hidden border-4 border-accent bg-black aspect-square">
              <div id="qr-scan-box" className="qr-scan-box" />
            </div>
          )}
          <div className="mt-4 rounded-2xl bg-white/10 px-4 py-3 text-center">
            <p className="text-[14px] font-medium text-white">Align the QR code with the frame</p>
            <p className="mt-1 text-[12px] text-zinc-400">Hold steady — scanning is automatic.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
