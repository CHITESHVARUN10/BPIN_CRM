import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import jpeg from 'jpeg-js'
import { prepareZXingModule as prepareReader, readBarcodes } from 'zxing-wasm/reader'
import { prepareZXingModule as prepareWriter, writeBarcode } from 'zxing-wasm/writer'
import { decodeQR } from '../src/utils/qrDecodeCore.js'
import { applyCameraControls } from '../src/utils/qrCamera.js'

const require = createRequire(import.meta.url)
prepareReader({ overrides: { wasmBinary: readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm')) } })
prepareWriter({ overrides: { wasmBinary: readFileSync(require.resolve('zxing-wasm/writer/zxing_writer.wasm')) } })

function blank(width, height) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) }
}

function paste(target, source, x, y) {
  for (let row = 0; row < source.height; row++) {
    target.data.set(source.data.subarray(row * source.width * 4, (row + 1) * source.width * 4), ((y + row) * target.width + x) * 4)
  }
}

function rotate(image) {
  const result = blank(image.height, image.width)
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const from = (y * image.width + x) * 4
      const to = (x * result.width + image.height - 1 - y) * 4
      result.data.set(image.data.subarray(from, from + 4), to)
    }
  }
  return result
}

async function makeQR(text, scale) {
  const { symbol } = await writeBarcode(text, { format: 'QRCode' })
  const image = blank((symbol.width + 8) * scale, (symbol.height + 8) * scale)
  for (let y = 0; y < symbol.height * scale; y++) {
    for (let x = 0; x < symbol.width * scale; x++) {
      const value = symbol.data[Math.floor(y / scale) * symbol.width + Math.floor(x / scale)]
      const index = ((y + 4 * scale) * image.width + x + 4 * scale) * 4
      image.data[index] = image.data[index + 1] = image.data[index + 2] = value
    }
  }
  return image
}

test('small and large QR codes decode with their actual payload, including a 4K off-centre label', async () => {
  for (const scale of [2, 12]) {
    const text = `BPIN-REGRESSION-${scale}-X91`
    const code = await makeQR(text, scale)
    const frame = blank(3840, 2160)
    paste(frame, code, 80, 350)
    assert.equal((await decodeQR(frame)).text, text)
  }
})

test('blank frames and a damaged QR never populate a serial from failed checksum text', async () => {
  assert.equal((await decodeQR(blank(640, 480), true)).text, '')
  const code = await makeQR('UNREADABLE-TEST-842', 4)
  // Destroy the data area, leaving the three finder patterns in place.
  for (let y = 12 * 4; y < code.height - 4 * 4; y++) {
    for (let x = 12 * 4; x < code.width - 4 * 4; x++) {
      const index = (y * code.width + x) * 4
      code.data[index] = code.data[index + 1] = code.data[index + 2] = 255
    }
  }
  assert.equal((await decodeQR(code, true)).text, '')
})

const stickerPath = new URL('../../assets/WhatsApp Image 2026-10-24 at 11.04.42 (1).jpeg', import.meta.url)
// These are intentionally local, gitignored reference images. CI still runs
// generated-code and camera tests when the user's photos aren't available.
test('real tiny sticker: recover a checksum failure without a manually supplied crop', { skip: !existsSync(stickerPath) }, async () => {
  const image = jpeg.decode(readFileSync(stickerPath), { useTArray: true })
  const oldResult = await readBarcodes(image, { formats: ['QRCode'], tryHarder: true, returnErrors: true })
  assert.ok(oldResult.some((result) => result.error), 'fixture exercises a located but unreadable QR')
  assert.ok(!oldResult.some((result) => result.isValid))
  const expected = '23W4G223E2601201367'
  assert.equal((await decodeQR(image)).text, expected)
  assert.equal((await decodeQR(rotate(image))).text, expected)
  for (const change of [(value) => value * 0.6, (value) => 90 + value * 0.5]) {
    const data = Uint8ClampedArray.from(image.data, (value, index) => index % 4 === 3 ? 255 : change(value))
    assert.equal((await decodeQR({ ...image, data }, true)).text, expected)
  }
  const frame = blank(3840, 2160)
  paste(frame, image, 50, 300)
  assert.equal((await decodeQR(frame)).text, expected)
})

test('focus and zoom preserve camera selection, resolution, frame rate, and other controls', async () => {
  let constraints = {
    deviceId: { exact: 'rear-main' }, width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: 24 },
  }
  const original = structuredClone(constraints)
  const track = {
    getConstraints: () => structuredClone(constraints),
    applyConstraints: async (next) => { constraints = next },
  }
  await applyCameraControls(track, { zoom: 2.5, torch: true })
  await applyCameraControls(track, { focusMode: 'manual', focusDistance: 3 })
  await applyCameraControls(track, { focusMode: 'continuous', pointsOfInterest: [{ x: 0.3, y: 0.6 }] })
  for (const key of Object.keys(original)) assert.deepEqual(constraints[key], original[key])
  assert.equal(constraints.advanced[0].zoom, 2.5)
  assert.equal(constraints.advanced[0].torch, true)
  assert.equal(constraints.advanced[0].focusMode, 'continuous')
  assert.ok(!('focusDistance' in constraints.advanced[0]), 'manual distance must not prevent autofocus')
})
