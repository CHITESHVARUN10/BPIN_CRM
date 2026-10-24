import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader'
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'

prepareZXingModule({ overrides: { locateFile: (path) => path.endsWith('.wasm') ? wasmUrl : path } })

const options = {
  formats: ['QRCode'],
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
  maxNumberOfSymbols: 1,
}

// A mild unsharp mask can help soft frames; it cannot restore missing modules.
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

self.onmessage = async ({ data: { id, image, enhance } }) => {
  try {
    let results = await readBarcodes(image, options)
    if (!results.some((result) => result.isValid) && enhance) {
      results = await readBarcodes(image, { ...options, binarizer: 'GlobalHistogram' })
      if (!results.some((result) => result.isValid)) {
        results = await readBarcodes(sharpen(image), { ...options, tryDenoise: true })
      }
    }
    self.postMessage({ id, text: results.find((result) => result.isValid)?.text || '' })
  } catch (error) {
    self.postMessage({ id, error: String(error?.message || error) })
  }
}
