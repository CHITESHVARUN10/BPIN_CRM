import { useId, useMemo } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import {
  MONTHS_SHORT,
  formatDecimal,
  formatNumber,
  weekdayDistribution,
} from '../../utils/periods.js'

const ACCENT = '#2f96d4'
const PREVIOUS = '#a1a1aa'
const MUTED = 'rgba(127, 127, 127, 0.24)'

const safeId = (id) => `chart-${String(id).replace(/[^a-zA-Z0-9_-]/g, '')}`

export function DeltaPill({ delta, className = '' }) {
  const Icon = delta.direction === 'up' ? ArrowUpRight : delta.direction === 'down' ? ArrowDownRight : Minus
  const tone =
    delta.direction === 'up'
      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
      : delta.direction === 'down'
        ? 'bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-400'
        : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${tone} ${className}`}>
      <Icon size={11} />
      {delta.label}
    </span>
  )
}

export function ChartEmpty({ message = 'No data for this period', hint = 'Pick another period or widen the range.' }) {
  return (
    <div className="grid min-h-[190px] place-items-center rounded-xl border border-dashed border-zinc-200 px-4 text-center dark:border-zinc-800">
      <div>
        <p className="text-[13px] font-medium text-zinc-500">{message}</p>
        <p className="mt-1 text-[11px] text-zinc-400">{hint}</p>
      </div>
    </div>
  )
}

export function ChartTooltip({ active, payload, label, suffix = 'records' }) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload
  const title = point?.full || label || payload[0]?.name
  return (
    <div className="rounded-xl border border-zinc-200/90 bg-white/95 px-3 py-2 shadow-xl backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">{title}</p>
      <div className="mt-1.5 space-y-1">
        {payload.map((entry, index) => (
          <div key={`${entry.dataKey || entry.name || index}`} className="flex items-center gap-2 text-[12px]">
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: entry.color || entry.fill || ACCENT }}
            />
            <span className="text-zinc-500">{entry.name}</span>
            <span className="ml-auto pl-4 font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
              {formatNumber(entry.value)}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-1 text-[10px] text-zinc-400">{suffix}</p>
    </div>
  )
}

export function ActivityChart({ data, mode, chartType, showCompare, average }) {
  const gradientId = safeId(useId())
  const tickKeys = useMemo(() => {
    if (!data.length) return []
    if (mode === 'week') return data.map((point) => point.key)
    if (mode === 'month') {
      return data
        .filter((point, index) => index === 0 || index === data.length - 1 || point.date.getDate() % 7 === 0)
        .map((point) => point.key)
    }
    return data.filter((point) => point.date.getDate() === 1).map((point) => point.key)
  }, [data, mode])

  const pointByKey = useMemo(() => new Map(data.map((point) => [point.key, point])), [data])
  const formatTick = (key) => {
    const point = pointByKey.get(key)
    if (!point) return ''
    if (mode === 'week') return point.axis
    if (mode === 'month') return `${point.date.getDate()} ${MONTHS_SHORT[point.date.getMonth()]}`
    return MONTHS_SHORT[point.date.getMonth()]
  }

  const hasData = data.some((point) => point.count > 0 || (showCompare && (point.previous || 0) > 0))
  if (!hasData) {
    return <ChartEmpty message="No records in this period" hint="Try another day, week, month or year." />
  }

  const dot = data.length <= 31 ? { r: 2.4, fill: ACCENT, strokeWidth: 0 } : false

  return (
    <div className="h-[250px] sm:h-[280px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 12, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ACCENT} stopOpacity={0.32} />
              <stop offset="100%" stopColor={ACCENT} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="#e4e4e7" strokeDasharray="3 6" />
          <XAxis
            dataKey="key"
            ticks={tickKeys}
            tickFormatter={formatTick}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10, fill: '#a1a1aa' }}
            minTickGap={12}
          />
          <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#a1a1aa' }} allowDecimals={false} width={30} />
          <Tooltip
            content={<ChartTooltip />}
            cursor={{ stroke: '#a1a1aa', strokeDasharray: '3 3' }}
          />
          {average > 0 ? (
            <ReferenceLine
              y={Math.round(average * 10) / 10}
              stroke="#a1a1aa"
              strokeDasharray="3 5"
              label={{ value: 'avg', position: 'insideTopRight', fill: '#a1a1aa', fontSize: 9 }}
            />
          ) : null}

          {chartType === 'bar' ? (
            <Bar dataKey="count" name="Records" fill={`url(#${gradientId})`} radius={[5, 5, 0, 0]} maxBarSize={mode === 'year' ? 6 : 24} />
          ) : chartType === 'line' ? (
            <Line
              type="monotone"
              dataKey="count"
              name="Records"
              stroke={ACCENT}
              strokeWidth={2}
              dot={dot}
              activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }}
            />
          ) : (
            <Area
              type="monotone"
              dataKey="count"
              name="Records"
              stroke={ACCENT}
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              dot={dot}
              activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }}
            />
          )}

          {showCompare ? (
            <Line
              type="monotone"
              dataKey="previous"
              name="Previous period"
              stroke={PREVIOUS}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
              activeDot={{ r: 3 }}
            />
          ) : null}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

export function Sparkline({ data }) {
  const gradientId = safeId(useId())
  if (!data?.length) return null
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity={0.25} />
            <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="count"
          stroke={ACCENT}
          strokeWidth={1.4}
          fill={`url(#${gradientId})`}
          dot={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

function ModelTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const item = payload[0].payload
  return (
    <div className="max-w-[240px] rounded-xl border border-zinc-200/90 bg-white/95 px-3 py-2 shadow-xl backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95">
      <p className="text-[12px] font-semibold leading-snug text-zinc-900 dark:text-zinc-100">{item.name}</p>
      <p className="mt-0.5 text-[10px] text-zinc-400">{item.sku}</p>
      <p className="mt-1.5 text-[11px] text-zinc-500">
        <span className="font-semibold text-zinc-900 dark:text-zinc-100">{formatNumber(item.count)}</span> reports
      </p>
    </div>
  )
}

export function TopModelsChart({ items }) {
  const rows = useMemo(
    () =>
      [...items].reverse().map((item) => ({
        name: item.description || item.sku || 'Unknown model',
        sku: item.sku || '',
        count: item.count,
      })),
    [items],
  )
  const gradientId = safeId(useId())

  if (!items.length) return <ChartEmpty message="No model activity" hint="No reports were filed in this period." />

  return (
    <div style={{ height: Math.max(218, rows.length * 30) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 34, left: 0, bottom: 0 }} barCategoryGap={7}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={ACCENT} stopOpacity={0.95} />
              <stop offset="100%" stopColor={ACCENT} stopOpacity={0.55} />
            </linearGradient>
          </defs>
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="name"
            width={138}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10, fill: '#71717a' }}
            tickFormatter={(value) => (String(value).length > 21 ? `${String(value).slice(0, 20)}…` : value)}
          />
          <Tooltip content={<ModelTooltip />} cursor={{ fill: 'rgba(127,127,127,0.08)' }} />
          <Bar
            dataKey="count"
            name="Reports"
            fill={`url(#${gradientId})`}
            radius={[0, 6, 6, 0]}
            barSize={15}
            background={{ fill: 'rgba(127,127,127,0.12)' }}
          >
            <LabelList dataKey="count" position="right" fill="#a1a1aa" fontSize={10} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

const DONUT_COLORS = ['#0c4a6e', '#075985', '#0369a1', '#0284c7', '#2f96d4', '#7dd3fc']

export function TechnicianDonut({ items }) {
  const grouped = useMemo(() => {
    if (items.length <= 6) return items
    const top = items.slice(0, 5)
    const rest = items.slice(5)
    return [
      ...top,
      { _id: 'others', name: 'Others', count: rest.reduce((total, item) => total + item.count, 0) },
    ]
  }, [items])

  if (!items.length) return <ChartEmpty message="No technician activity" hint="Assignments appear once reports are filed." />

  const total = grouped.reduce((sum, item) => sum + item.count, 0)

  return (
    <div>
      <div className="relative h-[190px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={grouped}
              dataKey="count"
              nameKey="name"
              innerRadius="62%"
              outerRadius="88%"
              paddingAngle={2}
              stroke="none"
              startAngle={90}
              endAngle={-270}
            >
              {grouped.map((entry, index) => (
                <Cell key={entry._id || entry.name} fill={DONUT_COLORS[index % DONUT_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip suffix="reports" />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="text-center">
            <p className="text-2xl font-semibold tabular-nums tracking-tight text-zinc-900 dark:text-zinc-100">
              {formatNumber(total)}
            </p>
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-400">reports</p>
          </div>
        </div>
      </div>

      <div className="mt-2 space-y-1.5">
        {grouped.map((entry, index) => (
          <div key={entry._id || entry.name} className="flex items-center gap-2 text-[12px]">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: DONUT_COLORS[index % DONUT_COLORS.length] }}
            />
            <span className="min-w-0 flex-1 truncate text-zinc-600 dark:text-zinc-300">{entry.name}</span>
            <span className="font-medium tabular-nums text-zinc-900 dark:text-zinc-100">{formatNumber(entry.count)}</span>
            <span className="w-8 text-right text-[10px] tabular-nums text-zinc-400">
              {total ? Math.round((entry.count / total) * 100) : 0}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ProblemRanking({ items }) {
  const reducedMotion = useReducedMotion()
  const max = items[0]?.count || 1
  const total = items.reduce((sum, item) => sum + item.count, 0)

  if (!items.length) return <ChartEmpty message="No problems logged" hint="Problems appear when a report is filed." />

  return (
    <div className="space-y-3">
      {items.map((problem, index) => (
        <div key={problem.name}>
          <div className="flex items-center gap-2 text-[12px]">
            <span
              className={`w-4 shrink-0 text-right text-[10px] font-semibold tabular-nums ${
                index < 3 ? 'text-accent' : 'text-zinc-400'
              }`}
            >
              {String(index + 1).padStart(2, '0')}
            </span>
            <span className="min-w-0 flex-1 truncate font-medium text-zinc-800 dark:text-zinc-200">{problem.name}</span>
            <span className="tabular-nums text-zinc-500">{formatNumber(problem.count)}</span>
            <span className="w-8 text-right text-[10px] tabular-nums text-zinc-400">
              {total ? Math.round((problem.count / total) * 100) : 0}%
            </span>
          </div>
          <div className="ml-6 mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-accent to-accent/45"
              initial={{ width: 0 }}
              animate={{ width: `${(problem.count / max) * 100}%` }}
              transition={{ duration: reducedMotion ? 0 : 0.55, delay: reducedMotion ? 0 : index * 0.035, ease: 'easeOut' }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

export function WeekdayRhythm({ series }) {
  const data = useMemo(() => weekdayDistribution(series), [series])
  const total = data.reduce((sum, item) => sum + item.count, 0)
  const busiest = data.reduce((best, item) => (item.count > best.count ? item : best), data[0])

  if (!total) return <ChartEmpty message="No weekday rhythm yet" hint="There are no reports in this period." />

  return (
    <div>
      <div className="h-[148px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10, fill: '#a1a1aa' }}
              interval={0}
            />
            <Tooltip content={<ChartTooltip suffix="records" />} cursor={{ fill: 'rgba(127,127,127,0.08)' }} />
            <Bar dataKey="count" name="Records" radius={[4, 4, 0, 0]} maxBarSize={26}>
              {data.map((entry) => (
                <Cell key={entry.label} fill={entry.count === busiest.count ? ACCENT : MUTED} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-center text-[11px] text-zinc-400">
        Busiest on <span className="font-medium text-zinc-600 dark:text-zinc-300">{busiest.label}</span> ·{' '}
        {formatNumber(busiest.count)} records
      </p>
    </div>
  )
}

export function PeriodFacts({ summary, series }) {
  const total = series.reduce((sum, point) => sum + point.count, 0)
  const activeDays = series.filter((point) => point.count > 0).length
  const topModelShare = total && summary.perModel[0] ? Math.round((summary.perModel[0].count / total) * 100) : 0
  const topProblemShare = total && summary.topProblems[0] ? Math.round((summary.topProblems[0].count / total) * 100) : 0

  const facts = [
    { label: 'Active days', value: `${activeDays} / ${series.length}` },
    { label: 'Avg / active day', value: formatDecimal(activeDays ? total / activeDays : 0) },
    { label: 'Top model share', value: `${topModelShare}%` },
    { label: 'Top problem share', value: `${topProblemShare}%` },
  ]

  return (
    <div className="mt-3 grid grid-cols-2 gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
      {facts.map((fact) => (
        <div key={fact.label}>
          <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-400">{fact.label}</p>
          <p className="mt-0.5 text-[13px] font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">{fact.value}</p>
        </div>
      ))}
    </div>
  )
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-xl border border-zinc-100 bg-zinc-50/70 p-2.5 dark:border-zinc-800 dark:bg-zinc-800/40">
      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-400">{label}</p>
      <p className="mt-1 truncate text-[12px] font-medium text-zinc-800 dark:text-zinc-200">
        {typeof value === 'number' ? formatNumber(value) : value}
      </p>
    </div>
  )
}

export function DaySnapshot({ summary, previous, delta: change, label }) {
  const today = summary.totals.records
  const prior = previous?.totals.records || 0
  const data =
    today + prior === 0
      ? [{ name: 'No records', value: 1, fill: MUTED }]
      : [
          { name: 'Selected day', value: today, fill: ACCENT },
          { name: 'Previous day', value: prior, fill: MUTED },
        ]

  return (
    <div className="grid items-center gap-5 md:grid-cols-[1fr_240px]">
      <div>
        <p className="section-title">Selected day</p>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <p className="text-5xl font-semibold leading-none tracking-tight tabular-nums text-zinc-900 dark:text-zinc-100">
            {formatNumber(today)}
          </p>
          <DeltaPill delta={change} className="mb-1" />
        </div>
        <p className="mt-2 text-[12px] text-zinc-500">
          reports · {label} · previous day {formatNumber(prior)}
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <MiniStat label="Technicians" value={summary.totals.technicians} />
          <MiniStat label="Models" value={summary.totals.models} />
          <MiniStat label="Top model" value={summary.perModel[0]?.description || '—'} />
          <MiniStat label="Top problem" value={summary.topProblems[0]?.name || '—'} />
        </div>
      </div>

      <div className="relative mx-auto h-[190px] w-full max-w-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius="66%"
              outerRadius="90%"
              paddingAngle={2}
              stroke="none"
              startAngle={90}
              endAngle={-270}
            >
              {data.map((entry) => (
                <Cell key={entry.name} fill={entry.fill} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip suffix="records" />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="text-center">
            <p className="text-3xl font-semibold tabular-nums tracking-tight text-zinc-900 dark:text-zinc-100">
              {formatNumber(today)}
            </p>
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-400">records</p>
          </div>
        </div>
      </div>
    </div>
  )
}
