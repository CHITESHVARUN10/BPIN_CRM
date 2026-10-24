import { readBarcodes } from 'zxing-wasm/reader'

const options = {
  formats: ['QRCode'],
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
  // Failed checksums still provide useful finder geometry, NEVER usable text.
  returnErrors: true,
  maxNumberOfSymbols: 4,
}

function validText(results) {
  return results.find((result) => result.isValid && !result.error)?.text || ''
}

function bounds(result, width, height) {
  const points = Object.values(result.position || {})
  if (points.length !== 4 || points.some(({ x, y }) => !Number.isFinite(x) || !Number.isFinite(y))) return null
  const x = Math.max(0, Math.min(...points.map((p) => p.x)))
  const y = Math.max(0, Math.min(...points.map((p) => p.y)))
  const right = Math.min(width, Math.max(...points.map((p) => p.x)))
  const bottom = Math.min(height, Math.max(...points.map((p) => p.y)))
  const w = right - x
  const h = bottom - y
  // Reject line-like false detections before allocating a recovery crop.
  if (Math.min(w, h) < 12 || Math.max(w, h) / Math.min(w, h) > 2) return null
  return { x, y, width: w, height: h }
}

function crop(image, box) {
  const padding = Math.max(8, Math.ceil(Math.max(box.width, box.height) * 0.2))
  const x = Math.max(0, Math.floor(box.x - padding))
  const y = Math.max(0, Math.floor(box.y - padding))
  const width = Math.min(image.width - x, Math.ceil(box.x + box.width + padding) - x)
  const height = Math.min(image.height - y, Math.ceil(box.y + box.height + padding) - y)
  const data = new Uint8ClampedArray(width * height * 4)
  for (let row = 0; row < height; row++) {
    const start = ((y + row) * image.width + x) * 4
    data.set(image.data.subarray(start, start + width * 4), row * width * 4)
  }
  return { data, width, height }
}

// Interpolation gives the detector more sampling positions for subpixel finder
// edges. It does not invent detail, and any result must still pass QR ECC.
function enlarge(image, factor) {
  const width = image.width * factor
  const height = image.height * factor
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    const sy = Math.max(0, Math.min(image.height - 1, (y + 0.5) / factor - 0.5))
    const y0 = Math.floor(sy)
    const y1 = Math.min(image.height - 1, y0 + 1)
    const fy = sy - y0
    for (let x = 0; x < width; x++) {
      const sx = Math.max(0, Math.min(image.width - 1, (x + 0.5) / factor - 0.5))
      const x0 = Math.floor(sx)
      const x1 = Math.min(image.width - 1, x0 + 1)
      const fx = sx - x0
      const target = (y * width + x) * 4
      for (let c = 0; c < 3; c++) {
        const top = image.data[(y0 * image.width + x0) * 4 + c] * (1 - fx) + image.data[(y0 * image.width + x1) * 4 + c] * fx
        const bottom = image.data[(y1 * image.width + x0) * 4 + c] * (1 - fx) + image.data[(y1 * image.width + x1) * 4 + c] * fx
        data[target + c] = top * (1 - fy) + bottom * fy
      }
      data[target + 3] = 255
    }
  }
  return { data, width, height }
}

function thresholdVariants(image) {
  const grey = new Uint8Array(image.width * image.height)
  const histogram = new Uint32Array(256)
  for (let i = 0; i < grey.length; i++) {
    grey[i] = Math.round(0.299 * image.data[i * 4] + 0.587 * image.data[i * 4 + 1] + 0.114 * image.data[i * 4 + 2])
    histogram[grey[i]]++
  }
  const percentile = (fraction) => {
    let count = 0
    for (let value = 0; value < 256; value++) {
      count += histogram[value]
      if (count >= grey.length * fraction) return value
    }
    return 255
  }
  const dark = percentile(0.05)
  const light = percentile(0.95)
  if (light - dark < 24) return []
  // A label's paper/ink levels matter more than the surrounding metal or text.
  return Array.from({ length: 19 }, (_, index) => 0.5 + index * 0.025).map((fraction) => () => {
    const threshold = dark + (light - dark) * fraction
    const data = new Uint8ClampedArray(image.data.length)
    for (let i = 0; i < grey.length; i++) {
      const value = grey[i] > threshold ? 255 : 0
      data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = value
      data[i * 4 + 3] = 255
    }
    return { data, width: image.width, height: image.height }
  })
}

function sharpen(image) {
  const { width, height, data } = image
  const output = new Uint8ClampedArray(data)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = (y * width + x) * 4
      for (let c = 0; c < 3; c++) {
        const neighbours = (data[i - 4 + c] + data[i + 4 + c] + data[i - width * 4 + c] + data[i + width * 4 + c]) / 4
        output[i + c] = data[i + c] + 0.8 * (data[i + c] - neighbours)
      }
    }
  }
  return { data: output, width, height }
}

export async function decodeQR(image, enhance = false) {
  const results = await readBarcodes(image, options)
  let text = validText(results)
  if (text) return { text, candidate: null }
  // Keep the normal path cheap. Full-frame passes also recover located codes,
  // so an off-centre small label doesn't depend on the user tapping exactly.
  if (enhance || results.length) {
    results.push(...await readBarcodes(image, { ...options, binarizer: 'GlobalHistogram' }))
    text = validText(results)
    if (text) return { text, candidate: null }
  }
  // Preserve the soft-frame fallback when finder patterns themselves are hard
  // to locate. Recovery below will still use the original pixels.
  if (enhance && !results.some((result) => bounds(result, image.width, image.height))) {
    results.push(...await readBarcodes(sharpen(image), { ...options, tryDenoise: true }))
    text = validText(results)
    if (text) return { text, candidate: null }
  }
  const candidates = []
  for (const result of results) {
    const box = bounds(result, image.width, image.height)
    if (!box || Math.max(box.width, box.height) > 900) continue
    if (candidates.some((other) => Math.hypot(other.x - box.x, other.y - box.y) < Math.min(box.width, box.height) * 0.3)) continue
    candidates.push(box)
  }
  for (const box of candidates.slice(0, 2)) {
    const detail = crop(image, box)
    if (Math.max(detail.width, detail.height) <= 600) {
      for (const factor of [2, 3]) {
        const enlarged = enlarge(detail, factor)
        for (const binarizer of ['LocalAverage', 'GlobalHistogram']) {
          text = validText(await readBarcodes(enlarged, { ...options, binarizer, tryDownscale: false }))
          if (text) return { text, candidate: null }
        }
      }
    }
    for (const variant of thresholdVariants(detail)) {
      text = validText(await readBarcodes(variant(), { ...options, tryDownscale: false }))
      if (text) return { text, candidate: null }
    }
  }
  const box = candidates[0]
  return {
    text: '',
    candidate: box ? {
      x: box.x / image.width,
      y: box.y / image.height,
      width: box.width / image.width,
      height: box.height / image.height,
    } : null,
  }
}
