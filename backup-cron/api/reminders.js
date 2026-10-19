import { isAuthorized } from '../lib/env.js'
import { sendDailyAssignmentReminders } from '../lib/reminders.js'

export default async function handler(req, res) {
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' })

  try {
    return res.status(200).json(await sendDailyAssignmentReminders())
  } catch (err) {
    console.error('[reminders] failed:', err)
    return res.status(500).json({ error: err?.message || 'reminder check failed' })
  }
}
