// In-app admin notifications + audit-log entries, written straight to the
// same Atlas database the backend uses (same shapes as the app's models).

export async function notifyAdmins(db, { title, body }) {
  const admins = await db.collection('users').find({ role: 'admin' }, { projection: { _id: 1 } }).toArray()
  if (!admins.length) return 0
  const now = new Date()
  await db.collection('notifications').insertMany(
    admins.map((a) => ({
      recipient: a._id,
      title,
      body,
      type: 'broadcast',
      readAt: null,
      createdAt: now,
      updatedAt: now,
    })),
  )
  return admins.length
}

export async function notifyUser(db, userId, { title, body, type = 'reminder' }) {
  const now = new Date()
  await db.collection('notifications').insertOne({
    recipient: userId,
    title,
    body,
    type,
    readAt: null,
    createdAt: now,
    updatedAt: now,
  })
}

export async function audit(db, { action, targetId, targetLabel, detail, actorName = 'Backup cron', targetKind = 'backup' }) {
  const now = new Date()
  await db.collection('auditlogs').insertOne({
    actor: null,
    actorRole: 'system',
    actorName,
    action,
    targetKind,
    targetId: targetId ? String(targetId) : undefined,
    targetLabel,
    detail,
    createdAt: now,
    updatedAt: now,
  })
}
