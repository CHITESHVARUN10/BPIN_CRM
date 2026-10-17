import mongoose from 'mongoose'

const auditLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    actorRole: { type: String },
    actorName: { type: String, trim: true },
    action: { type: String, required: true, index: true },
    targetKind: { type: String },
    targetId: { type: String },
    targetLabel: { type: String, trim: true },
    detail: { type: String, trim: true },
  },
  { timestamps: true },
)

auditLogSchema.index({ createdAt: -1 })

export default mongoose.model('AuditLog', auditLogSchema)
