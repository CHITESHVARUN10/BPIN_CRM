import { connect } from './db.js'
import { notifyUser, audit } from './notify.js'
import { cleanupStagedMedia } from './media.js'

const DAY_MS = 24 * 60 * 60 * 1000
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

// The cron runs at 12:00 IST (06:30 UTC). Assignment dates are saved from a
// date input as UTC midnight, so use the IST calendar day to choose them.
function istDayBounds(now) {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS)
  const start = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - IST_OFFSET_MS,
  )
  return { start, end: new Date(start.getTime() + DAY_MS) }
}

function dateLabel(value) {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value))
}

export async function sendDailyAssignmentReminders({ now = new Date() } = {}) {
  const db = await connect()
  const { start, end } = istDayBounds(now)

  const candidates = await db
    .collection('assignments')
    .find({
      visitDate: { $gte: start, $lt: end },
      serviceRecord: null,
      $or: [{ lastReminderAt: null }, { lastReminderAt: { $lt: start } }],
    })
    .toArray()

  let sent = 0
  let skipped = 0

  for (const assignment of candidates) {
    // Claim the reminder atomically so duplicate cron deliveries cannot send
    // two notifications for the same assignment on the same day.
    const claim = await db.collection('assignments').updateOne(
      {
        _id: assignment._id,
        serviceRecord: null,
        $or: [{ lastReminderAt: null }, { lastReminderAt: { $lt: start } }],
      },
      { $set: { lastReminderAt: now, updatedAt: now } },
    )
    if (claim.modifiedCount !== 1) {
      skipped += 1
      continue
    }

    const engineer = await db
      .collection('users')
      .findOne({ _id: assignment.assignedTo }, { projection: { name: 1, active: 1 } })
    if (!engineer) {
      skipped += 1
      continue
    }

    const day = dateLabel(assignment.visitDate)
    const title = 'Assessment report pending'
    const body = `${assignment.customerName} · ${day} · ${assignment.timing}. Please file the service report.`

    await notifyUser(db, assignment.assignedTo, { title, body })
    await audit(db, {
      action: 'assignment_report_missing',
      targetId: assignment._id,
      targetLabel: `${assignment.customerName} → ${engineer.name}`,
      detail: `No report filed for ${day} · ${assignment.timing}`,
      actorName: 'Daily assignment check',
      targetKind: 'assignment',
    })
    sent += 1
  }

  let mediaCleanup
  try {
    mediaCleanup = await cleanupStagedMedia(db, { now })
  } catch (err) {
    mediaCleanup = { error: err?.message || 'media cleanup failed' }
  }

  return {
    status: 'ok',
    date: dateLabel(now),
    checked: candidates.length,
    sent,
    skipped,
    mediaCleanup,
  }
}
