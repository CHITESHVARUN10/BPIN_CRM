export function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

export function canonicalMediaUrl(pathname) {
  return `/api/files?path=${encodeURIComponent(pathname)}`
}

export function mediaPayload(items = []) {
  return items
    .filter((item) => item?.status === 'uploaded' && item.pathname)
    .map((item) => ({ pathname: item.pathname, kind: item.kind }))
}

export function serializeDraftMedia(items = []) {
  return items
    .filter((item) => item?.status === 'uploaded' && item.pathname)
    .map((item) => ({
      id: item.id,
      pathname: item.pathname,
      url: item.url || canonicalMediaUrl(item.pathname),
      kind: item.kind,
      contentType: item.contentType,
      size: item.size,
      name: item.name,
      status: 'uploaded',
    }))
}

export function reviveDraftMedia(items = []) {
  if (!Array.isArray(items)) return []
  return items
    .filter((item) => item?.pathname)
    .map((item) => ({
      ...item,
      status: 'uploaded',
      progress: 100,
      previewUrl: item.url || canonicalMediaUrl(item.pathname),
      file: undefined,
      error: undefined,
    }))
}

export function mediaPending(items = []) {
  return items.some((item) => item?.status === 'uploading')
}

export function mediaHasErrors(items = []) {
  return items.some((item) => item?.status === 'error')
}

export function revokeLocalPreviews(items = []) {
  for (const item of items) {
    if (item?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl)
  }
}

export function extFor(contentType) {
  const map = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
  }
  return map[contentType] || 'bin'
}
