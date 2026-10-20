export function startOfDay(d = new Date()) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function endOfDay(d = new Date()) {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}

export function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function badDate(label) {
  const err = new Error(`Invalid ${label} date`)
  err.status = 400
  return err
}

export function parseDateInput(value, label = 'date') {
  if (value === undefined || value === null || value === '') return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw badDate(label)
  return date
}

export function parseBounds(fromStr, toStr) {
  const from = fromStr ? startOfDay(parseDateInput(fromStr, 'from')) : null
  const to = toStr ? endOfDay(parseDateInput(toStr, 'to')) : null
  return { from, to }
}

function pad(n) {
  return String(n).padStart(2, '0')
}

export function subDaysToStart(days) {
  const d = startOfDay()
  d.setDate(d.getDate() - days)
  return d
}

export function formatDateLabel(d) {
  if (!d) return ''
  const x = new Date(d)
  return `${pad(x.getDate())}-${pad(x.getMonth() + 1)}-${x.getFullYear()}`
}
