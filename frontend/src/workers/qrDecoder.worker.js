import { prepareZXingModule } from 'zxing-wasm/reader'
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'
import { decodeQR } from '../utils/qrDecodeCore.js'

prepareZXingModule({ overrides: { locateFile: (path) => path.endsWith('.wasm') ? wasmUrl : path } })

self.onmessage = async ({ data: { id, image, enhance } }) => {
  try {
    self.postMessage({ id, ...await decodeQR(image, enhance) })
  } catch (error) {
    self.postMessage({ id, error: String(error?.message || error) })
  }
}
