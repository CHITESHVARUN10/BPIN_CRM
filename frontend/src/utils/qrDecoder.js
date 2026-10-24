// All camera/photo pixels stay on this device. The decoder and WASM are served
// with the app, including on browsers without the native BarcodeDetector API.
export function createQRDecoder() {
  const worker = new Worker(new URL('../workers/qrDecoder.worker.js', import.meta.url), { type: 'module' })
  let sequence = 0
  let closed = false
  const pending = new Map()
  worker.onmessage = ({ data }) => {
    const request = pending.get(data.id)
    if (!request) return
    clearTimeout(request.timer)
    pending.delete(data.id)
    if (data.error) request.reject(new Error(data.error))
    else request.resolve({ text: data.text || '', candidate: data.candidate || null })
  }
  worker.onerror = () => close(new Error('QR decoder could not load. Please reopen the scanner.'))
  function close(error = new Error('Scanner closed')) {
    closed = true
    worker.terminate()
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    pending.clear()
  }
  return {
    inspect(image, enhance = false) {
      if (closed) return Promise.reject(new Error('Scanner closed'))
      const id = ++sequence
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => close(new Error('QR decoder timed out. Please reopen the scanner.')), 20000)
        pending.set(id, { resolve, reject, timer })
        worker.postMessage({ id, image, enhance }, [image.data.buffer])
      })
    },
    decode(image, enhance = false) {
      return this.inspect(image, enhance).then((result) => result.text)
    },
    close,
  }
}

// A tap selects a native-resolution region, even when lens focus isn't exposed
// by the browser. Never enlarge a small preview and call it higher resolution.
export function scanRegion(width, height, point = { x: 0.5, y: 0.5 }, fraction = 1) {
  if (fraction === 1) return { x: 0, y: 0, width, height }
  const edge = Math.max(1, Math.round(Math.min(width, height) * fraction))
  return {
    x: Math.round(Math.max(0, Math.min(width - edge, point.x * width - edge / 2))),
    y: Math.round(Math.max(0, Math.min(height - edge, point.y * height - edge / 2))),
    width: edge,
    height: edge,
  }
}

export function captureRegion(source, canvas, region, maxEdge = 2560) {
  const scale = Math.min(1, maxEdge / Math.max(region.width, region.height))
  canvas.width = Math.max(1, Math.round(region.width * scale))
  canvas.height = Math.max(1, Math.round(region.height * scale))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.drawImage(source, region.x, region.y, region.width, region.height, 0, 0, canvas.width, canvas.height)
  return context.getImageData(0, 0, canvas.width, canvas.height)
}
