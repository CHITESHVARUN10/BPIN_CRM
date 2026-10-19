import passport from 'passport'
import User from './models/User.js'

// passport-local-mongoose serializes the username field (email) into the
// session and deserializes it via findByUsername. Keep that behaviour, but
// retry briefly: during recovery the users collection is replaced via a
// temp-collection rename, and a request that lands in that window would
// otherwise fail to deserialize — after which Passport deletes the session's
// authenticated user and logs the operator out for good.
const DESERIALIZE_RETRIES = 3
const DESERIALIZE_DELAY_MS = 100

const findByUsername = (username) =>
  new Promise((resolve, reject) => {
    User.findByUsername(username, (err, user) => (err ? reject(err) : resolve(user)))
  })

export function initPassport() {
  passport.use(User.createStrategy())
  passport.serializeUser(User.serializeUser())
  passport.deserializeUser(async (username, done) => {
    for (let attempt = 0; attempt <= DESERIALIZE_RETRIES; attempt += 1) {
      try {
        const user = await findByUsername(username)
        if (user) return done(null, user)
      } catch (err) {
        return done(err)
      }
      if (attempt < DESERIALIZE_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, DESERIALIZE_DELAY_MS))
      }
    }
    return done(null, false)
  })
}
