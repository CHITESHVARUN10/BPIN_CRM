import passport from 'passport'
import User from './models/User.js'

export function initPassport() {
  passport.use(User.createStrategy())
  passport.serializeUser(User.serializeUser())
  passport.deserializeUser(User.deserializeUser())
}
