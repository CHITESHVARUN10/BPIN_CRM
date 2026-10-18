import { assertConfigured, isAuthorized } from '../lib/env.js'
import { runWorker } from '../lib/backup.js'

export default async function handler(req, res) {
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' })

  try {
    assertConfigured()
    return res.status(200).json(await runWorker())
  } catch (err) {
    console.error('[backup/work] failed:', err)
    return res.status(500).json({ error: err?.message || 'worker failed' })
  }
}
