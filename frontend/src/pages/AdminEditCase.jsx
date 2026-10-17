import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Loader2, Save } from 'lucide-react'
import api from '../api/client.js'
import { EmptyState, Field, SkeletonRows } from '../components/ui.jsx'
import { useToast } from '../context/ToastContext.jsx'

export default function AdminEditCase() {
  const { id } = useParams()
  const navigate = useNavigate()
  const push = useToast().push
  const [record, setRecord] = useState(null)
  const [problems, setProblems] = useState([])
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState('')
  const [form, setForm] = useState({ serialNumber: '', customerReport: '', problemId: '', isOther: false, problemOtherTitle: '', problemOtherDescription: '', notes: '', vehicleMake: '', vehicleModel: '' })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    Promise.all([
      api.get(`/records/${id}`).catch(() => null),
      api.get('/problems').catch(() => ({ data: { items: [] } })),
    ]).then(([res, pro]) => {
      if (res?.data?.record) {
        const r = res.data.record
        if (r.status === 'closed') {
          setUnavailable('Closed cases cannot be edited. Reopen the case first if needed.')
        } else {
          setRecord(r)
          setForm({
            serialNumber: r.serialNumber || '',
            customerReport: r.customerReport || '',
            problemId: r.problem?.isOther ? '' : r.problem?.ref?._id || r.problem?.ref || '',
            isOther: Boolean(r.problem?.isOther),
            problemOtherTitle: r.problem?.isOther ? r.problem?.name || '' : '',
            problemOtherDescription: r.problem?.otherDescription || '',
            notes: r.notes || '',
            vehicleMake: r.vehicle?.make || '',
            vehicleModel: r.vehicle?.model || '',
          })
        }
      } else {
        setUnavailable('Record not found or you don\'t have access.')
      }
      setProblems(pro.data.items || [])
      setLoading(false)
    })
  }, [id])

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }))

  const submit = async (e) => {
    e.preventDefault()
    const errs = {}
    if (!form.serialNumber.trim()) errs.serialNumber = 'Serial number is required'
    if (!form.customerReport.trim()) errs.customerReport = 'Customer reported problem is required'
    if (form.isOther) {
      if (!form.problemOtherTitle.trim()) errs.problemOtherTitle = 'Required'
      if (!form.problemOtherDescription.trim()) errs.problemOtherDescription = 'Required'
    } else if (!form.problemId) {
      errs.problemId = 'Select the problem'
    }
    setErrors(errs)
    if (Object.keys(errs).length) return

    setBusy(true)
    try {
      await api.patch(`/records/${id}`, {
        serialNumber: form.serialNumber.trim(),
        customerReport: form.customerReport.trim(),
        isOther: form.isOther,
        problemId: form.isOther ? undefined : form.problemId,
        problemOtherTitle: form.isOther ? form.problemOtherTitle.trim() : undefined,
        problemOtherDescription: form.isOther ? form.problemOtherDescription.trim() : undefined,
        notes: form.notes.trim(),
        vehicleMake: form.vehicleMake.trim(),
        vehicleModel: form.vehicleModel.trim(),
      })
      push('Case updated — the change is in the admin log')
      navigate(`/records/${id}`)
    } catch (err) {
      push(err.response?.data?.message || 'Could not update the case', 'error')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-6 w-40" />
        <SkeletonRows rows={5} className="h-12" />
      </div>
    )
  }
  if (unavailable || !record) {
    return (
      <EmptyState title="Case unavailable" hint={unavailable}>
        <Link to="/">Back to dashboard</Link>
      </EmptyState>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Edit case</h1>
        <p className="text-[13px] text-zinc-500 mt-0.5">Record {record.tokenNo} · changes are logged for other admins</p>
      </div>

      <div className="card p-4 space-y-3.5">
        <Field label="Serial number" required error={errors.serialNumber}>
          <input className="input font-mono" value={form.serialNumber} onChange={(e) => set('serialNumber', e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Vehicle make">
            <input className="input" value={form.vehicleMake} onChange={(e) => set('vehicleMake', e.target.value)} />
          </Field>
          <Field label="Vehicle model">
            <input className="input" value={form.vehicleModel} onChange={(e) => set('vehicleModel', e.target.value)} />
          </Field>
        </div>
        <Field label="What did the customer report?" required error={errors.customerReport}>
          <textarea className="input min-h-[72px] resize-none" value={form.customerReport} onChange={(e) => set('customerReport', e.target.value)} />
        </Field>
        <Field label="Select problem" required={!form.isOther} error={errors.problemId}>
          <select
            className="input"
            value={form.isOther ? '__other__' : form.problemId}
            onChange={(e) => {
              const v = e.target.value
              if (v === '__other__') {
                set('isOther', true)
                set('problemId', '')
              } else {
                set('problemId', v)
                set('isOther', false)
              }
            }}
          >
            <option value="">Select a problem</option>
            {problems.map((p) => (
              <option key={p._id} value={p._id}>{p.name}</option>
            ))}
            <option value="__other__">Other (not listed)</option>
          </select>
        </Field>
        {form.isOther ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3.5 space-y-3.5">
            <Field label="What is the problem?" required error={errors.problemOtherTitle}>
              <input className="input" value={form.problemOtherTitle} onChange={(e) => set('problemOtherTitle', e.target.value)} />
            </Field>
            <Field label="Describe it in detail" required error={errors.problemOtherDescription}>
              <textarea className="input min-h-[64px] resize-none" value={form.problemOtherDescription} onChange={(e) => set('problemOtherDescription', e.target.value)} />
            </Field>
          </div>
        ) : null}
        {!form.isOther ? (
          <Field label="Assessment details" hint="Optional remarks">
            <textarea className="input min-h-[64px] resize-none" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        ) : null}
      </div>

      <button type="submit" className="btn w-full !min-h-[52px] !text-[15px]" disabled={busy}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
        Save changes
      </button>
    </form>
  )
}
