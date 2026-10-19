import mongoose from 'mongoose'

const assignmentSchema = new mongoose.Schema(
  {
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    customerName: { type: String, required: true, trim: true },
    customerPhone: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
    pincode: { type: String, trim: true },
    visitDate: { type: Date, required: true },
    timing: { type: String, required: true, trim: true },
    notes: { type: String, trim: true },
    status: { type: String, enum: ['pending', 'done'], default: 'pending' },
    doneAt: { type: Date, default: null },
    serviceRecord: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceRecord', default: null },
    lastReminderAt: { type: Date, default: null },
  },
  { timestamps: true },
)

assignmentSchema.index({ assignedTo: 1, visitDate: -1 })
assignmentSchema.index({ visitDate: 1, serviceRecord: 1 })

export default mongoose.model('Assignment', assignmentSchema)
