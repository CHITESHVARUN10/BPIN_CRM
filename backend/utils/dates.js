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

export function parseBounds(fromStr, toStr) {
  const from = fromStr ? startOfDay(new Date(fromStr)) : null
  const to = toStr ? endOfDay(new Date(toStr)) : null
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
