import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AreaChart as AreaChartIcon,
  BarChart3,
  CalendarDays,
  ChartLine,
  ClipboardList,
  GitCompareArrows,
  Package,
  RefreshCw,
  TrendingUp,
  Users,
} from 'lucide-react'
import api from '../api/client.js'
import PeriodPicker from '../components/PeriodPicker.jsx'
import MetricCard from '../components/dashboard/MetricCard.jsx'
import {
  ActivityChart,
  DaySnapshot,
  PeriodFacts,
  ProblemRanking,
  TechnicianDonut,
  TopModelsChart,
  WeekdayRhythm,
} from '../components/dashboard/Charts.jsx'
import {
  attachPreviousSeries,
  buildDaySeries,
  busiestDay,
  daysInRange,
  delta,
  formatDecimal,
  formatNumber,
  isCurrentPeriod,
  isoDate,
  periodLongLabel,
  periodSubtitle,
  previousRangeForMode,
  rangeForMode,
} from '../utils/periods.js'

const CHART_TYPES = [
  { value: 'area', label: 'Area chart', icon: AreaChartIcon },
  { value: 'line', label: 'Line chart', icon: ChartLine },
  { value: 'bar', label: 'Bar chart', icon: BarChart3 },
]

const FLAT_DELTA = { value: 0, label: '—', direction: 'flat' }

function ChartTypeToggle({ value, onChange }) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800">
      {CHART_TYPES.map(({ value: option, label, icon: Icon }) => (
        <button
          key={option}
          type="button"
          aria-label={label}
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={`grid h-7 w-7 place-items-center rounded-md transition ${
            value === option
              ? 'chart-toggle-active text-zinc-900 shadow-sm dark:text-zinc-100'
              : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
          }`}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  )
}

function CompareToggle({ active, disabled, onChange }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onChange}
      className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? 'border-accent/25 bg-accent/10 text-accent'
          : 'border-zinc-200 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800'
      }`}
    >
      <GitCompareArrows size={13} />
      Compare
    </button>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="skeleton h-[118px]" />
        ))}
      </div>
      <div className="skeleton h-[370px]" />
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="skeleton h-[330px] lg:col-span-3" />
        <div className="skeleton h-[330px] lg:col-span-2" />
      </div>
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="skeleton h-[280px] lg:col-span-3" />
        <div className="skeleton h-[280px] lg:col-span-2" />
      </div>
    </div>
  )
}

export default function AdminDashboard() {
  const [mode, setMode] = useState('week')
  const [anchor, setAnchor] = useState(() => new Date())
  const [summary, setSummary] = useState(null)
  const [previous, setPrevious] = useState(null)
  const [refreshing, setRefreshing] = useState(true)
  const [error, setError] = useState(false)
  const [chartType, setChartType] = useState('area')
  const [compare, setCompare] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const sequenceRef = useRef(0)

  const range = useMemo(() => rangeForMode(mode, anchor), [mode, anchor])
  const previousRange = useMemo(() => previousRangeForMode(mode, anchor), [mode, anchor])

  useEffect(() => {
    let alive = true
    const sequence = ++sequenceRef.current
    const controller = new AbortController()
    setRefreshing(true)

    const paramsFor = (value) => ({ from: isoDate(value.from), to: isoDate(value.to) })

    Promise.allSettled([
      api.get('/reports/summary', { params: paramsFor(range), signal: controller.signal }),
      api.get('/reports/summary', { params: paramsFor(previousRange), signal: controller.signal }),
    ]).then(([current, prior]) => {
      if (!alive || sequence !== sequenceRef.current) return
      if (current.status === 'fulfilled') {
        setSummary(current.value.data)
        setError(false)
      } else {
        setSummary(null)
        setError(true)
      }
      setPrevious(prior.status === 'fulfilled' ? prior.value.data : null)
      setRefreshing(false)
    })

    return () => {
      alive = false
      controller.abort()
    }
  }, [range, previousRange, reloadKey])

  const changeMode = (next) => {
    if (next === mode) return
    setRefreshing(true)
    setSummary(null)
    setPrevious(null)
    setMode(next)
    setAnchor(new Date())
  }

  const changeAnchor = (next) => {
    setRefreshing(true)
    setSummary(null)
    setPrevious(null)
    setAnchor(next)
  }

  const total = summary?.totals.records ?? 0
  const previousTotal = previous?.totals.records ?? 0
  const days = daysInRange(range.from, range.to)
  const previousDays = daysInRange(previousRange.from, previousRange.to)
  const average = total / days
  const previousAverage = previousTotal / previousDays
  const current = isCurrentPeriod(mode, anchor)

  const series = useMemo(
    () => (summary ? buildDaySeries(summary.perDay, range.from, range.to, mode) : []),
    [summary, range, mode],
  )
  const chartData = useMemo(
    () => (series.length && previous ? attachPreviousSeries(series, previous.perDay, previousRange) : series),
    [series, previous, previousRange],
  )
  const busiest = useMemo(() => busiestDay(series), [series])

  const recordDelta = previous ? delta(total, previousTotal) : FLAT_DELTA
  const technicianDelta = previous ? delta(summary?.totals.technicians || 0, previous.totals.technicians || 0) : FLAT_DELTA
  const modelDelta = previous ? delta(summary?.totals.models || 0, previous.totals.models || 0) : FLAT_DELTA
  const averageDelta = previous ? delta(average, previousAverage) : FLAT_DELTA

  const hasError = !summary && error && !refreshing
  const loading = !summary && !hasError

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight md:text-[28px]">Admin dashboard</h1>
          <p className="mt-1 text-[13px] text-zinc-500">
            {summary
              ? `${formatNumber(total)} records · ${days} ${days === 1 ? 'day' : 'days'} · ${periodSubtitle(mode, anchor)}`
              : 'Period-over-period view of field activity'}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {refreshing && summary ? (
            <span className="hidden items-center gap-1.5 text-[11px] text-zinc-400 sm:flex">
              <RefreshCw size={11} className="animate-spin" />
              Updating
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setReloadKey((value) => value + 1)}
            disabled={refreshing}
            className="grid h-9 w-9 place-items-center rounded-xl border border-zinc-200 bg-white text-zinc-500 transition hover:bg-zinc-50 hover:text-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
            aria-label="Refresh dashboard"
          >
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <PeriodPicker
        mode={mode}
        anchor={anchor}
        onModeChange={changeMode}
        onAnchorChange={changeAnchor}
      />

      {loading ? (
        <DashboardSkeleton />
      ) : hasError ? (
        <div className="card flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-red-50 text-red-600 dark:bg-red-950/50">
            <CalendarDays size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Could not load the dashboard</p>
            <p className="mt-0.5 text-[12px] text-zinc-500">The summary request failed. Check the connection and try again.</p>
          </div>
          <button type="button" className="btn btn-sm btn-outline" onClick={() => setReloadKey((value) => value + 1)}>
            <RefreshCw size={14} />
            Retry
          </button>
        </div>
      ) : summary ? (
        <div className={`space-y-4 transition-opacity ${refreshing ? 'opacity-60' : 'opacity-100'}`}>
          {total === 0 ? (
            <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-zinc-100 text-zinc-400 dark:bg-zinc-800">
                <CalendarDays size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">No records in this period</p>
                <p className="text-[12px] text-zinc-500">Try a different {mode} or jump back to the current one.</p>
              </div>
              {!current ? (
                <button type="button" className="btn btn-sm btn-outline" onClick={() => changeAnchor(new Date())}>
                  Back to now
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard label="Total records" value={total} delta={recordDelta} icon={ClipboardList} spark={series} />
            <MetricCard
              label="Technicians engaged"
              value={summary.totals.technicians}
              delta={technicianDelta}
              icon={Users}
              delay={0.05}
            />
            <MetricCard label="Models covered" value={summary.totals.models} delta={modelDelta} icon={Package} delay={0.1} />
            <MetricCard
              label="Avg / day"
              value={average}
              delta={averageDelta}
              icon={TrendingUp}
              decimals={1}
              delay={0.15}
            />
          </div>

          <section className="card overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-zinc-100 p-4 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {mode === 'day' ? 'Day snapshot' : 'Records over time'}
                  </h2>
                  <span className="chip">{mode === 'day' ? '1 day' : `${days} days`}</span>
                </div>
                <p className="mt-0.5 truncate text-[12px] text-zinc-500">{periodLongLabel(mode, anchor)}</p>
              </div>
              {mode !== 'day' ? (
                <div className="flex flex-wrap items-center gap-2">
                  <ChartTypeToggle value={chartType} onChange={setChartType} />
                  <CompareToggle active={compare} disabled={!previous} onChange={() => setCompare((value) => !value)} />
                </div>
              ) : null}
            </div>

            <div className="p-4">
              {mode === 'day' ? (
                <DaySnapshot
                  summary={summary}
                  previous={previous}
                  delta={recordDelta}
                  label={periodLongLabel(mode, anchor)}
                />
              ) : (
                <>
                  <ActivityChart
                    data={chartData}
                    mode={mode}
                    chartType={chartType}
                    showCompare={compare && Boolean(previous)}
                    average={average}
                  />
                  {compare && previous ? (
                    <div className="mt-2 flex flex-wrap items-center gap-4 text-[10px] text-zinc-400">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-1.5 w-4 rounded-full bg-accent" /> This period
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-4 border-t border-dashed border-zinc-400" /> Previous period
                      </span>
                    </div>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-zinc-100 pt-3 text-[11px] text-zinc-400 dark:border-zinc-800">
                    {busiest ? (
                      <span>
                        Peak: <span className="font-medium text-zinc-600 dark:text-zinc-300">{busiest.full}</span> ·{' '}
                        {formatNumber(busiest.count)}
                      </span>
                    ) : null}
                    <span>
                      Avg <span className="font-medium text-zinc-600 dark:text-zinc-300">{formatDecimal(average)}</span>/day
                    </span>
                    {compare && previous ? <span className="ml-auto">Previous: {formatNumber(previousTotal)}</span> : null}
                  </div>
                </>
              )}
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-5">
            <section className="card p-4 lg:col-span-3">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <h2 className="section-title">Top models</h2>
                  <p className="mt-1 text-[11px] text-zinc-400">Most reported SKUs</p>
                </div>
                <span className="chip tabular-nums">{summary.perModel.length}</span>
              </div>
              <TopModelsChart items={summary.perModel} />
            </section>

            <section className="card p-4 lg:col-span-2">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <h2 className="section-title">Technician split</h2>
                  <p className="mt-1 text-[11px] text-zinc-400">Share of reports filed</p>
                </div>
                <span className="chip tabular-nums">{summary.totals.technicians}</span>
              </div>
              <TechnicianDonut items={summary.perTechnician} />
            </section>
          </div>

          <div className="grid gap-4 lg:grid-cols-5">
            <section className="card p-4 lg:col-span-3">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <h2 className="section-title">Top problems</h2>
                  <p className="mt-1 text-[11px] text-zinc-400">Ranked by frequency</p>
                </div>
                <span className="chip tabular-nums">{summary.topProblems.length}</span>
              </div>
              <ProblemRanking items={summary.topProblems} />
            </section>

            <section className="card flex flex-col p-4 lg:col-span-2">
              <div className="mb-2">
                <h2 className="section-title">Weekday rhythm</h2>
                <p className="mt-1 text-[11px] text-zinc-400">When reports get filed</p>
              </div>
              <WeekdayRhythm series={series} />
              <div className="mt-auto">
                <PeriodFacts summary={summary} series={series} />
              </div>
            </section>
          </div>

          <p className="pb-1 text-center text-[10px] text-zinc-400">
            Each card compares the selected period with the one immediately before it.
          </p>
        </div>
      ) : null}
    </div>
  )
}
