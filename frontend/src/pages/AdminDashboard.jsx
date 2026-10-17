import { useCallback, useEffect, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import api from '../api/client.js'
import { SkeletonRows, StatCard, formatDate } from '../components/ui.jsx'

function rangeFor(preset) {
  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (preset === 'today') return { from: startOfDay, to: now }
  if (preset === '7d') {
    const f = new Date(startOfDay)
    f.setDate(f.getDate() - 6)
    return { from: f, to: now }
  }
  if (preset === 'month') return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now }
  const f = new Date(startOfDay)
  f.setDate(f.getDate() - 29)
  return { from: f, to: now }
}

export default function AdminDashboard() {
  const [preset, setPreset] = useState('30d')
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (p = preset) => {
    setLoading(true)
    const { from, to } = rangeFor(p)
    try {
      const res = await api.get('/reports/summary', { params: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) } })
      setSummary(res.data)
    } catch {
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }, [preset])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset])

  const maxProblem = summary?.topProblems?.[0]?.count || 1

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Admin dashboard</h1>
          <p className="text-[13px] text-zinc-500 mt-0.5">
            {summary ? `${formatDate(summary.range.from)} – ${formatDate(summary.range.to)}` : 'Field activity overview'}
          </p>
        </div>
        <select className="input !min-h-[38px] !w-auto text-[13px]" value={preset} onChange={(e) => setPreset(e.target.value)}>
          <option value="today">Today</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="month">This month</option>
        </select>
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="skeleton h-20" />
            <div className="skeleton h-20" />
            <div className="skeleton h-20" />
          </div>
          <div className="skeleton h-64" />
          <SkeletonRows rows={4} className="h-10" />
        </div>
      ) : !summary ? (
        <p className="text-sm text-zinc-500">Could not load summary.</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Total records" value={summary.totals.records} />
            <StatCard label="Technicians engaged" value={summary.totals.technicians} />
            <StatCard label="Models covered" value={summary.totals.models} />
          </div>

          <section className="card p-4">
            <h2 className="section-title mb-4">Records per day</h2>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={summary.perDay} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#f0f0f1" />
                  <XAxis dataKey="_id" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#a1a1aa' }} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#a1a1aa' }} allowDecimals={false} />
                  <Tooltip
                    cursor={{ stroke: '#e4e4e7' }}
                    contentStyle={{ borderRadius: 12, border: '1px solid #e4e4e7', fontSize: 12, boxShadow: 'none' }}
                  />
                  <Area type="monotone" dataKey="count" stroke="#171717" strokeWidth={1.6} fill="#e4e4e7" name="Records" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>

          <div className="grid md:grid-cols-2 gap-4">
            <section className="card p-4">
              <h2 className="section-title mb-4">Top models</h2>
              {summary.perModel.length === 0 ? (
                <p className="text-[13px] text-zinc-400 py-6 text-center">No model activity in range.</p>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={[...summary.perModel].reverse()} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                      <XAxis type="number" hide allowDecimals={false} />
                      <YAxis
                        type="category"
                        dataKey="description"
                        width={150}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fontSize: 10, fill: '#3f3f46' }}
                        tickFormatter={(value) => (String(value).length > 24 ? `${String(value).slice(0, 23)}…` : value)}
                      />
                      <Tooltip
                        cursor={{ fill: '#fafafa' }}
                        contentStyle={{ borderRadius: 12, border: '1px solid #e4e4e7', fontSize: 12, boxShadow: 'none' }}
                        formatter={(value) => [value, 'Reports']}
                        labelFormatter={(label, payload) => {
                          const sku = payload?.[0]?.payload?.sku
                          return sku ? `${label} (${sku})` : label
                        }}
                      />
                      <Bar dataKey="count" fill="#2f96d4" radius={[0, 6, 6, 0]} barSize={14} name="Reports" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>

            <section className="card p-4">
              <h2 className="section-title mb-4">Top problems</h2>
              {summary.topProblems.length === 0 ? (
                <p className="text-[13px] text-zinc-400 py-6 text-center">No problems logged in range.</p>
              ) : (
                <div className="space-y-3">
                  {summary.topProblems.map((p) => (
                    <div key={p.name}>
                      <div className="flex items-center justify-between text-[13px]">
                        <span className="font-medium text-zinc-800 truncate pr-2">{p.name}</span>
                        <span className="text-zinc-500 tabular-nums">{p.count}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-zinc-100">
                        <div className="h-1.5 rounded-full bg-zinc-900" style={{ width: `${(p.count / maxProblem) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {summary.perTechnician.length > 0 && (
            <section className="card p-4">
              <h2 className="section-title mb-3">Per technician</h2>
              <div className="divide-y divide-zinc-100">
                {summary.perTechnician.map((t) => (
                  <div key={t._id} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
                    <span className="text-sm text-zinc-800">{t.name}</span>
                    <span className="chip tabular-nums">{t.count}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
