import { useCallback, useEffect, useState } from 'react'
import { Check, Clock, MapPin, Phone } from 'lucide-react'
import api from '../api/client.js'
import { EmptyState, SkeletonRows, formatDateTime, formatDate } from '../components/ui.jsx'
import { useToast } from '../context/ToastContext.jsx'

export default function Assignments() {
  const push = useToast().push
  const [items, setItems] = useState(null)
  const [segment, setSegment] = useState('all')
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    try {
      const res = await api.get('/assignments/my')
      setItems(res.data.items)
    } catch {
      setItems([])
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const markDone = async (a) => {
    setBusyId(String(a._id))
    try {
      await api.patch(`/assignments/${a._id}/status`, { status: 'done' })
      push(`Visit to ${a.customerName} marked done`)
      load()
    } catch (err) {
      push(err.response?.data?.message || 'Could not update', 'error')
    } finally {
      setBusyId(null)
    }
  }

  const visible = items?.filter((i) => (segment === 'all' ? true : i.status === segment)) || []

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">My assignments</h1>
        <p className="text-[13px] text-zinc-500 mt-0.5">Handed out by the admin team — customer, address and timing</p>
      </div>

      <div className="flex gap-1.5">
        {[
          ['all', 'All'],
          ['pending', 'Pending'],
          ['done', 'Done'],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setSegment(key)}
            className={`btn btn-sm ${segment === key ? '' : 'btn-outline'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {items === null ? (
        <SkeletonRows rows={4} className="h-14" />
      ) : visible.length === 0 ? (
        <EmptyState title={segment === 'pending' ? 'Nothing pending' : 'No assignments'} hint="Assigned visits will appear here with the customer's details." />
      ) : (
        <div className="space-y-2.5">
          {visible.map((a) => (
            <div key={String(a._id)} className="card p-4">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-semibold text-zinc-900">{a.customerName}</p>
                {a.status === 'done' ? <span className="chip chip-strong">Done</span> : <span className="chip chip-open">Pending</span>}
              </div>
              <a href={`tel:${a.customerPhone}`} className="link-accent mt-1 inline-flex items-center gap-1.5 text-[13px] font-medium">
                <Phone size={13} />
                {a.customerPhone}
              </a>
              <p className="mt-2 text-[13px] text-zinc-700 whitespace-pre-line flex gap-1.5">
                <MapPin size={14} className="text-zinc-400 shrink-0 mt-0.5" />
                <span className="min-w-0">{a.address}{a.pincode ? `, ${a.pincode}` : ''}</span>
              </p>
              <p className="mt-1.5 text-[13px] text-zinc-700 flex items-center gap-1.5">
                <Clock size={14} className="text-zinc-400 shrink-0" />
                {formatDate(a.visitDate)} · {a.timing}
              </p>
              {a.notes ? <p className="mt-2 text-[12.5px] text-zinc-500 bg-zinc-50 border border-zinc-100 rounded-xl p-2.5">{a.notes}</p> : null}
              <div className="divider my-3" />
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] text-zinc-400">By {a.assignedBy?.name || 'Admin'} · {formatDateTime(a.createdAt)}</p>
                {a.status === 'pending' ? (
                  <button type="button" className="btn btn-sm" disabled={busyId === String(a._id)} onClick={() => markDone(a)}>
                    {busyId === String(a._id) ? 'Saving…' : (
                      <>
                        <Check size={14} />
                        Mark done
                      </>
                    )}
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
