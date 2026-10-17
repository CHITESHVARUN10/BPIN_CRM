import { useCallback, useEffect, useState } from 'react'
import { Check, MapPin, Phone, Clock, X } from 'lucide-react'
import api from '../api/client.js'
import { EmptyState, SkeletonRows, formatDate, formatDateTime } from '../components/ui.jsx'
import { useToast } from '../context/ToastContext.jsx'

const emptyForm = { assignedTo: '', customerName: '', customerPhone: '', address: '', pincode: '', visitDate: '', timing: '', notes: '' }

export default function AdminAssignments() {
  const push = useToast().push
  const [items, setItems] = useState(null)
  const [techs, setTechs] = useState([])
  const [segment, setSegment] = useState('all')
  const [techFilter, setTechFilter] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [formErr, setFormErr] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await api.get('/assignments', { params: { technician: techFilter || undefined } })
      setItems(res.data.items)
    } catch {
      setItems([])
    }
  }, [techFilter])

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

  const setStatus = async (a, status) => {
    setBusyId(String(a._id))
    try {
      await api.patch(`/assignments/${a._id}/status`, { status })
      load()
    } catch (err) {
      push(err.response?.data?.message || 'Could not update', 'error')
    } finally {
      setBusyId(null)
    }
  }

  const visible = items?.filter((i) => (segment === 'all' ? true : i.status === segment)) || []
  const hasFilters = techFilter !== '' || segment !== 'all'

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Assignments</h1>
        <p className="text-[13px] text-zinc-500 mt-0.5">Hand out visits — the engineer gets the customer's contact, address and timing</p>
      </div>

      <form onSubmit={submit} className="card p-4 space-y-3.5">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-zinc-100 grid place-items-center text-zinc-600"><MapPin size={16} /></div>
          <h2 className="text-sm font-semibold text-zinc-900">Hand out an assessment visit</h2>
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
          {submitting ? 'Handing out…' : (
            <>
              <Check size={15} />
              Hand out to engineer
            </>
          )}
        </button>
      </form>

      <div className="flex flex-wrap gap-2 items-center">
        <select className="input !min-h-[38px] !w-auto text-[13px]" value={techFilter} onChange={(e) => setTechFilter(e.target.value)}>
          <option value="">All engineers</option>
          {techs.map((t) => (
            <option key={t._id} value={t._id}>{t.name}</option>
          ))}
        </select>
        {['all', 'pending', 'done'].map((key) => (
          <button key={key} type="button" onClick={() => setSegment(key)} className={`btn btn-sm ${segment === key ? '' : 'btn-outline'}`}>
            {key === 'all' ? 'All' : key === 'pending' ? 'Pending' : 'Done'}
          </button>
        ))}
      </div>

      {items === null ? (
        <SkeletonRows rows={4} className="h-14" />
      ) : visible.length === 0 ? (
        <EmptyState title={hasFilters ? 'No assignments match' : 'No assignments yet'} hint={hasFilters ? undefined : 'Use the form above to hand out the first visit.'} />
      ) : (
        <div className="space-y-2.5">
          {visible.map((a) => (
            <div key={String(a._id)} className="card p-4">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-semibold text-zinc-900">{a.customerName}</p>
                {a.status === 'done' ? <span className="chip chip-strong">Done</span> : <span className="chip chip-open">Pending</span>}
                <span className="text-[11px] text-zinc-400 ml-auto">
                  To {a.assignedTo?.name}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-zinc-700">
                <a href={`tel:${a.customerPhone}`} className="link-accent inline-flex items-center gap-1.5 font-medium">
                  <Phone size={13} /> {a.customerPhone}
                </a>
                <span className="inline-flex items-center gap-1.5"><Clock size={13} className="text-zinc-400" /> {formatDate(a.visitDate)} · {a.timing}</span>
              </div>
              <p className="mt-2 text-[13px] text-zinc-700 whitespace-pre-line">{a.address}{a.pincode ? `, ${a.pincode}` : ''}</p>
              {a.notes ? <p className="mt-2 text-[12.5px] text-zinc-500 bg-zinc-50 border border-zinc-100 rounded-xl p-2.5">{a.notes}</p> : null}
              <div className="divider my-3" />
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] text-zinc-400">
                  By {a.assignedBy?.name || '—'} · {formatDateTime(a.createdAt)}{a.doneAt ? ` · done ${formatDateTime(a.doneAt)}` : ''}
                </p>
                <div className="flex gap-2">
                  {a.status === 'pending' ? (
                    <button type="button" className="btn btn-sm" disabled={busyId === String(a._id)} onClick={() => setStatus(a, 'done')}>
                      <Check size={14} />
                      Mark done
                    </button>
                  ) : (
                    <button type="button" className="btn btn-sm btn-outline" disabled={busyId === String(a._id)} onClick={() => setStatus(a, 'pending')}>
                      <X size={14} />
                      Reopen
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
