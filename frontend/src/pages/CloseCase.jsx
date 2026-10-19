import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertCircle, Check, Loader2, RotateCcw } from 'lucide-react'
import api from '../api/client.js'
import MediaUploader from '../components/MediaUploader.jsx'
import { EmptyState, Field, SkeletonRows, formatDate } from '../components/ui.jsx'
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

export default function CloseCase() {
  const { id } = useParams()
  const push = useToast().push
  const draftKey = `bpin:draft:close:${id}`
  const draft = useRef(loadDraft(draftKey))
  const submittedRef = useRef(false)
  const submissionId = useRef(draft.current?.submissionId || newId())
  const [draftRestored] = useState(Boolean(draft.current))

  const [record, setRecord] = useState(null)
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState('')
  const [workDone, setWorkDone] = useState(draft.current?.workDone || '')
  const [error, setError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [images, setImages] = useState(() => reviveDraftMedia(draft.current?.images))
  const [videos, setVideos] = useState(() => reviveDraftMedia(draft.current?.videos))
  const [submitting, setSubmitting] = useState(false)
  const [closed, setClosed] = useState(null)

  useEffect(() => {
    api
      .get(`/records/${id}`)
      .then((res) => {
        setRecord(res.data.record)
        if (res.data.record.status === 'closed') setUnavailable('This case is already closed.')
      })
      .catch(() => setUnavailable('Record not found or you don\'t have access.'))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    if (submittedRef.current) return
    const payload = {
      workDone,
      images: serializeDraftMedia(images),
      videos: serializeDraftMedia(videos),
      submissionId: submissionId.current,
      savedAt: Date.now(),
    }
    try {
      if (workDone.trim() || payload.images.length || payload.videos.length) {
        sessionStorage.setItem(draftKey, JSON.stringify(payload))
      } else {
        sessionStorage.removeItem(draftKey)
      }
    } catch {
      // storage full/unavailable — draft simply won't persist
    }
  }, [workDone, images, videos, draftKey])

  const saveClose = async () => {
    const clean = workDone.trim()
    if (!clean) {
      setError('Please describe the work done — this is required to close the case')
      return
    }
    const allMedia = [...images, ...videos]
    if (mediaPending(allMedia)) {
      setSaveError('Media is still uploading. Wait for it to finish, then close the case.')
      return
    }
    if (mediaHasErrors(allMedia)) {
      setSaveError('Some media failed to upload. Retry or remove those files, then close the case.')
      return
    }

    setError('')
    setSaveError('')
    setSubmitting(true)
    try {
      const res = await api.post(`/records/${id}/close`, {
        workDone: clean,
        images: mediaPayload(images),
        videos: mediaPayload(videos),
        submissionId: submissionId.current,
      })
      submittedRef.current = true
      sessionStorage.removeItem(draftKey)
      revokeLocalPreviews(images)
      revokeLocalPreviews(videos)
      setImages([])
      setVideos([])
      setRecord((r) => ({ ...r, ...res.data.record }))
      setClosed(res.data.record)
      push(`Case closed · ${res.data.record.tokenNo}`)
    } catch (err) {
      const message = err.response?.data?.message || 'Could not close the case'
      setSaveError(`${message} Your draft and uploaded media are saved on this device — retry when ready.`)
      push(message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const submit = (e) => {
    e.preventDefault()
    saveClose()
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-6 w-40" />
        <SkeletonRows rows={4} className="h-12" />
      </div>
    )
  }
  if (!record || unavailable) {
    return (
      <EmptyState title="Case unavailable" hint={unavailable}>
        <Link to="/records" className="btn btn-outline">Back to records</Link>
      </EmptyState>
    )
  }

  if (closed) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] text-center">
        <div className="w-14 h-14 rounded-full bg-zinc-900 grid place-items-center">
          <Check size={26} className="text-white" strokeWidth={2.5} />
        </div>
        <h1 className="mt-5 text-lg font-semibold tracking-tight">Case closed</h1>
        <p className="mt-1 text-[13px] text-zinc-500">Token {closed.tokenNo}</p>
        <Link to={`/records/${closed._id}`} className="btn mt-6">
          View record
        </Link>
      </div>
    )
  }

  const mediaUploading = mediaPending([...images, ...videos])

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Close case</h1>
        <p className="text-[13px] text-zinc-500 mt-0.5">Record {record.tokenNo} · {record.productSnapshot?.description}</p>
      </div>

      {draftRestored ? (
        <div className="card border border-amber-200 bg-amber-50/60 p-3.5">
          <p className="text-[12.5px] text-amber-900">
            Draft restored from this device. Uploaded photos and videos are still attached.
          </p>
        </div>
      ) : null}

      <div className="card p-4">
        <p className="text-[12px] font-medium text-zinc-400 uppercase tracking-wide">Serial number</p>
        <p className="mt-1 text-sm text-zinc-900 font-mono">{record.serialNumber}</p>
        <div className="divider my-3" />
        <p className="text-[12px] font-medium text-zinc-400 uppercase tracking-wide">Filed on</p>
        <p className="mt-1 text-sm text-zinc-900">{formatDate(record.visitDate)}</p>
      </div>

      <div className="card p-4 space-y-3.5">
        <Field label="What work was done?" required error={error} hint="Final resolution notes — parts, fixes, replacements and verification">
          <textarea
            className="input min-h-[96px] resize-none"
            value={workDone}
            onChange={(e) => setWorkDone(e.target.value)}
            placeholder="e.g. Replaced main PCB, tested display and touch for 30 minutes — working normally…"
          />
        </Field>
        <Field label="Photos & video" hint="Optional — attach proof of work if available (max 4 photos, 1 video)">
          <MediaUploader images={images} onImagesChange={setImages} videos={videos} onVideosChange={setVideos} />
        </Field>
      </div>

      {saveError ? (
        <div className="card border border-red-200 bg-red-50/60 p-3.5">
          <div className="flex items-start gap-2.5">
            <AlertCircle size={17} className="text-red-600 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-[12.5px] text-red-900">{saveError}</p>
              <button type="button" className="btn btn-sm mt-2" onClick={saveClose} disabled={submitting}>
                <RotateCcw size={13} />
                Retry save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <button type="submit" className="btn w-full !min-h-[52px] !text-[15px]" disabled={submitting || mediaUploading}>
        {submitting || mediaUploading ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
        {mediaUploading ? 'Uploading media…' : 'Close this case'}
      </button>
      <p className="text-center text-[11px] text-zinc-400">Drafts save automatically on this device.</p>
    </form>
  )
}
