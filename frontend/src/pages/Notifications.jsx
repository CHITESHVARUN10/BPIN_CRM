import { useEffect, useState } from 'react'
import { BellOff } from 'lucide-react'
import api from '../api/client.js'
import { EmptyState, SkeletonRows, PushEnable, formatDateTime } from '../components/ui.jsx'
import { useNotifications } from '../context/NotificationsContext.jsx'

export default function Notifications() {
  const { items, markRead } = useNotifications()
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'granted') {
      api.get('/push/vapid-public').catch(() => {})
    }
  }, [])

  const open = async (n) => {
    if (busyId) return
    if (!n.readAt) {
      setBusyId(n._id)
      try {
        await markRead(n._id)
      } catch {
        // already read or gone
      }
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Notifications</h1>
        <p className="text-[13px] text-zinc-500 mt-0.5">Reminders from the admin team</p>
      </div>

      <PushEnable />

      <div>
        {items.length === 0 ? (
          <EmptyState icon={BellOff} title="Nothing yet" hint="You'll hear from us here when something needs your attention." />
        ) : (
          <div className="space-y-2">
            {items.map((n) => (
              <button
                key={n._id}
                type="button"
                onClick={() => open(n)}
                className={`card p-4 w-full text-left flex gap-3 items-start transition ${n.readAt ? 'opacity-60' : ''}`}
              >
                <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${n.readAt ? 'bg-zinc-200' : 'bg-zinc-900'}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-zinc-900">{n.title}</p>
                  {n.body ? <p className="mt-0.5 text-[13px] text-zinc-600">{n.body}</p> : null}
                  <p className="mt-1.5 text-[11px] text-zinc-400">{formatDateTime(n.createdAt)}</p>
                </div>
                <span className="chip capitalize shrink-0">{n.type}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
