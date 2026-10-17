import Counter from '../models/Counter.js'

function dateKey(d = new Date()) {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}${mm}${d.getFullYear()}`
}

export async function nextToken() {
  const key = dateKey()
  const seq = await Counter.nextKey(key)
  return `${key}-${String(seq).padStart(4, '0')}`
}
