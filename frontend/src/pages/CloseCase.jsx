import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Check, Loader2 } from 'lucide-react'
import api from '../api/client.js'
import MediaUploader from '../components/MediaUploader.jsx'
import { EmptyState, Field, SkeletonRows, formatDate } from '../components/ui.jsx'
import { useToast } from '../context/ToastContext.jsx'

export default function CloseCase() {
  const { id } = useParams()
  const push = useToast().push
  const [record, setRecord] = useState(null)
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState('')
  const [workDone, setWorkDone] = useState('')
  const [error, setError] = useState('')
  const [images, setImages] = useState([])
  const [videos, setVideos] = useState([])
  const [submitting, setSubmitting] = useState(false)

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

  const submit = async (e) => {
    e.preventDefault()
    const clean = workDone.trim()
    if (!clean) {
      setError('Please describe the work done — this is required to close the case')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('workDone', clean)
      for (const img of images) fd.append('images', img.file)
      for (const vid of videos) fd.append('videos', vid.file)
      const res = await api.post(`/records/${id}/close`, fd)
      setRecord((r) => ({ ...r, ...res.data.record }))
      push(`Case closed · ${res.data.record.tokenNo}`)
    } catch (err) {
      setError(err.response?.data?.message || 'Could not close the case')
      push(err.response?.data?.message || 'Could not close the case', 'error')
    } finally {
      setSubmitting(false)
    }
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

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Close case</h1>
        <p className="text-[13px] text-zinc-500 mt-0.5">Record {record.tokenNo} · {record.productSnapshot?.description}</p>
      </div>

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

      <button type="submit" className="btn w-full !min-h-[52px] !text-[15px]" disabled={submitting}>
        {submitting ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
        Close this case
      </button>
    </form>
  )
}
