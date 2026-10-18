// Local drill runner: calls the real API handlers in-process, in the same
// way Vercel would (start, then worker ticks until the run finishes).
//
// Usage (inside backup-cron/):
//   npm run local                  # starts a run and works it to completion
//   npm run local -- --retry=<id>  # revive a failed run instead of starting one
//
// Requires a .env file (see .env.example). With DRIVE_LOCAL_DIR set, the
// "Drive" side is mirrored to a local folder — no Google credentials needed.

import 'dotenv/config'
import startHandler from '../api/start.js'
import workHandler from '../api/work.js'

const secret = process.env.CRON_SECRET || ''
const maxTicks = Number(process.env.LOCAL_MAX_TICKS || 200)
const arg = process.argv.find((a) => a.startsWith('--retry='))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function call(handler, url) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code
        return this
      },
      json(body) {
        resolve({ code: this.statusCode, body })
        return this
      },
    }
    Promise.resolve(handler({ method: 'GET', url, headers: { authorization: `Bearer ${secret}` } }, res)).catch(reject)
  })
}

const started = await call(startHandler, arg ? `/api/start?retry=${arg.slice(8)}` : '/api/start?force=1')
console.log('[start]', JSON.stringify(started.body))
if (started.code >= 400) process.exit(1)

let lastStatus = null
for (let tick = 1; tick <= maxTicks; tick++) {
  const out = await call(workHandler, '/api/work')
  console.log(`[work ${tick}]`, JSON.stringify(out.body))
  if (out.code >= 400) process.exit(1)
  const status = out.body?.status
  lastStatus = status
  if (status !== 'running' && status !== 'busy' && status !== 'started') break
  await sleep(status === 'busy' ? 2000 : 300)
}

console.log('[done] final status:', lastStatus)
process.exit(0)

