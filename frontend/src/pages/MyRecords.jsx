import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, PlusCircle, Search, FolderOpen } from 'lucide-react'
import api from '../api/client.js'
import { EmptyState, SkeletonRows, formatDate } from '../components/ui.jsx'

export default function MyRecords() {
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [q, setQ] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (pageNum = page, query = q) => {
    setLoading(true)
    try {
      const res = await api.get('/records/my', {
        params: {
          page: pageNum,
          q: query || undefined,
          from: from || undefined,
          to: to || undefined,
        },
      })
      setItems(res.data.items)
      setPages(res.data.pages)
      setPage(res.data.page)
      setTotal(res.data.total)
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, page, q])

  useEffect(() => {
    const t = setTimeout(() => load(1, q), q ? 350 : 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, from, to])

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">My records</h1>
        <p className="text-[13px] text-zinc-500 mt-0.5">{total} filed assessment{total === 1 ? '' : 's'}</p>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            className="input pl-9"
            placeholder="Search token or serial…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoComplete="off"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[11px] font-medium text-zinc-500 mb-1 block">From</label>
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="text-[11px] font-medium text-zinc-500 mb-1 block">To</label>
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      {loading ? (
        <SkeletonRows rows={5} className="h-16" />
      ) : items.length === 0 ? (
        <EmptyState icon={FolderOpen} title="Nothing here" hint="No records match your filters yet." />
      ) : (
        <div className="space-y-2">
          {items.map((r) => (
            <div key={r._id} className="card p-3.5 flex items-center gap-3">
              <Link to={`/records/${r._id}`} className="min-w-0 flex-1 active:opacity-70 transition">
                <div className="flex items-center gap-2">
                  <span className="chip chip-strong font-mono">{r.tokenNo}</span>
                  {r.status === 'closed' ? <span className="chip">Closed</span> : <span className="chip chip-open">Open</span>}
                  <span className="text-[11px] text-zinc-400 ml-auto">{formatDate(r.visitDate)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-900 truncate">{r.productSnapshot?.description}</p>
                    <p className="text-[12px] text-zinc-500 truncate font-mono">{r.serialNumber}</p>
                  </div>
                  <div className="text-right shrink-0 space-y-1">
                    <p className="text-[12px] font-medium text-zinc-700">{r.problem?.name}</p>
                    {r.images?.length ? <p className="text-[11px] text-zinc-400">{r.images.length} photo{r.images.length === 1 ? '' : 's'}</p> : null}
                  </div>
                </div>
              </Link>
              {r.status !== 'closed' ? (
                <button
                  type="button"
                  onClick={() => navigate(`/records/${r._id}/follow-up`)}
                  className="btn btn-sm btn-outline shrink-0"
                  title="Add a follow-up assessment"
                >
                  <PlusCircle size={14} />
                  Visit 2
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {!loading && pages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button className="btn btn-sm btn-outline" disabled={page <= 1} onClick={() => load(page - 1)}>
            <ChevronLeft size={15} />
            Prev
          </button>
          <span className="text-[13px] text-zinc-500 tabular-nums">
            {page} / {pages}
          </span>
          <button className="btn btn-sm btn-outline" disabled={page >= pages} onClick={() => load(page + 1)}>
            Next
            <ChevronRight size={15} />
          </button>
        </div>
      )}
    </div>
  )
}
