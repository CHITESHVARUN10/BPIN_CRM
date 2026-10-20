export function escapeRx(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function isObjectId(value) {
  return /^[a-fA-F0-9]{24}$/.test(String(value || ''))
}
