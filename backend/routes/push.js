import { Router } from 'express'
import PushSubscription from '../models/PushSubscription.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

router.get('/vapid-public', requireAuth, (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null })
})

router.post('/subscription', requireAuth, async (req, res, next) => {
  try {
    const subscription = req.body?.subscription
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return res.status(400).json({ message: 'Invalid subscription' })
    }
    await PushSubscription.findOneAndUpdate(
      { endpoint: subscription.endpoint },
      { $set: { user: req.user._id, keys: { purl: subscription.keys.p256dh, auth: subscription.keys.auth } } },
      { upsert: true },
    )
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
