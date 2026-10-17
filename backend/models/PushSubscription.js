import mongoose from 'mongoose'

const pushSubscriptionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    endpoint: { type: String, required: true, unique: true },
    keys: {
      purl: { type: String, required: true },
      auth: { type: String, required: true },
    },
  },
  { timestamps: true },
)

export default mongoose.model('PushSubscription', pushSubscriptionSchema)
