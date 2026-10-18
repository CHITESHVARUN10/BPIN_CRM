import { Readable, Transform } from 'node:stream'
import { createGzip } from 'node:zlib'
import { createHash } from 'node:crypto'

// Streaming NDJSON dump of one collection: cursor -> JSONL -> gzip.
// Bytes/sha256 are measured on the gzip stream (i.e. of the exact file that
// lands in Drive), so the manifest checksums describe the stored artifact.

export function countedTransform() {
  const hash = createHash('sha256')
  let bytes = 0
  let digest = null
  const transform = new Transform({
    transform(chunk, _enc, cb) {
      hash.update(chunk)
      bytes += chunk.length
      cb(null, chunk)
    },
  })
  return {
    transform,
    stats() {
      if (!digest) digest = hash.digest('hex')
      return { bytes, sha256: digest }
    },
  }
}

export function dumpCollectionStream(db, name) {
  let docs = 0
  const cursor = db.collection(name).find({}, { batchSize: 500 })
  const source = Readable.from(
    (async function* generate() {
      for await (const doc of cursor) {
        docs += 1
        yield `${JSON.stringify(doc)}\n`
      }
    })(),
  )
  const stream = source.pipe(createGzip())
  return { stream, docs: () => docs }
}
