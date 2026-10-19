import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Clock, FileText, MapPin, Phone } from 'lucide-react'
import api from '../api/client.js'
import { EmptyState, SkeletonRows, formatDate, formatDateTime } from '../components/ui.jsx'

function dateKey(value) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default function Assignments() {
  const [items, setItems] = useState(null)
  const [segment, setSegment] = useState('all')

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

  const allItems = items || []
  const pendingCount = allItems.filter((a) => !a.reportFiled).length
  const filedCount = allItems.length - pendingCount
  const visible = allItems.filter((a) => {
    if (segment === 'pending') return !a.reportFiled
    if (segment === 'filed') return a.reportFiled
    return true
  })

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">My assignments</h1>
        <p className="text-[13px] text-zinc-500 mt-0.5">File the report from here so it is linked to the assigned visit.</p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {[
          ['all', `All (${allItems.length})`],
          ['pending', `Pending report (${pendingCount})`],
          ['filed', `Report filed (${filedCount})`],
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
        <EmptyState
          title={segment === 'pending' ? 'Nothing pending' : segment === 'filed' ? 'No reports filed yet' : 'No assignments'}
          hint="Assigned visits will appear here with the customer's details."
        />
      ) : (
        <div className="space-y-2.5">
          {visible.map((a) => (
            <div key={String(a._id)} className="card p-4">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-semibold text-zinc-900">{a.customerName}</p>
                {a.reportFiled ? (
                  <span className="chip chip-strong inline-flex items-center gap-1"><CheckCircle2 size={11} /> Report filed</span>
                ) : (
                  <span className="chip chip-open inline-flex items-center gap-1"><Clock size={11} /> Report pending</span>
                )}
                {a.serviceRecord?.tokenNo ? (
                  <span className="text-[11px] font-mono text-zinc-400">{a.serviceRecord.tokenNo}</span>
                ) : null}
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
                {a.reportFiled && a.serviceRecord?._id ? (
                  <Link to={`/records/${a.serviceRecord._id}`} className="btn btn-sm btn-outline">
                    <FileText size={14} />
                    View report
                  </Link>
                ) : (
                  <Link
                    to={`/new?assignmentId=${a._id}&visitDate=${dateKey(a.visitDate)}`}
                    className="btn btn-sm"
                  >
                    <FileText size={14} />
                    File report
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
