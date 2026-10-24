// applyConstraints replaces the previous constraint set. Sending only zoom or
// focus can discard the high-resolution request and degrade tiny-code reads.
export function applyCameraControls(track, controls) {
  const current = track.getConstraints?.() || {}
  const advanced = Object.assign({}, ...(current.advanced || []), controls)
  const next = { ...current, advanced: [advanced] }
  for (const key of Object.keys(controls)) delete next[key]
  if (controls.focusMode && controls.focusMode !== 'manual') {
    delete advanced.focusDistance
    delete next.focusDistance
  }
  return track.applyConstraints(next)
}

export function loadPreferredCamera() {
  try { return sessionStorage.getItem('bpin.qr.camera') || '' } catch { return '' }
}

export function savePreferredCamera(id) {
  try {
    if (id) sessionStorage.setItem('bpin.qr.camera', id)
    else sessionStorage.removeItem('bpin.qr.camera')
  } catch { /* Private browsing may disable storage. */ }
}
