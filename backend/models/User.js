import mongoose from 'mongoose'
import passportLocalMongoose from 'passport-local-mongoose'

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    region: { type: String, trim: true },
    role: { type: String, enum: ['technician', 'admin'], default: 'technician' },
    superAdmin: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
)

// Fields any authenticated admin may read; mutations restricted in routes
userSchema.set('toJSON', {
  transform: (doc, ret, options) => {
    if (ret) {
      delete ret.salt
      delete ret.hash
      delete ret.attempts
      delete ret.last
    }
    return ret
  },
})

userSchema.plugin(passportLocalMongoose, {
  usernameField: 'email',
  usernameUnique: false,
  errorMessages: {
    UserExistsError: 'An account with this email already exists',
  },
})

export default mongoose.model('User', userSchema)
