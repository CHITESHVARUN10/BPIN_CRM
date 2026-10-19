import AuditLog from '../models/AuditLog.js'

export async function logAudit(actor, action, { kind, id, label } = {}, detail = '') {
  try {
    await AuditLog.create({
      actor: actor?._id,
      actorRole: actor?.role,
      actorName: actor?.name,
      action,
      targetKind: kind,
      targetId: id ? String(id) : undefined,
      targetLabel: label,
      detail,
    })
  } catch {
    // logging must never break the real operation
  }
}

export const ACTIONS = {
  userCreated: 'user_created',
  userUpdated: 'user_updated',
  userPasswordReset: 'user_password_reset',
  caseCreated: 'case_created',
  caseEdited: 'case_edited',
  caseClosed: 'case_closed',
  caseReopened: 'case_reopened',
  productCreated: 'product_created',
  productUpdated: 'product_updated',
  assignmentCreated: 'assignment_created',
  assignmentUpdated: 'assignment_updated',
  problemCreated: 'problem_created',
  problemUpdated: 'problem_updated',
}
