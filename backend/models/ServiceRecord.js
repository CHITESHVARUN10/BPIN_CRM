import mongoose from 'mongoose'

const serviceRecordSchema = new mongoose.Schema(
  {
    tokenNo: { type: String, required: true, unique: true },
    technician: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    productSnapshot: {
      sku: { type: String, required: true },
      description: { type: String, required: true },
      category: { type: String },
    },
    serialNumber: { type: String, required: true, trim: true },
    customerReport: { type: String, required: true, trim: true },
    problem: {
      ref: { type: mongoose.Schema.Types.ObjectId, ref: 'Problem', default: null },
      name: { type: String, required: true, trim: true },
      isOther: { type: Boolean, default: false },
      otherDescription: { type: String, trim: true },
    },
    notes: { type: String, trim: true },
    vehicle: {
      make: { type: String, trim: true },
      model: { type: String, trim: true },
    },
    images: {
      type: [{ url: { type: String, required: true }, publicId: { type: String, required: true } }],
      validate: [(arr) => arr.length <= 4, 'Max 4 images'],
    },
    status: { type: String, enum: ['open', 'closed'], default: 'open' },
    closure: {
      type: {
        closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        closedByRole: { type: String, trim: true },
        closedByName: { type: String, trim: true },
        workDone: { type: String, trim: true },
        images: [{ url: { type: String, required: true }, publicId: { type: String, required: true } }],
        closedAt: { type: Date },
      },
      default: null,
    },
    followUps: [
      {
        customerReport: { type: String, trim: true },
        problem: {
          ref: { type: mongoose.Schema.Types.ObjectId, ref: 'Problem', default: null },
          name: { type: String, trim: true },
          isOther: { type: Boolean, default: false },
          otherDescription: { type: String, trim: true },
        },
        notes: { type: String, trim: true },
        images: [{ url: { type: String, required: true }, publicId: { type: String, required: true } }],
        closes: { type: Boolean, default: false },
        filedAt: { type: Date, default: Date.now },
      },
    ],
    visitDate: { type: Date, default: Date.now },
  },
  { timestamps: true },
)

serviceRecordSchema.index({ technician: 1, createdAt: -1 })
serviceRecordSchema.index({ 'productSnapshot.sku': 1, visitDate: -1 })
serviceRecordSchema.index({ visitDate: -1 })

export default mongoose.model('ServiceRecord', serviceRecordSchema)
