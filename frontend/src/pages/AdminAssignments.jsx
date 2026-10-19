import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Clock, FileText, MapPin, Phone, Search, X } from 'lucide-react'
import api from '../api/client.js'
import { EmptyState, SkeletonRows, formatDate, formatDateTime } from '../components/ui.jsx'
import { useToast } from '../context/ToastContext.jsx'

const emptyForm = { assignedTo: '', customerName: '', customerPhone: '', address: '', pincode: '', visitDate: '', timing: '', notes: '' }

function dateKey(value) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default function AdminAssignments() {
  const push = useToast().push
  const [items, setItems] = useState(null)
  const [techs, setTechs] = useState([])
  const [segment, setSegment] = useState('all')
  const [techFilter, setTechFilter] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [q, setQ] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [formErr, setFormErr] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await api.get('/assignments')
      setItems(res.data.items)
    } catch {
      setItems([])
    }
  }, [])

  useEffect(() => {
    api.get('/users').then((res) => setTechs(res.data.items.filter((u) => u.role === 'technician'))).catch(() => setTechs([]))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    setFormErr('')
    const clean = { ...form, customerName: form.customerName.trim(), customerPhone: form.customerPhone.trim(), address: form.address.trim(), timing: form.timing.trim() }
    if (!clean.assignedTo) return setFormErr('Select the technician')
    if (!clean.customerName || !clean.customerPhone || !clean.address || !clean.timing) return setFormErr('Customer name, phone, address and timing are required')
    if (!clean.visitDate) return setFormErr('Visit date is required')
    setSubmitting(true)
    try {
      await api.post('/assignments', clean)
      setForm(emptyForm)
      push('Assignment handed out — the engineer has been notified')
      load()
    } catch (err) {
      setFormErr(err.response?.data?.message || 'Could not create assignment')
    } finally {
      setSubmitting(false)
    }
  }

  const allItems = items || []
  const pendingCount = allItems.filter((a) => !a.reportFiled).length
  const filedCount = allItems.length - pendingCount

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return allItems.filter((a) => {
      if (segment === 'pending' && a.reportFiled) return false
      if (segment === 'filed' && !a.reportFiled) return false
      if (techFilter && String(a.assignedTo?._id || a.assignedTo) !== techFilter) return false
      if (dateFilter && dateKey(a.visitDate) !== dateFilter) return false
      if (needle) {
        const haystack = [a.customerName, a.customerPhone, a.address, a.assignedTo?.name].filter(Boolean).join(' ').toLowerCase()
        if (!haystack.includes(needle)) return false
      }
      return true
    })
  }, [allItems, segment, techFilter, dateFilter, q])

  const groups = useMemo(() => {
    const map = new Map()
    for (const assignment of visible) {
      const key = dateKey(assignment.visitDate)
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(assignment)
    }
    return [...map.entries()].sort(([a], [b]) => b.localeCompare(a))
  }, [visible])

  const hasFilters = Boolean(q || techFilter || dateFilter || segment !== 'all')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Assignments</h1>
        <p className="text-[13px] text-zinc-500 mt-0.5">Assign visits to engineers, then track which reports are still pending</p>
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="text-[13px] font-semibold uppercase tracking-wider text-zinc-500">Create assignment</h2>
          <p className="text-[12px] text-zinc-400 mt-0.5">Hand out a customer visit to an active service engineer.</p>
        </div>

        <form onSubmit={submit} className="card p-4 space-y-3.5">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-zinc-100 grid place-items-center text-zinc-600"><MapPin size={16} /></div>
            <h2 className="text-sm font-semibold text-zinc-900">Visit details</h2>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="label">Technician<span className="text-red-600 ml-0.5">*</span></label>
              <select className="input" value={form.assignedTo} onChange={(e) => set('assignedTo', e.target.value)}>
                <option value="">Select technician</option>
                {techs.map((t) => (
                  <option key={t._id} value={t._id}>{t.name}{t.region ? ` (${t.region})` : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Customer name<span className="text-red-600 ml-0.5">*</span></label>
              <input className="input" value={form.customerName} onChange={(e) => set('customerName', e.target.value)} />
            </div>
            <div>
              <label className="label">Customer phone<span className="text-red-600 ml-0.5">*</span></label>
              <input className="input" inputMode="tel" value={form.customerPhone} onChange={(e) => set('customerPhone', e.target.value)} />
            </div>
            <div>
              <label className="label">Pincode</label>
              <input className="input" inputMode="numeric" value={form.pincode} onChange={(e) => set('pincode', e.target.value)} />
            </div>
            <div>
              <label className="label">Address<span className="text-red-600 ml-0.5">*</span></label>
              <textarea className="input min-h-[64px] resize-none" value={form.address} onChange={(e) => set('address', e.target.value)} />
            </div>
            <div className="space-y-3">
              <div>
                <label className="label">Visit date<span className="text-red-600 ml-0.5">*</span></label>
                <input type="date" className="input" value={form.visitDate} onChange={(e) => set('visitDate', e.target.value)} />
              </div>
              <div>
                <label className="label">Timing<span className="text-red-600 ml-0.5">*</span></label>
                <input className="input" placeholder="e.g. 2:30 PM – 4:00 PM" value={form.timing} onChange={(e) => set('timing', e.target.value)} />
              </div>
            </div>
            <div className="md:col-span-2">
              <label className="label">Notes</label>
              <textarea className="input min-h-[56px] resize-none" placeholder="Product, complaint summary or special instructions…" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
            </div>
          </div>
          {formErr ? <p className="text-[13px] text-red-600">{formErr}</p> : null}
          <button type="submit" className="btn" disabled={submitting}>
            {submitting ? 'Handing out…' : 'Hand out to engineer'}
          </button>
        </form>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[13px] font-semibold uppercase tracking-wider text-zinc-500">Assignment tracker</h2>
            <p className="text-[12px] text-zinc-400 mt-0.5">
              Pending report means no service report is linked yet. Report filed means the engineer submitted the assessment.
            </p>
          </div>
          <div className="flex items-center gap-3 text-[11.5px] text-zinc-500">
            <span className="inline-flex items-center gap-1.5"><Clock size={13} /> {pendingCount} pending</span>
            <span className="inline-flex items-center gap-1.5"><CheckCircle2 size={13} /> {filedCount} filed</span>
          </div>
        </div>

        <div className="card p-3 space-y-3">
          <div className="grid gap-2 md:grid-cols-3">
            <div className="relative md:col-span-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                className="input !pl-9"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search customer, phone or engineer"
              />
            </div>
            <select className="input !min-h-[38px]" value={techFilter} onChange={(e) => setTechFilter(e.target.value)}>
              <option value="">All engineers</option>
              {techs.map((t) => (
                <option key={t._id} value={t._id}>{t.name}</option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <input
                type="date"
                className="input !min-h-[38px]"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                aria-label="Filter by visit date"
              />
              {dateFilter ? (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDateFilter('')} aria-label="Clear date">
                  <X size={14} />
                </button>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {[
              ['all', `All (${allItems.length})`],
              ['pending', `Pending report (${pendingCount})`],
              ['filed', `Report filed (${filedCount})`],
            ].map(([key, label]) => (
              <button key={key} type="button" onClick={() => setSegment(key)} className={`btn btn-sm ${segment === key ? '' : 'btn-outline'}`}>
                {label}
              </button>
            ))}
            {hasFilters ? (
              <button
                type="button"
                className="btn btn-sm btn-ghost ml-auto"
                onClick={() => {
                  setQ('')
                  setTechFilter('')
                  setDateFilter('')
                  setSegment('all')
                }}
              >
                Clear filters
              </button>
            ) : null}
          </div>
        </div>

        {items === null ? (
          <SkeletonRows rows={4} className="h-14" />
        ) : visible.length === 0 ? (
          <EmptyState
            title={hasFilters ? 'No assignments match' : 'No assignments yet'}
            hint={hasFilters ? 'Try clearing the filters or choosing another date.' : 'Use the create section above to hand out the first visit.'}
          />
        ) : (
          <div className="space-y-5">
            {groups.map(([date, rows]) => (
              <div key={date}>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{formatDate(rows[0].visitDate)}</p>
                  <span className="text-[11px] text-zinc-400">{rows.length} visit{rows.length === 1 ? '' : 's'}</span>
                </div>
                <div className="space-y-2.5">
                  {rows.map((a) => (
                    <div key={String(a._id)} className="card p-4">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-zinc-900">{a.customerName}</p>
                        {a.reportFiled ? (
                          <span className="chip chip-strong inline-flex items-center gap-1"><CheckCircle2 size={11} /> Report filed</span>
                        ) : (
                          <span className="chip chip-open inline-flex items-center gap-1"><Clock size={11} /> Report pending</span>
                        )}
                        <span className="text-[11px] text-zinc-400 ml-auto">To {a.assignedTo?.name || '—'}</span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-zinc-700">
                        <a href={`tel:${a.customerPhone}`} className="link-accent inline-flex items-center gap-1.5 font-medium">
                          <Phone size={13} /> {a.customerPhone}
                        </a>
                        <span className="inline-flex items-center gap-1.5"><Clock size={13} className="text-zinc-400" /> {formatDate(a.visitDate)} · {a.timing}</span>
                      </div>
                      <p className="mt-2 text-[13px] text-zinc-700 whitespace-pre-line">{a.address}{a.pincode ? `, ${a.pincode}` : ''}</p>
                      {a.notes ? <p className="mt-2 text-[12.5px] text-zinc-500 bg-zinc-50 border border-zinc-100 rounded-xl p-2.5">{a.notes}</p> : null}
                      {!a.reportFiled && a.lastReminderAt ? (
                        <p className="mt-2 text-[11.5px] text-amber-700">Daily reminder sent {formatDateTime(a.lastReminderAt)}</p>
                      ) : null}
                      <div className="divider my-3" />
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[11px] text-zinc-400">
                          By {a.assignedBy?.name || '—'} · {formatDateTime(a.createdAt)}
                          {a.doneAt ? ` · done ${formatDateTime(a.doneAt)}` : ''}
                        </p>
                        {a.reportFiled && a.serviceRecord?._id ? (
                          <Link to={`/admin/reports/${a.serviceRecord._id}`} className="btn btn-sm btn-outline">
                            <FileText size={14} />
                            View report
                          </Link>
                        ) : (
                          <span className="text-[11px] text-zinc-400">Awaiting engineer report</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
