import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Check, Copy, Plus } from 'lucide-react'
import api from '../api/client.js'
import ProductSelect from '../components/ProductSelect.jsx'
import QRScanner from '../components/QRScanner.jsx'
import MediaUploader from '../components/MediaUploader.jsx'
import { Field } from '../components/ui.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useNotifications } from '../context/NotificationsContext.jsx'

const DRAFT_KEY = 'bpin:draft:new-report'

const emptyForm = {
  product: null,
  serialNumber: '',
  vehicleMake: '',
  vehicleModel: '',
  customerReport: '',
  problemId: '',
  isOther: false,
  problemOtherTitle: '',
  problemOtherDescription: '',
  notes: '',
  visitDate: '',
}

function loadDraft() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const draft = JSON.parse(raw)
    return draft && typeof draft === 'object' && !draft.submittedAt ? draft : null
  } catch {
    return null
  }
}

export default function NewReport() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const assignmentId = searchParams.get('assignmentId') || ''
  const assignmentVisitDate = searchParams.get('visitDate') || ''
  const push = useToast().push
  const { refresh } = useNotifications()

  const [problems, setProblems] = useState([])
  const [problemsLoading, setProblemsLoading] = useState(true)
  const draft = useRef(loadDraft())
  const [form, setForm] = useState(() => {
    const base = draft.current ? { ...emptyForm, ...draft.current } : { ...emptyForm }
    if (!draft.current && assignmentVisitDate) base.visitDate = assignmentVisitDate
    return base
  })
  const [images, setImages] = useState([])
  const [videos, setVideos] = useState([])
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [result, setResult] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    api
      .get('/problems')
      .then((res) => setProblems(res.data.items))
      .catch(() => setProblems([]))
      .finally(() => setProblemsLoading(false))
  }, [])

  useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(form))
    } catch {
      // storage full/unavailable — draft simply won't persist
    }
  }, [form])

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }))

  const validate = () => {
    const errs = {}
    if (!form.product) errs.product = 'Select the product'
    if (!form.serialNumber.trim()) errs.serialNumber = 'Enter the serial number'
    if (!form.customerReport.trim()) errs.customerReport = 'Describe what the customer reported'
    if (form.isOther) {
      if (!form.problemOtherTitle.trim()) errs.problemOtherTitle = 'Required for other problems'
      if (!form.problemOtherDescription.trim()) errs.problemOtherDescription = 'Required for other problems'
    } else if (!form.problemId) {
      errs.problemId = 'Select the problem'
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!validate()) return
    setSubmitting(true)
    try {
      const fd = new FormData()
      fd.append('sku', form.product.sku)
      fd.append('serialNumber', form.serialNumber.trim())
      fd.append('customerReport', form.customerReport.trim())
      if (form.isOther) {
        fd.append('isOther', 'true')
        fd.append('problemOtherTitle', form.problemOtherTitle.trim())
        fd.append('problemOtherDescription', form.problemOtherDescription.trim())
      } else {
        fd.append('problemId', form.problemId)
      }
      fd.append('notes', form.notes.trim())
      fd.append('vehicleMake', form.vehicleMake.trim())
      fd.append('vehicleModel', form.vehicleModel.trim())
      if (form.visitDate) fd.append('visitDate', form.visitDate)
      if (assignmentId) fd.append('assignmentId', assignmentId)
      for (const img of images) fd.append('images', img.file)
      for (const vid of videos) fd.append('videos', vid.file)

      const res = await api.post('/records', fd)
      setResult(res.data.record)
      sessionStorage.removeItem(DRAFT_KEY)
      for (const img of images) URL.revokeObjectURL(img.previewUrl)
      for (const vid of videos) URL.revokeObjectURL(vid.previewUrl)
      setImages([])
      setVideos([])
      setForm(emptyForm)
      push(`Report filed · ${res.data.record.tokenNo}`)
    } catch (err) {
      push(err.response?.data?.message || 'Could not file the report', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const reset = () => {
    setResult(null)
    setImages([])
    setVideos([])
    setCopied(false)
    setForm({
      product: null,
      serialNumber: '',
      vehicleMake: '',
      vehicleModel: '',
      customerReport: '',
      problemId: '',
      isOther: false,
      problemOtherTitle: '',
      problemOtherDescription: '',
      notes: '',
      visitDate: '',
    })
    refresh()
  }

  if (result) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] text-center">
        <div className="w-14 h-14 rounded-full bg-zinc-900 grid place-items-center">
          <Check size={26} className="text-white" strokeWidth={2.5} />
        </div>
        <h1 className="mt-5 text-lg font-semibold tracking-tight">Report filed</h1>
        <p className="mt-1 text-[13px] text-zinc-500">Quote this token to the admin if asked.</p>
        <div className="card mt-5 px-8 py-6">
          <p className="font-mono text-2xl font-semibold tracking-tight text-zinc-900">{result.tokenNo}</p>
        </div>
        <div className="flex gap-2 mt-6">
          <button
            className="btn btn-outline"
            onClick={() => {
              navigator.clipboard?.writeText(result.tokenNo).then(() => {
                setCopied(true)
                push('Token copied')
              }).catch(() => {})
            }}
          >
            <Copy size={15} />
            {copied ? 'Copied' : 'Copy token'}
          </button>
          <button className="btn" onClick={() => navigate(assignmentId ? '/assignments' : '/')}>
            {assignmentId ? 'Back to assignments' : 'Back to home'}
          </button>
        </div>
        {!assignmentId ? (
          <button className="text-[13px] text-zinc-500 hover:text-zinc-800 mt-5 inline-flex items-center gap-1 bg-transparent" onClick={reset}>
            <Plus size={14} />
            File another report
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">New Assessment</h1>
        <p className="text-[13px] text-zinc-500 mt-0.5">A token number is generated on submit.</p>
      </div>

      <section className="space-y-3">
        <h2 className="section-title">1 · Product</h2>
        <div>
          <Field label="Product model" required error={errors.product} hint="Search by description or SKU code">
            <ProductSelect value={form.product} onSelect={(p) => set('product', p)} />
          </Field>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="section-title">2 · Device</h2>
        <div className="card p-4 space-y-3.5">
          <Field label="Serial number" required error={errors.serialNumber}>
            <div className="flex gap-2">
              <input
                className="input font-mono flex-1"
                value={form.serialNumber}
                onChange={(e) => set('serialNumber', e.target.value)}
                placeholder="Type or scan"
                autoCapitalize="characters"
              />
              <button type="button" className="btn btn-outline shrink-0" onClick={() => setScanning(true)}>
                Scan QR
              </button>
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Vehicle make">
              <input className="input" value={form.vehicleMake} onChange={(e) => set('vehicleMake', e.target.value)} placeholder="e.g. Tata" />
            </Field>
            <Field label="Vehicle model">
              <input className="input" value={form.vehicleModel} onChange={(e) => set('vehicleModel', e.target.value)} placeholder="e.g. Nexon" />
            </Field>
          </div>
          <Field label="Visit date" hint="Leave empty if the visit is today">
            <input type="date" className="input" value={form.visitDate} onChange={(e) => set('visitDate', e.target.value)} />
          </Field>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="section-title">3 · Problem</h2>
        <div className="card p-4 space-y-3.5">
          <Field label="What did the customer report?" required error={errors.customerReport}>
            <textarea
              className="input min-h-[72px] resize-none"
              value={form.customerReport}
              onChange={(e) => set('customerReport', e.target.value)}
              placeholder="Issue described by the end user at the visit…"
            />
          </Field>

          <Field label="Select problem" required={form.isOther ? undefined : true} error={errors.problemId}>
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
              <option value="">{problemsLoading ? 'Loading…' : 'Select a problem'}</option>
              {problems.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name}
                </option>
              ))}
              <option value="__other__">Other (not listed)</option>
            </select>
          </Field>

          {form.isOther && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3.5 space-y-3.5">
              <Field label="What is the problem?" required error={errors.problemOtherTitle}>
                <input className="input" value={form.problemOtherTitle} onChange={(e) => set('problemOtherTitle', e.target.value)} placeholder="Name the problem so the team can track it" />
              </Field>
              <Field label="Describe it in detail" required error={errors.problemOtherDescription} hint="Mandatory so the team gets more insight">
                <textarea
                  className="input min-h-[64px] resize-none"
                  value={form.problemOtherDescription}
                  onChange={(e) => set('problemOtherDescription', e.target.value)}
                  placeholder="Explain the fault in plain words…"
                />
              </Field>
            </div>
          )}

          {!form.isOther && (
            <Field label="Assessment details" hint="Optional remarks after your inspection">
              <textarea
                className="input min-h-[64px] resize-none"
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
                placeholder="What you found and did…"
              />
            </Field>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="section-title">4 · Photos & video</h2>
        <div className="card p-4">
          <MediaUploader images={images} onImagesChange={setImages} videos={videos} onVideosChange={setVideos} />
        </div>
      </section>

      <button type="submit" className="btn w-full !min-h-[52px] !text-[15px]" disabled={submitting}>
        {submitting ? (
          <span className="inline-flex items-center gap-2">Submitting…</span>
        ) : (
          'Submit assessment'
        )}
      </button>

      {scanning && (
        <QRScanner
          onResult={(text) => {
            set('serialNumber', text)
            setScanning(false)
            push('Serial scanned')
          }}
          onClose={() => setScanning(false)}
        />
      )}
    </form>
  )
}
