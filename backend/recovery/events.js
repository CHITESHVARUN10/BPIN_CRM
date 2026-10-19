import { logAudit } from '../utils/log.js'

// Durable recovery audit. Lives in `recovery_events`, which is never part of
// backup dumps or DB restores, so restoration history survives rollbacks.
// Mirrored into the normal audit log so admins see it in the Logs page.

export async function recoveryEvent(db, event) {
  const {
    actor,
    action,
    checkpointId = null,
    operationId = null,
    mode = null,
    result = 'ok',
    detail = '',
    ip = null,
    userAgent = null,
  } = event || {}

  try {
    await db.collection('recovery_events').insertOne({
      at: new Date(),
      actor: actor
        ? { id: String(actor._id), name: actor.name || null, email: actor.email || null, role: actor.role || null }
        : null,
      action,
      checkpointId: checkpointId ? String(checkpointId) : null,
      operationId: operationId ? String(operationId) : null,
      mode,
      result,
      detail: String(detail || '').slice(0, 2000),
      ip: ip ? String(ip).slice(0, 64) : null,
      userAgent: userAgent ? String(userAgent).slice(0, 200) : null,
    })
  } catch {
    // event logging must never break the operation
  }

  try {
    await logAudit(
      actor ? { _id: actor._id, role: actor.role, name: actor.name } : null,
      `recovery_${action}`,
      { kind: 'recovery', id: operationId || checkpointId, label: checkpointId || '' },
      detail,
    )
  } catch {
    // mirroring is best-effort
  }
}
