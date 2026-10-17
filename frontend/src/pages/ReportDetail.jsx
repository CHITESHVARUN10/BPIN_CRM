import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, CheckCircle2, ImageOff, Pencil, PlusCircle, RotateCcw } from 'lucide-react'
import api from '../api/client.js'
import { EmptyState, SkeletonRows, formatDate, formatDateTime } from '../components/ui.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'

function Detail({ label, value }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium text-zinc-400 uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-sm text-zinc-900 break-words">{value || '—'}</p>
    </div>
  )
}

function StatusChip({ status }) {
  return status === 'closed' ? (
    <span className="chip chip-strong">Closed</span>
  ) : (
    <span className="chip chip-open">Open</span>
  )
}

export default function ReportDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const pushToast = useToast().push
  const [record, setRecord] = useState(null)
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const [lightbox, setLightbox] = useState(null)
  const [busyReopen, setBusyReopen] = useState(false)

  useEffect(() => {
    setLoading(true)
    api
      .get(`/records/${id}`)
      .then((res) => setRecord(res.data.record))
      .catch(() => setMissing(true))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    if (lightbox === null) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') setLightbox(null)
      if (e.key === 'ArrowRight') setLightbox((i) => Math.min(record.allImages.length - 1, i + 1))
      if (e.key === 'ArrowLeft') setLightbox((i) => Math.max(0, i - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox, record])

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-6 w-40" />
        <SkeletonRows rows={6} className="h-12" />
      </div>
    )
  }
  if (missing || !record) {
    return <EmptyState title="Record not found" hint="It may have been removed or you don't have access." />
  }

  const allImages = [...(record.images || [])]
  const imageRuns = []
  for (const fu of record.followUps || []) {
    imageRuns.push({ images: fu.images || [], startIndex: allImages.length })
    allImages.push(...(fu.images || []))
  }
  imageRuns.push({ images: record.closure?.images || [], startIndex: allImages.length })
  allImages.push(...(record.closure?.images || []))
  const isOwner = user && record.technician && String(user._id) === String(record.technician._id)
  const isAdmin = user?.role === 'admin'
  const canClose = record.status === 'open' && (isOwner || isAdmin)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="chip chip-strong font-mono !text-[12px] !px-2.5 !py-1.5">{record.tokenNo}</h1>
        <StatusChip status={record.status} />
        {record.problem?.isOther ? <span className="chip">Other</span> : null}
      </div>

      <div className="card p-4 grid grid-cols-2 gap-x-4 gap-y-4">
        <div className="col-span-2">
          <Detail label="Model" value={record.productSnapshot?.description} />
          <p className="text-[12px] text-zinc-500 font-mono mt-1">
            {record.productSnapshot?.sku}
            {record.productSnapshot?.category ? ` · ${record.productSnapshot.category}` : ''}
          </p>
        </div>
        <Detail label="Serial number" value={record.serialNumber} />
        <Detail label="Visit date" value={formatDate(record.visitDate)} />
        <Detail label="Vehicle" value={[record.vehicle?.make, record.vehicle?.model].filter(Boolean).join(' ')} />
        <Detail label="Filed at" value={formatDateTime(record.createdAt)} />
        <div className="col-span-2 divider" />
        <div className="col-span-2">
          <Detail label="What the customer reported" value={record.customerReport} />
        </div>
        <Detail label="Problem" value={record.problem?.name} />
        {record.problem?.isOther ? <Detail label="Other description" value={record.problem?.otherDescription} /> : null}
        {record.notes ? (
          <div className="col-span-2">
            <Detail label="Assessment details" value={record.notes} />
          </div>
        ) : null}
      </div>

      {(record.images || []).length > 0 && (
        <div>
          <h2 className="section-title mb-2.5">Photos · initial assessment</h2>
          <div className="grid grid-cols-3 gap-2">
            {record.images.map((img, i) => (
              <button key={i} type="button" onClick={() => setLightbox(i)} className="aspect-square rounded-xl overflow-hidden border border-zinc-200">
                <img src={img.url} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        </div>
      )}

      {(record.followUps || []).length > 0 && (
        <div className="space-y-2.5">
          <h2 className="section-title">Follow-up assessments</h2>
          {record.followUps.map((fu, idx) => (
            <div key={idx} className="card p-4 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wide">Assessment {idx + 2}</span>
                <span className="text-[11px] text-zinc-400">· {formatDateTime(fu.filedAt)}</span>
                {fu.closes ? <span className="chip chip-strong">Closed the record</span> : null}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <div className="col-span-2">
                  <Detail label="What the customer reported" value={fu.customerReport} />
                </div>
                <Detail label="Problem" value={fu.problem?.name} />
                {fu.problem?.isOther ? <Detail label="Other description" value={fu.problem?.otherDescription} /> : null}
                {fu.notes ? (
                  <div className="col-span-2">
                    <Detail label="Assessment details" value={fu.notes} />
                  </div>
                ) : null}
              </div>
              {(fu.images || []).length > 0 && (
                <div className="grid grid-cols-4 gap-2">
                  {fu.images.map((img, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setLightbox((imageRuns[idx]?.startIndex ?? 0) + i)}
                      className="aspect-square rounded-lg overflow-hidden border border-zinc-200"
                    >
                      <img src={img.url} alt={`Follow-up photo ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {(record.images || []).length === 0 && (record.followUps || []).length === 0 && (
        <div className="card p-6 flex items-center gap-3 text-zinc-400">
          <ImageOff size={18} />
          <p className="text-sm">No photos attached</p>
        </div>
      )}

      {record.closure ? (
        <div className="card p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wide">Case closure</span>
            <span className="text-[11px] text-zinc-400">· {formatDateTime(record.closure.closedAt)}</span>
            <span className="chip chip-strong">Closed by {record.closure.closedByName}{record.closure.closedByRole ? ` · ${record.closure.closedByRole}` : ''}</span>
          </div>
          <Detail label="Work done" value={record.closure.workDone} />
          {(record.closure.images || []).length > 0 && (
            <div className="grid grid-cols-4 gap-2">
              {record.closure.images.map((img, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setLightbox(imageRuns[imageRuns.length - 1].startIndex + i)}
                  className="aspect-square rounded-lg overflow-hidden border border-zinc-200"
                >
                  <img src={img.url} alt={`Closure photo ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {canClose ? (
        <Link to={`/records/${record._id}/close`} className="btn w-full">
          <CheckCircle2 size={16} />
          Close case (final assessment)
        </Link>
      ) : null}
      {isAdmin && record.status === 'open' ? (
        <Link to={`/records/${record._id}/edit`} className="btn w-full btn-outline">
          <Pencil size={15} />
          Edit case
        </Link>
      ) : null}
      {isAdmin && record.status === 'closed' ? (
        <button
          type="button"
          className="btn w-full btn-outline"
          disabled={busyReopen}
          onClick={async () => {
            setBusyReopen(true)
            try {
              await api.post(`/records/${record._id}/reopen`)
              const res = await api.get(`/records/${record._id}`)
              setRecord(res.data.record)
              pushToast('Case reopened — the engineer has been notified')
            } catch (err) {
              pushToast(err.response?.data?.message || 'Could not reopen the case', 'error')
            } finally {
              setBusyReopen(false)
            }
          }}
        >
          <RotateCcw size={15} />
          {busyReopen ? 'Reopening…' : 'Reopen case'}
        </button>
      ) : null}
      {isOwner && record.status === 'open' ? (
        <Link to={`/records/${record._id}/follow-up`} className="btn w-full btn-outline">
          <PlusCircle size={16} />
          Add follow-up assessment
        </Link>
      ) : null}

      <div className="card p-4 grid grid-cols-2 gap-x-4 gap-y-4">
        <Detail label="Technician" value={record.technician?.name} />
        <Detail label="Region" value={record.technician?.region} />
        <Detail label="Contact" value={record.technician?.phone} />
        <Detail label="Email" value={record.technician?.email} />
      </div>

      {allImages.length > 0 && lightbox !== null && (
        <div className="fixed inset-0 z-[70] bg-zinc-950/95 flex items-center justify-center" onClick={() => setLightbox(null)}>
          <img src={allImages[lightbox]?.url} alt="" className="max-h-[86vh] max-w-[94vw] object-contain" onClick={(e) => e.stopPropagation()} />
          <button type="button" className="absolute left-3 top-1/2 -translate-y-1/2 p-2.5 rounded-full bg-white/10 text-white" onClick={(e) => { e.stopPropagation(); setLightbox(Math.max(0, lightbox - 1)) }} aria-label="Previous">
            <ChevronLeft size={22} />
          </button>
          <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 p-2.5 rounded-full bg-white/10 text-white" onClick={(e) => { e.stopPropagation(); setLightbox(Math.min(allImages.length - 1, lightbox + 1)) }} aria-label="Next">
            <ChevronRight size={22} />
          </button>
          <button type="button" className="absolute top-4 right-4 text-[12px] text-zinc-300" onClick={() => setLightbox(null)}>
            Tap anywhere to close
          </button>
        </div>
      )}
    </div>
  )
}
