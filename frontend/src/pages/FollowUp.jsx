import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertCircle, Check, Loader2, RotateCcw } from 'lucide-react'
import api from '../api/client.js'
import MediaUploader from '../components/MediaUploader.jsx'
import { EmptyState, Field, SkeletonRows } from '../components/ui.jsx'
import { useToast } from '../context/ToastContext.jsx'
import {
  mediaHasErrors,
  mediaPayload,
  mediaPending,
  newId,
  reviveDraftMedia,
  revokeLocalPreviews,
  serializeDraftMedia,
} from '../utils/media.js'

const emptyForm = {
  customerReport: '',
  problemId: '',
  isOther: false,
  problemOtherTitle: '',
  problemOtherDescription: '',
  notes: '',
}

function loadDraft(key) {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const draft = JSON.parse(raw)
    return draft && typeof draft === 'object' ? draft : null
  } catch {
    return null
  }
}

export default function FollowUp() {
  const { id } = useParams()
  const push = useToast().push
  const draftKey = `bpin:draft:follow-up:${id}`
  const draft = useRef(loadDraft(draftKey))
  const submittedRef = useRef(false)
  const submissionId = useRef(draft.current?.submissionId || newId())
  const [draftRestored] = useState(Boolean(draft.current))

  const [record, setRecord] = useState(null)
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const [problems, setProblems] = useState([])
  const [form, setForm] = useState(() => ({ ...emptyForm, ...draft.current?.form }))
  const [images, setImages] = useState(() => reviveDraftMedia(draft.current?.images))
  const [videos, setVideos] = useState(() => reviveDraftMedia(draft.current?.videos))
  const [errors, setErrors] = useState({})
  const [saveError, setSaveError] = useState('')
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

  useEffect(() => {
    if (submittedRef.current) return
    const payload = {
      form,
      images: serializeDraftMedia(images),
      videos: serializeDraftMedia(videos),
      submissionId: submissionId.current,
      savedAt: Date.now(),
    }
    const hasForm = Boolean(
      form.customerReport.trim() ||
        form.problemId ||
        form.isOther ||
        form.problemOtherTitle.trim() ||
        form.problemOtherDescription.trim() ||
        form.notes.trim(),
    )
    try {
      if (hasForm || payload.images.length || payload.videos.length) {
        sessionStorage.setItem(draftKey, JSON.stringify(payload))
      } else {
        sessionStorage.removeItem(draftKey)
      }
    } catch {
      // storage full/unavailable — draft simply won't persist
    }
  }, [form, images, videos, draftKey])

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }))

  const saveFollowUp = async () => {
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

    const allMedia = [...images, ...videos]
    if (mediaPending(allMedia)) {
      setSaveError('Media is still uploading. Wait for it to finish, then save the follow-up.')
      return
    }
    if (mediaHasErrors(allMedia)) {
      setSaveError('Some media failed to upload. Retry or remove those files, then save the follow-up.')
      return
    }

    setSaveError('')
    setSubmitting(true)
    try {
      const payload = {
        customerReport: form.customerReport.trim(),
        isOther: form.isOther,
        notes: form.notes.trim(),
        images: mediaPayload(images),
        videos: mediaPayload(videos),
        submissionId: submissionId.current,
      }
      if (form.isOther) {
        payload.problemOtherTitle = form.problemOtherTitle.trim()
        payload.problemOtherDescription = form.problemOtherDescription.trim()
      } else {
        payload.problemId = form.problemId
      }

      const res = await api.post(`/records/${id}/follow-up`, payload)
      submittedRef.current = true
      sessionStorage.removeItem(draftKey)
      revokeLocalPreviews(images)
      revokeLocalPreviews(videos)
      setImages([])
      setVideos([])
      setDone(res.data.record)
      push('Follow-up added')
    } catch (err) {
      const message = err.response?.data?.message || 'Could not save the follow-up'
      setSaveError(`${message} Your draft and uploaded media are saved on this device — retry when ready.`)
      push(message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const submit = (e) => {
    e.preventDefault()
    saveFollowUp()
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

  const mediaUploading = mediaPending([...images, ...videos])

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Follow-up assessment</h1>
        <p className="text-[13px] text-zinc-500 mt-0.5">Record {record.tokenNo} · file it on the same or next visit</p>
      </div>

      {draftRestored ? (
        <div className="card border border-amber-200 bg-amber-50/60 p-3.5">
          <p className="text-[12.5px] text-amber-900">
            Draft restored from this device. Uploaded photos and videos are still attached.
          </p>
        </div>
      ) : null}

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

      {saveError ? (
        <div className="card border border-red-200 bg-red-50/60 p-3.5">
          <div className="flex items-start gap-2.5">
            <AlertCircle size={17} className="text-red-600 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-[12.5px] text-red-900">{saveError}</p>
              <button type="button" className="btn btn-sm mt-2" onClick={saveFollowUp} disabled={submitting}>
                <RotateCcw size={13} />
                Retry save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <button type="submit" className="btn w-full !min-h-[52px] !text-[15px]" disabled={submitting || mediaUploading}>
        {submitting || mediaUploading ? <Loader2 size={16} className="animate-spin" /> : null}
        {mediaUploading ? 'Uploading media…' : 'Add follow-up assessment'}
      </button>
      <p className="text-center text-[11px] text-zinc-400">Drafts save automatically on this device.</p>
    </form>
  )
}
