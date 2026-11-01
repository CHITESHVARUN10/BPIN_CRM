import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search } from 'lucide-react'
import api from '../api/client.js'
import PeriodPicker from '../components/PeriodPicker.jsx'
import ProductSelect from '../components/ProductSelect.jsx'
import { EmptyState, SkeletonRows, formatDate } from '../components/ui.jsx'
import { isoDate, periodLabel, periodSubtitle, rangeForMode } from '../utils/periods.js'

export default function AdminRecords() {
  const [mode, setMode] = useState('day')
  const [anchor, setAnchor] = useState(() => new Date())
  const range = useMemo(() => rangeForMode(mode, anchor), [mode, anchor])
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
          from: isoDate(range.from),
          to: isoDate(range.to),
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
  }, [range, technician, problem, product, status, q])

  useEffect(() => {
    const t = setTimeout(() => load(1), q ? 350 : 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, technician, problem, product, status, q])

  const changeMode = (next) => {
    if (next === mode) return
    setMode(next)
    setAnchor(new Date())
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Records</h1>
        <p className="text-[13px] text-zinc-500 mt-0.5">
          {loading ? 'Assessments for the selected period' : `${total} record${total === 1 ? '' : 's'} · ${periodSubtitle(mode, anchor)}`}
          {' · '}downloads live in Reports
        </p>
      </div>

      <PeriodPicker mode={mode} anchor={anchor} onModeChange={changeMode} onAnchorChange={setAnchor} />

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
        <EmptyState title={`No records in ${periodLabel(mode, anchor)}`} hint="Try another period or clear the filters." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="data-table min-w-[1080px]">
            <thead>
              <tr>
                <th className="w-[160px]">Token</th>
                <th>Product</th>
                <th className="w-[170px]">Technician</th>
                <th className="w-[190px]">Problem</th>
                <th className="w-[120px]">Visit date</th>
                <th className="w-[100px]">Status</th>
                <th className="w-[100px] text-right">Report</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r._id}>
                  <td>
                    <Link to={`/admin/reports/${r._id}`} className="chip chip-strong font-mono transition hover:opacity-80">
                      {r.tokenNo}
                    </Link>
                  </td>
                  <td>
                    <p className="font-medium text-zinc-900 dark:text-zinc-100">{r.productSnapshot?.description || '—'}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-zinc-400">{r.serialNumber}</p>
                  </td>
                  <td>
                    <p className="text-[13px] text-zinc-700">{r.technician?.name || '—'}</p>
                  </td>
                  <td>
                    <p className="text-[13px] text-zinc-700">{r.problem?.name || '—'}</p>
                  </td>
                  <td>
                    <p className="text-[12px] tabular-nums text-zinc-600">{formatDate(r.visitDate)}</p>
                  </td>
                  <td>
                    {r.status === 'open' ? <span className="chip chip-open">Open</span> : <span className="chip">Closed</span>}
                  </td>
                  <td className="text-right">
                    <Link to={`/admin/reports/${r._id}`} className="btn btn-sm btn-outline">
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
