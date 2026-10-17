import webpush from 'web-push'
import PushSubscription from '../models/PushSubscription.js'

const configured = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)

if (configured) {
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@blaupunktcar.in', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY)
}

export function pushEnabled() {
  return configured
}

export async function sendToUser(userId, payload) {
  if (!configured) return 0
  const subs = await PushSubscription.find({ user: userId })
  let sent = 0
  for (const sub of subs) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.purl, auth: sub.keys.auth } }, JSON.stringify(payload))
      sent++
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) await sub.deleteOne()
    }
  }
  return sent
}
