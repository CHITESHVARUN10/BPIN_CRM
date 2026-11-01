const DAY_MS = 24 * 60 * 60 * 1000

export const PERIOD_MODES = ['day', 'week', 'month', 'year']

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const WEEKDAYS_MON = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
export const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const pad2 = (n) => String(n).padStart(2, '0')

export function startOfDay(value = new Date()) {
  const d = new Date(value)
  d.setHours(0, 0, 0, 0)
  return d
}

export function endOfDay(value = new Date()) {
  const d = new Date(value)
  d.setHours(23, 59, 59, 999)
  return d
}

export function addDays(value, amount) {
  const d = new Date(value)
  d.setDate(d.getDate() + amount)
  return d
}

export function startOfWeek(value = new Date()) {
  const d = startOfDay(value)
  const offset = (d.getDay() + 6) % 7
  return addDays(d, -offset)
}

export function endOfWeek(value = new Date()) {
  return addDays(startOfWeek(value), 6)
}

export function startOfMonth(value = new Date()) {
  return new Date(value.getFullYear(), value.getMonth(), 1)
}

export function endOfMonth(value = new Date()) {
  return new Date(value.getFullYear(), value.getMonth() + 1, 0)
}

export function startOfYear(value = new Date()) {
  return new Date(value.getFullYear(), 0, 1)
}

export function endOfYear(value = new Date()) {
  return new Date(value.getFullYear(), 11, 31)
}

export function isoDate(value) {
  const d = new Date(value)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function inRange(value, from, to) {
  const d = startOfDay(value).getTime()
  return d >= startOfDay(from).getTime() && d <= startOfDay(to).getTime()
}

export function rangeForMode(mode, anchor = new Date()) {
  if (mode === 'day') {
    const from = startOfDay(anchor)
    return { from, to: from }
  }
  if (mode === 'week') return { from: startOfWeek(anchor), to: endOfWeek(anchor) }
  if (mode === 'month') return { from: startOfMonth(anchor), to: endOfMonth(anchor) }
  return { from: startOfYear(anchor), to: endOfYear(anchor) }
}

export function previousRangeForMode(mode, anchor = new Date()) {
  if (mode === 'day') return rangeForMode('day', addDays(anchor, -1))
  if (mode === 'week') return rangeForMode('week', addDays(anchor, -7))
  if (mode === 'month') return rangeForMode('month', new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1))
  return rangeForMode('year', new Date(anchor.getFullYear() - 1, 0, 1))
}

export function normalizeAnchor(mode, value) {
  if (mode === 'month') return startOfMonth(value)
  if (mode === 'year') return startOfYear(value)
  return startOfDay(value)
}

export function shiftAnchor(mode, anchor, delta) {
  if (mode === 'day') return addDays(startOfDay(anchor), delta)
  if (mode === 'week') return addDays(startOfWeek(anchor), delta * 7)
  if (mode === 'month') return new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1)
  return new Date(anchor.getFullYear() + delta, 0, 1)
}

export function daysInRange(from, to) {
  const utc = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  return Math.max(1, Math.round((utc(to) - utc(from)) / DAY_MS) + 1)
}

export function eachDay(from, to, limit = 800) {
  const days = []
  const end = startOfDay(to).getTime()
  let cursor = startOfDay(from)
  while (cursor.getTime() <= end && days.length < limit) {
    days.push(cursor)
    cursor = addDays(cursor, 1)
  }
  return days
}

export function isCurrentPeriod(mode, anchor = new Date()) {
  const current = rangeForMode(mode, new Date())
  const selected = rangeForMode(mode, anchor)
  return isoDate(current.from) === isoDate(selected.from) && isoDate(current.to) === isoDate(selected.to)
}

export function isoWeekNumber(value = new Date()) {
  const d = new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d - yearStart) / DAY_MS + 1) / 7)
}

export function rangeLabel(from, to) {
  const a = startOfDay(from)
  const b = startOfDay(to)
  if (sameDay(a, b)) return `${a.getDate()} ${MONTHS_SHORT[a.getMonth()]} ${a.getFullYear()}`
  if (a.getFullYear() !== b.getFullYear()) {
    return `${a.getDate()} ${MONTHS_SHORT[a.getMonth()]} ${a.getFullYear()} – ${b.getDate()} ${MONTHS_SHORT[b.getMonth()]} ${b.getFullYear()}`
  }
  if (a.getMonth() !== b.getMonth()) {
    return `${a.getDate()} ${MONTHS_SHORT[a.getMonth()]} – ${b.getDate()} ${MONTHS_SHORT[b.getMonth()]} ${b.getFullYear()}`
  }
  return `${a.getDate()} – ${b.getDate()} ${MONTHS_SHORT[b.getMonth()]} ${b.getFullYear()}`
}

export function periodLabel(mode, anchor = new Date()) {
  if (mode === 'day') {
    return `${WEEKDAYS_SHORT[(anchor.getDay() + 6) % 7]} ${anchor.getDate()} ${MONTHS_SHORT[anchor.getMonth()]} ${anchor.getFullYear()}`
  }
  if (mode === 'week') {
    const { from, to } = rangeForMode('week', anchor)
    return rangeLabel(from, to)
  }
  if (mode === 'month') return `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`
  return String(anchor.getFullYear())
}

export function periodLongLabel(mode, anchor = new Date()) {
  if (mode === 'day') {
    return `${WEEKDAYS_LONG[anchor.getDay()]}, ${anchor.getDate()} ${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`
  }
  const { from, to } = rangeForMode(mode, anchor)
  if (mode === 'week') {
    if (from.getFullYear() !== to.getFullYear()) {
      return `${from.getDate()} ${MONTHS[from.getMonth()]} ${from.getFullYear()} – ${to.getDate()} ${MONTHS[to.getMonth()]} ${to.getFullYear()}`
    }
    return `${from.getDate()} ${MONTHS[from.getMonth()]} – ${to.getDate()} ${MONTHS[to.getMonth()]} ${to.getFullYear()}`
  }
  if (mode === 'month') return `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`
  return String(anchor.getFullYear())
}

export function periodSubtitle(mode, anchor = new Date()) {
  const current = isCurrentPeriod(mode, anchor)
  if (mode === 'day') return current ? 'Today' : 'Daily view'
  if (mode === 'week') return current ? 'This week' : `Week ${isoWeekNumber(anchor)}`
  if (mode === 'month') return current ? 'This month' : 'Monthly view'
  return current ? 'This year' : 'Yearly view'
}

export function calendarDays(cursor) {
  const first = startOfMonth(cursor)
  const start = startOfWeek(first)
  return Array.from({ length: 42 }, (_, index) => {
    const date = addDays(start, index)
    return {
      date,
      inMonth: date.getMonth() === first.getMonth(),
      isToday: sameDay(date, new Date()),
    }
  })
}

export function buildDaySeries(perDay, from, to, mode = 'day') {
  const counts = new Map()
  for (const row of perDay || []) counts.set(row._id, (counts.get(row._id) || 0) + (row.count || 0))

  return eachDay(from, to).map((date) => {
    const key = `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}`
    const weekday = (date.getDay() + 6) % 7
    return {
      key: isoDate(date),
      date,
      count: counts.get(key) || 0,
      previous: null,
      axis:
        mode === 'week'
          ? `${WEEKDAYS_SHORT[weekday]} ${date.getDate()}`
          : mode === 'year'
            ? MONTHS_SHORT[date.getMonth()]
            : `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`,
      full: `${WEEKDAYS_LONG[date.getDay()]}, ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`,
    }
  })
}

export function attachPreviousSeries(series, previousPerDay, previousRange) {
  if (!previousPerDay || !previousRange) return series
  const previous = buildDaySeries(previousPerDay, previousRange.from, previousRange.to, 'day')
  return series.map((point, index) => ({ ...point, previous: previous[index]?.count ?? 0 }))
}

export function weekdayDistribution(series) {
  const totals = Array.from({ length: 7 }, () => 0)
  for (const point of series) totals[(point.date.getDay() + 6) % 7] += point.count
  return WEEKDAYS_SHORT.map((label, index) => ({ label, count: totals[index] }))
}

export function busiestDay(series) {
  return series.reduce((best, point) => (point.count > (best?.count || 0) ? point : best), null)
}

export function delta(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) {
    return { value: 0, label: '—', direction: 'flat' }
  }
  if (previous === 0) {
    if (current === 0) return { value: 0, label: 'No change', direction: 'flat' }
    return { value: null, label: 'New', direction: 'up' }
  }
  const percent = Math.round(((current - previous) / previous) * 100)
  const direction = percent > 0 ? 'up' : percent < 0 ? 'down' : 'flat'
  return {
    value: percent,
    label: percent === 0 ? 'No change' : `${percent > 0 ? '+' : ''}${percent}%`,
    direction,
  }
}

export function formatNumber(value) {
  return new Intl.NumberFormat('en-IN').format(Number(value) || 0)
}

export function formatDecimal(value, digits = 1) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(
    Number(value) || 0,
  )
}
