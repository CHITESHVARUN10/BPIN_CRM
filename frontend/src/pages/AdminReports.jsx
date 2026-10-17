import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Download, Search } from 'lucide-react'
import api from '../api/client.js'
import ProductSelect from '../components/ProductSelect.jsx'
import { EmptyState, SkeletonRows, formatDate } from '../components/ui.jsx'

function rangeFor(preset) {
  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const to = now
  if (preset === 'today') return { from: startOfDay, to }
  if (preset === 'week') {
    const f = new Date(startOfDay)
    f.setDate(f.getDate() - 6)
    return { from: f, to }
  }
  if (preset === 'month') return { from: new Date(now.getFullYear(), now.getMonth(), 1), to }
  if (preset === 'year') return { from: new Date(now.getFullYear(), 0, 1), to }
  return { from: null, to: null }
}

export default function AdminReports() {
  const navigate = useNavigate()
  const [preset, setPreset] = useState('month')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
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

  useEffect(() => {
    const r = rangeFor(preset)
    setFrom(r.from ? r.from.toISOString().slice(0, 10) : '')
    setTo(r.to ? r.to.toISOString().slice(0, 10) : '')
  }, [preset])

  const query = useMemo(() => {
    const p = {}
    if (q.trim()) p.q = q.trim()
    if (from) p.from = from
    if (to) p.to = to
    if (technician) p.technician = technician
    if (problem) p.problem = problem
    if (product?.sku) p.sku = product.sku
    if (status) p.status = status
    return p
  }, [q, from, to, technician, problem, product, status])

  const load = useCallback(async (pageNum = 1) => {
    setLoading(true)
    try {
      const res = await api.get('/records/my', { params: { ...query, page: pageNum } })
      setItems(res.data.items)
      setPages(res.data.pages)
      setPage(res.data.page)
      setTotal(res.data.total)
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => {
    const t = setTimeout(() => load(1), q ? 350 : 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, from, to, technician, problem, product, status])

  const exportQs = useMemo(() => {
    const p = new URLSearchParams()
    if (from) p.set('from', from)
    if (to) p.set('to', to)
    return p.toString()
  }, [from, to])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Service reports</h1>
          <p className="text-[13px] text-zinc-500 mt-0.5">{total} record{total === 1 ? '' : 's'} · any date range, exportable</p>
        </div>
        <div className="flex gap-2">
          <a className="btn btn-sm btn-outline" href={`/api/reports/export.csv?${exportQs}`}>
            <Download size={14} />
            CSV
          </a>
          <a className="btn btn-sm btn-outline" href={`/api/reports/export.pdf?${exportQs}`}>
            <Download size={14} />
            PDF
          </a>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-end">
        <select className="input !min-h-[40px] !w-auto text-[13px]" value={preset} onChange={(e) => setPreset(e.target.value)}>
          <option value="today">Today</option>
          <option value="week">This week</option>
          <option value="month">This month</option>
          <option value="year">This year</option>
          <option value="custom">Custom range</option>
        </select>
        {preset === 'custom' ? (
          <>
            <input type="date" className="input !min-h-[40px] !w-auto text-[13px]" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input type="date" className="input !min-h-[40px] !w-auto text-[13px]" value={to} onChange={(e) => setTo(e.target.value)} />
          </>
        ) : null}
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
        <SkeletonRows rows={6} className="h-12" />
      ) : items.length === 0 ? (
        <EmptyState title="No records match" hint="Try widening the date range or clearing filters." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-zinc-400 border-b border-zinc-200">
                <th className="px-3.5 py-2.5 font-medium">Token</th>
                <th className="px-3.5 py-2.5 font-medium">Date</th>
                <th className="px-3.5 py-2.5 font-medium">Technician</th>
                <th className="px-3.5 py-2.5 font-medium">Model</th>
                <th className="px-3.5 py-2.5 font-medium">Problem</th>
                <th className="px-3.5 py-2.5 font-medium">Serial</th>
                <th className="px-3.5 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {items.map((r) => (
                <tr key={r._id} onClick={() => navigate(`/admin/reports/${r._id}`)} className="hover:bg-zinc-50 cursor-pointer">
                  <td className="px-3.5 py-2.5">
                    <Link to={`/admin/reports/${r._id}`} className="font-mono font-medium text-zinc-900 hover:underline whitespace-nowrap">
                      {r.tokenNo}
                    </Link>
                  </td>
                  <td className="px-3.5 py-2.5 text-zinc-600 whitespace-nowrap">{formatDate(r.visitDate)}</td>
                  <td className="px-3.5 py-2.5 text-zinc-800">{r.technician?.name || '—'}</td>
                  <td className="px-3.5 py-2.5 text-zinc-600 max-w-52 truncate">{r.productSnapshot?.description}</td>
                  <td className="px-3.5 py-2.5 text-zinc-600">{r.problem?.name}{r.problem?.isOther ? ' (Other)' : ''}</td>
                  <td className="px-3.5 py-2.5 text-zinc-600 font-mono text-[12px] max-w-44 truncate">{r.serialNumber}</td>
                  <td className="px-3.5 py-2.5">
                    {r.status === 'closed' ? <span className="chip">Closed</span> : <span className="chip chip-open">Open</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && pages > 1 ? (
        <div className="flex items-center justify-center gap-2">
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
      ) : null}
    </div>
  )
}
