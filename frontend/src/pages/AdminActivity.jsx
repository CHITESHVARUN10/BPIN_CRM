import { useCallback, useEffect, useState } from 'react'
import { BellRing } from 'lucide-react'
import api from '../api/client.js'
import { EmptyState, SkeletonRows, formatDateTime } from '../components/ui.jsx'
import { useToast } from '../context/ToastContext.jsx'

export default function AdminActivity() {
  const push = useToast().push
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [items, setItems] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null)

  const load = useCallback(async (d = date) => {
    setLoading(true)
    try {
      const res = await api.get('/reports/activity', { params: { date: d } })
      setItems(res.data.items)
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => {
    load(date)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date])

  const inactive = items?.filter((i) => i.active && i.count === 0) || []

  const nudge = async (userIds, message) => {
    setBusy(userIds.length ? `${userIds.length}` : 'all')
    try {
      const res = await api.post('/notifications/remind', { userIds: userIds.length ? userIds : undefined, allInactive: userIds.length ? undefined : true, date })
      push(`${message} — reminders sent: ${res.data.sent}`)
    } catch (err) {
      push(err.response?.data?.message || 'Could not send reminders', 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Activity</h1>
          <p className="text-[13px] text-zinc-500 mt-0.5">Who filed a report on this date</p>
        </div>
        <div className="flex gap-2 items-center">
          <input type="date" className="input !min-h-[40px] !w-auto text-[13px]" value={date} onChange={(e) => setDate(e.target.value)} />
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy !== null || inactive.length === 0 || !items}
            onClick={() => nudge([], 'All inactive engineers')}
          >
            <BellRing size={14} />
            {busy === 'all' ? 'Sending…' : `Nudge all inactive${inactive.length ? ` (${inactive.length})` : ''}`}
          </button>
        </div>
      </div>

      {loading ? (
        <SkeletonRows rows={6} className="h-14" />
      ) : !items || items.length === 0 ? (
        <EmptyState title="No technicians" hint="Create technician accounts to see activity here." />
      ) : (
        <div className="grid sm:grid-cols-2 gap-2.5">
          {items.map((i) => (
            <div key={String(i.userId)} className="card p-4 flex items-center gap-3">
              <div
                className={`w-2 h-2 rounded-full shrink-0 ${
                  i.count > 0 ? 'bg-green-600' : i.active ? 'bg-red-500' : 'bg-zinc-300'
                }`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-zinc-900 truncate">{i.name}</p>
                <p className="text-[12px] text-zinc-500 truncate">{i.region || i.email}</p>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  {i.count > 0 ? (i.lastAt ? `Last report · ${formatDateTime(i.lastAt)}` : `${i.count} today`) : 'No submission today'}
                </p>
              </div>
              {i.count > 0 ? (
                <span className="chip tabular-nums">{i.count}</span>
              ) : i.active ? (
                <button
                  type="button"
                  className="btn btn-sm btn-outline shrink-0"
                  disabled={busy !== null}
                  onClick={() => nudge([i.userId], i.name)}
                >
                  {busy === String(i.userId) ? 'Sending…' : 'Nudge'}
                </button>
              ) : (
                <span className="chip">Inactive</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
