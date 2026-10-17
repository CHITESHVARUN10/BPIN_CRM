import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarSearch, Search } from 'lucide-react'
import api from '../api/client.js'
import ProductSelect from '../components/ProductSelect.jsx'
import { EmptyState, SkeletonRows, formatDate } from '../components/ui.jsx'

export default function AdminRecords() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [technician, setTechnician] = useState('')
  const [problem, setProblem] = useState('')
  const [product, setProduct] = useState(null)
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [techs, setTechs] = useState([])
  const [problems, setProblems] = useState([])
  const [items, setItems] = useState([])
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/users').then((res) => setTechs(res.data.items.filter((u) => u.role === 'technician'))).catch(() => setTechs([]))
  }, [])

  useEffect(() => {
    api.get('/problems').then((res) => setProblems(res.data.items)).catch(() => setProblems([]))
  }, [])

  const load = useCallback(async (pageNum = 1) => {
    setLoading(true)
    try {
      const res = await api.get('/records/my', {
        params: {
          page: pageNum,
          from: date,
          to: date,
          technician: technician || undefined,
          problem: problem || undefined,
          sku: product?.sku || undefined,
          status: status || undefined,
          q: q.trim() || undefined,
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
  }, [date, technician, problem, product, status, q])

  useEffect(() => {
    const t = setTimeout(() => load(1), q ? 350 : 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, technician, problem, product, status, q])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Records</h1>
          <p className="text-[13px] text-zinc-500 mt-0.5">All assessments for a single day · downloads live in Reports</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            className="input !min-h-[40px] !w-auto text-[13px]"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          {date !== new Date().toISOString().slice(0, 10) ? (
            <button type="button" className="btn btn-sm btn-outline" onClick={() => setDate(new Date().toISOString().slice(0, 10))}>
              <CalendarSearch size={14} />
              Today
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-end">
        <select className="input !min-h-[40px] !w-auto text-[13px]" value={technician} onChange={(e) => setTechnician(e.target.value)}>
          <option value="">All technicians</option>
          {techs.map((t) => (
            <option key={t._id} value={t._id}>{t.name}</option>
          ))}
        </select>
        <select className="input !min-h-[40px] !w-auto text-[13px]" value={problem} onChange={(e) => setProblem(e.target.value)}>
          <option value="">All problems</option>
          {problems.map((p) => (
            <option key={p._id} value={p._id}>{p.name}</option>
          ))}
        </select>
        <select className="input !min-h-[40px] !w-auto text-[13px]" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Open & closed</option>
          <option value="open">Open only</option>
          <option value="closed">Closed only</option>
        </select>
        <div className="relative flex-1 min-w-40">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input className="input !min-h-[40px] pl-9 text-[13px]" placeholder="Token or serial…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div>
        <p className="text-[11px] font-medium text-zinc-500 mb-1.5">Model filter</p>
        <div className="max-w-md">
          <ProductSelect value={product} onSelect={setProduct} />
        </div>
      </div>

      {loading ? (
        <SkeletonRows rows={5} className="h-16" />
      ) : items.length === 0 ? (
        <EmptyState title={`No records on ${formatDate(date)}`} hint="Try another date or clear the filters." />
      ) : (
        <div className="space-y-2">
          {items.map((r) => (
            <Link key={r._id} to={`/admin/reports/${r._id}`} className="card p-3.5 block active:bg-zinc-50 transition">
              <div className="flex items-center gap-2">
                <span className="chip chip-strong font-mono">{r.tokenNo}</span>
                {r.status === 'open' ? <span className="chip chip-open">Open</span> : <span className="chip">Closed</span>}
                <span className="text-[11px] text-zinc-400 ml-auto">{formatDate(r.visitDate)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-900 truncate">{r.productSnapshot?.description}</p>
                  <p className="text-[12px] text-zinc-500 truncate">
                    {r.technician?.name} · <span className="font-mono">{r.serialNumber}</span>
                  </p>
                </div>
                <p className="text-[12px] font-medium text-zinc-700 text-right shrink-0">{r.problem?.name}</p>
              </div>
            </Link>
          ))}
        </div>
      )}

      {!loading && pages > 1 ? (
        <div className="flex items-center justify-center gap-2">
          <button className="btn btn-sm btn-outline" disabled={page <= 1} onClick={() => load(page - 1)}>Prev</button>
          <span className="text-[13px] text-zinc-500 tabular-nums">{page} / {pages}</span>
          <button className="btn btn-sm btn-outline" disabled={page >= pages} onClick={() => load(page + 1)}>Next</button>
        </div>
      ) : null}
    </div>
  )
}
