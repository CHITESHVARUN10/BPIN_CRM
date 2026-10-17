import mongoose from 'mongoose'

const problemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true },
)

export default mongoose.model('Problem', problemSchema)
