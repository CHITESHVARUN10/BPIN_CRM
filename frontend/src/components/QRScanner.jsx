import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { CameraOff, X } from 'lucide-react'

export default function QRScanner({ onResult, onClose }) {
  const [error, setError] = useState(null)
  const scannerRef = useRef(null)
  const stoppedRef = useRef(false)

  useEffect(() => {
    // Browsers only expose getUserMedia on HTTPS or localhost — fail fast with a clear message.
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError('Camera needs HTTPS (or localhost). On this link, please enter the serial number manually.')
      return undefined
    }

    const scanner = new Html5Qrcode('qr-scan-box')
    scannerRef.current = scanner
    let timer = null

    const stop = () => {
      if (stoppedRef.current) return
      stoppedRef.current = true
      clearTimeout(timer)
      try {
        scanner
          .stop()
          .then(() => scanner.clear())
          .catch(() => {})
      } catch {
        // scanner already stopped (e.g. StrictMode double-mount)
      }
    }

    startScanner()

    function startScanner() {
      scanner
        .start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (text) => {
            stop()
            onResult(text.trim())
          },
          () => {},
        )
        .catch((err) => {
          if (stoppedRef.current) return
          const name = String(err?.name || err || '')
          if (name.includes('NotAllowed') || name.includes('Permission')) {
            setError('Camera permission was denied. Allow camera access, or enter the serial number manually.')
          } else if (name.includes('NotFound') || name.includes('Devices')) {
            setError('No camera available on this device. Enter the serial number manually.')
          } else {
            setError("Couldn't open the camera. Enter the serial number manually.")
          }
        })
    }

    timer = setTimeout(() => {
      if (!stoppedRef.current) {
        stop()
        setError("Couldn't scan. Point steadily at the QR code, or enter it manually.")
      }
    }, 20000)

    return () => stop()
  }, [onResult])

  return (
    <div className="fixed inset-0 z-[80] bg-zinc-950/95 flex flex-col">
      <div className="flex items-center justify-between px-4 pt-4">
        <p className="text-white text-sm font-medium">Scan product QR code</p>
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
      <div className="flex-1 grid place-items-center px-4">
        <div className="w-full max-w-sm">
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
            <div className="rounded-3xl overflow-hidden border-4 border-accent bg-black">
              <div id="qr-scan-box" className="w-[264px] h-[264px]" />
            </div>
          )}
          <p className="mt-4 text-center text-[12.5px] text-zinc-400">Align the QR code inside the frame</p>
        </div>
      </div>
    </div>
  )
}
