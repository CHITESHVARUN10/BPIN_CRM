import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, BellRing, FilePlus2, FolderOpen } from 'lucide-react'
import api from '../api/client.js'
import { useAuth } from '../context/AuthContext.jsx'
import { EmptyState, SkeletonRows, StatCard, formatDate } from '../components/ui.jsx'

function greeting() {
  const h = new Date().getHours()
  if (h < 5) return 'Good night'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export default function TechHome() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [stats, setStats] = useState(null)
  const [recent, setRecent] = useState([])
  const [loading, setLoading] = useState(true)
  const [canPromptPush, setCanPromptPush] = useState(false)

  useEffect(() => {
    let alive = true
    Promise.all([
      api.get('/records/my-stats').catch(() => null),
      api.get('/records/my', { params: { page: 1 } }).catch(() => null),
    ]).then(([statsRes, listRes]) => {
      if (!alive) return
      setStats(statsRes?.data || { today: 0, month: 0, total: 0 })
      setRecent(listRes?.data?.items?.slice(0, 5) || [])
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      setCanPromptPush(true)
    }
  }, [])

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          {greeting()}, {user?.name.split(' ')[0]}
        </h1>
        <p className="text-[13px] text-zinc-500 mt-0.5">{user?.region ? `${user.region} · ` : ''}Service engineer</p>
      </div>

      {loading ? (
        <div className="grid grid-cols-3 gap-3">
          <div className="skeleton h-20" />
          <div className="skeleton h-20" />
          <div className="skeleton h-20" />
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Today" value={stats.today} />
          <StatCard label="This month" value={stats.month} />
          <StatCard label="All time" value={stats.total} />
        </div>
      )}

      <button onClick={() => navigate('/new')} className="btn w-full !min-h-[56px] !text-[15px]">
        <FilePlus2 size={18} />
        New Assessment
      </button>

      {canPromptPush ? (
        <div className="card p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-accent/10 grid place-items-center text-accent shrink-0">
            <BellRing size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-zinc-900">Turn on reminders?</p>
            <p className="text-[12px] text-zinc-500">Get nudged on this phone when the admin assigns or reminds you.</p>
          </div>
          <Link to="/notifications" className="btn btn-sm btn-outline shrink-0">
            Enable
          </Link>
        </div>
      ) : null}

      <section>
        <div className="flex items-center justify-between mb-2.5">
          <h2 className="section-title">Recent submissions</h2>
          <Link to="/records" className="text-[13px] font-medium text-zinc-600 hover:text-zinc-900 inline-flex items-center gap-1">
            View all
            <ArrowRight size={14} />
          </Link>
        </div>
        {loading ? (
          <SkeletonRows rows={4} className="h-14" />
        ) : recent.length === 0 ? (
          <EmptyState icon={FolderOpen} title="No reports yet" hint="Your filed assessments will show up here. Start with your first visit." />
        ) : (
          <div className="space-y-2">
            {recent.map((r) => (
              <Link key={r._id} to={`/records/${r._id}`} className="card p-3.5 flex items-center gap-3 active:bg-zinc-50 transition">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="chip chip-strong font-mono">{r.tokenNo}</span>
                    <span className="text-[11px] text-zinc-400">{formatDate(r.visitDate)}</span>
                  </div>
                  <p className="mt-1.5 text-sm font-medium text-zinc-900 truncate">{r.productSnapshot?.description}</p>
                  <p className="text-[12px] text-zinc-500 truncate">{r.problem?.name}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
