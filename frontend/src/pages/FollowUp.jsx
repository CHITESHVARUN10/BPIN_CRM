import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Check, Loader2 } from 'lucide-react'
import api from '../api/client.js'
import MediaUploader from '../components/MediaUploader.jsx'
import { EmptyState, Field, SkeletonRows } from '../components/ui.jsx'
import { useToast } from '../context/ToastContext.jsx'

export default function FollowUp() {
  const { id } = useParams()
  const push = useToast().push
  const [record, setRecord] = useState(null)
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const [problems, setProblems] = useState([])
  const [form, setForm] = useState({ customerReport: '', problemId: '', isOther: false, problemOtherTitle: '', problemOtherDescription: '', notes: '' })
  const [images, setImages] = useState([])
  const [videos, setVideos] = useState([])
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(null)

  useEffect(() => {
    Promise.all([
      api.get(`/records/${id}`).catch(() => null),
      api.get('/problems').catch(() => ({ data: { items: [] } })),
    ]).then(([res, pro]) => {
      if (res?.data?.record) {
        setRecord(res.data.record)
        if (res.data.record.status === 'closed') setMissing(true)
      } else {
        setMissing(true)
      }
      setProblems(pro.data.items || [])
      setLoading(false)
    })
  }, [id])

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }))

  const submit = async (e) => {
    e.preventDefault()
    const errs = {}
    if (!form.customerReport.trim()) errs.customerReport = 'Describe what was observed on this visit'
    if (form.isOther) {
      if (!form.problemOtherTitle.trim()) errs.problemOtherTitle = 'Required for other problems'
      if (!form.problemOtherDescription.trim()) errs.problemOtherDescription = 'Required for other problems'
    } else if (!form.problemId) {
      errs.problemId = 'Select the problem'
    }
    setErrors(errs)
    if (Object.keys(errs).length) return

    setSubmitting(true)
    try {
      const fd = new FormData()
      fd.append('customerReport', form.customerReport.trim())
      if (form.isOther) {
        fd.append('isOther', 'true')
        fd.append('problemOtherTitle', form.problemOtherTitle.trim())
        fd.append('problemOtherDescription', form.problemOtherDescription.trim())
      } else {
        fd.append('problemId', form.problemId)
      }
      fd.append('notes', form.notes.trim())
      for (const img of images) fd.append('images', img.file)
      for (const vid of videos) fd.append('videos', vid.file)

      const res = await api.post(`/records/${id}/follow-up`, fd)
      setDone(res.data.record)
      push('Follow-up added')
    } catch (err) {
      push(err.response?.data?.message || 'Could not save the follow-up', 'error')
    } finally {
      setSubmitting(false)
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
  if (missing || !record) {
    return (
      <EmptyState title="Record unavailable" hint="It may already be closed or you don't have access to it.">
        <Link to="/records" className="btn btn-outline">Back to records</Link>
      </EmptyState>
    )
  }

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] text-center">
        <div className="w-14 h-14 rounded-full bg-zinc-900 grid place-items-center">
          <Check size={26} className="text-white" strokeWidth={2.5} />
        </div>
        <h1 className="mt-5 text-lg font-semibold tracking-tight">{done.status === 'closed' ? 'Record closed' : 'Follow-up added'}</h1>
        <p className="mt-1 text-[13px] text-zinc-500">Token {done.tokenNo}</p>
        <Link to={`/records/${done._id}`} className="btn mt-6">
          View record
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Follow-up assessment</h1>
        <p className="text-[13px] text-zinc-500 mt-0.5">Record {record.tokenNo} · file it on the same or next visit</p>
      </div>

      <div className="card p-4">
        <p className="text-[12px] font-medium text-zinc-400 uppercase tracking-wide">Product</p>
        <p className="mt-1 text-sm font-semibold text-zinc-900">{record.productSnapshot?.description}</p>
        <p className="text-[12px] text-zinc-500 font-mono">{record.productSnapshot?.sku}</p>
        <div className="divider my-3" />
        <p className="text-[12px] font-medium text-zinc-400 uppercase tracking-wide">Serial number</p>
        <p className="mt-1 text-sm text-zinc-900 font-mono">{record.serialNumber}</p>
        {[record.vehicle?.make, record.vehicle?.model].filter(Boolean).length > 0 && (
          <p className="mt-1 text-[12.5px] text-zinc-500">Vehicle · {[record.vehicle?.make, record.vehicle?.model].filter(Boolean).join(' ')}</p>
        )}
        <div className="divider my-3" />
        <p className="text-[12px] font-medium text-zinc-400 uppercase tracking-wide">Previous problem</p>
        <p className="mt-1 text-sm text-zinc-900">{record.problem?.name}</p>
      </div>

      <div className="card p-4 space-y-3.5">
        <Field label="What happened on this visit?" required error={errors.customerReport}>
          <textarea
            className="input min-h-[72px] resize-none"
            value={form.customerReport}
            onChange={(e) => set('customerReport', e.target.value)}
            placeholder="Observations, checks performed, customer feedback…"
          />
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
              <option key={p._id} value={p._id}>
                {p.name}
              </option>
            ))}
            <option value="__other__">Other (not listed)</option>
          </select>
        </Field>

        {form.isOther ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3.5 space-y-3.5">
            <Field label="What is the problem?" required error={errors.problemOtherTitle}>
              <input className="input" value={form.problemOtherTitle} onChange={(e) => set('problemOtherTitle', e.target.value)} placeholder="Name the problem" />
            </Field>
            <Field label="Describe it in detail" required error={errors.problemOtherDescription}>
              <textarea className="input min-h-[64px] resize-none" value={form.problemOtherDescription} onChange={(e) => set('problemOtherDescription', e.target.value)} />
            </Field>
          </div>
        ) : (
          <Field label="Assessment details" hint="Optional remarks">
            <textarea className="input min-h-[64px] resize-none" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        )}
      </div>

      <div className="card p-4">
        <MediaUploader images={images} onImagesChange={setImages} videos={videos} onVideosChange={setVideos} />
      </div>

      <button type="submit" className="btn w-full !min-h-[52px] !text-[15px]" disabled={submitting}>
        {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
        Add follow-up assessment
      </button>
    </form>
  )
}
