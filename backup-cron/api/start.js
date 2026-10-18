import { assertConfigured, isAuthorized } from '../lib/env.js'
import { startRun, retryRun } from '../lib/backup.js'

export default async function handler(req, res) {
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' })

  try {
    assertConfigured()
    const url = new URL(req.url, 'http://internal')
    const retry = url.searchParams.get('retry')
    if (retry) return res.status(200).json(await retryRun(retry))
    const result = await startRun({ source: url.searchParams.get('force') === '1' ? 'manual' : 'cron' })
    return res.status(result.started ? 200 : 202).json(result)
  } catch (err) {
    console.error('[backup/start] failed:', err)
    return res.status(500).json({ error: err?.message || 'start failed' })
  }
}
