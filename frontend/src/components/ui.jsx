import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, BellRing, CalendarClock, Loader2, X } from 'lucide-react'
import api from '../api/client.js'
import { useToast } from '../context/ToastContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'

export function Field({ label, required, error, hint, children }) {
  return (
    <div>
      <label className="label">
        {label}
        {required ? <span className="text-red-600 ml-0.5">*</span> : null}
      </label>
      {children}
      {error ? <p className="mt-1.5 text-[13px] text-red-600">{error}</p> : hint ? <p className="mt-1.5 text-[12px] text-zinc-400">{hint}</p> : null}
    </div>
  )
}

export function StatCard({ label, value, sub }) {
  return (
    <div className="card p-4">
      <p className="text-[12px] font-medium text-zinc-500">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight text-zinc-900 tabular-nums">{value}</p>
      {sub ? <p className="mt-0.5 text-[12px] text-zinc-400">{sub}</p> : null}
    </div>
  )
}

export function EmptyState({ icon: Icon, title, hint, children }) {
  return (
    <div className="card p-10 flex flex-col items-center text-center">
      {Icon ? (
        <div className="w-12 h-12 rounded-2xl bg-zinc-100 grid place-items-center text-zinc-400">
          <Icon size={22} />
        </div>
      ) : null}
      <p className="mt-4 text-sm font-semibold text-zinc-800">{title}</p>
      {hint ? <p className="mt-1 text-[13px] text-zinc-500 max-w-xs">{hint}</p> : null}
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  )
}

export function SkeletonRows({ rows = 3, className = 'h-4' }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={`skeleton ${className}`} />
      ))}
    </div>
  )
}

export function formatDate(value) {
  if (!value) return '—'
  const d = new Date(value)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`
}

export function formatDateTime(value) {
  if (!value) return '—'
  const d = new Date(value)
  const pad = (n) => String(n).padStart(2, '0')
  return `${formatDate(d)} · ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const outputArray = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) outputArray[i] = raw.charCodeAt(i)
  return outputArray
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', danger, busy = false, onClose, onConfirm }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[85] bg-zinc-950/50 backdrop-blur-[2px] flex items-end md:items-center justify-center p-4" onClick={onClose}>
      <div className="card p-5 w-full max-w-sm bg-white" onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true">
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-xl grid place-items-center shrink-0 ${danger ? 'bg-red-50 text-red-600' : 'bg-zinc-100 text-zinc-600'}`}>
            <AlertTriangle size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
            <p className="mt-1 text-[13px] text-zinc-500">{message}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-zinc-400 hover:bg-zinc-100" aria-label="Close">
            <X size={15} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-5">
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={`btn ${danger ? 'btn-danger' : ''}`} onClick={onConfirm} disabled={busy}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Phone push. Environments differ a lot (Android Chrome, iOS Home-Screen app,
// LAN links without HTTPS, desktops), so every state gets an explicit,
// friendly message instead of a blanket error toast. See pushEnvironment().
// ---------------------------------------------------------------------------

function isIos() {
  const ua = navigator.userAgent || ''
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function isStandalone() {
  return navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)')?.matches === true
}

function pushEnvironment() {
  const ios = isIos()
  const standalone = isStandalone()
  if (!window.isSecureContext) return { code: 'insecure', ios, standalone }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    if (ios && !standalone) return { code: 'ios-install', ios, standalone }
    return { code: 'unsupported', ios, standalone }
  }
  return { code: 'ok', ios, standalone }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('push setup timed out')), ms)
    promise.then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) },
    )
  })
}

const PUSH_COPY = {
  enabled: 'Push is enabled on this device.',
  idle: 'Get reminders on this phone when the admin tasks you or reopens a case. If Android asks, choose “Always allow” so alerts keep working later.',
  denied: 'Notifications are blocked for this site. Allow them in the browser settings (tap the padlock/info icon next to the address), then come back and tap Enable.',
  unsupported: 'Push is not available in this browser — in-app alerts still work here.',
  insecure: 'Phone notifications need a secure connection. Open the app over HTTPS (or on localhost), then enable.',
  'ios-install': 'On iPhone and iPad, notifications work only after installing the app: Share → “Add to Home Screen”, open it from that icon, then tap Enable.',
  error: 'Setup didn’t finish. Tap Enable to try again.',
}

export function PushEnable({ state: initial = 'idle' }) {
  const push = useToast().push
  const { user } = useAuth()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(initial)

  useEffect(() => {
    let alive = true
    const detect = async () => {
      const env = pushEnvironment()
      if (env.code !== 'ok') {
        if (alive) setStatus(env.code)
        return
      }
      if (Notification.permission === 'denied') {
        if (alive) setStatus('denied')
        return
      }
      if (Notification.permission === 'granted') {
        try {
          const registration = await withTimeout(navigator.serviceWorker.ready, 8000)
          const existing = await registration.pushManager.getSubscription()
          if (alive) setStatus(existing ? 'enabled' : 'idle')
        } catch {
          if (alive) setStatus('idle')
        }
      }
    }
    if (user) detect()
    return () => {
      alive = false
    }
  }, [user])

  const beginSubscribe = useCallback(async () => {
    const env = pushEnvironment()
    if (env.code !== 'ok') {
      setStatus(env.code)
      return
    }

    setBusy(true)
    try {
      let publicKey = ''
      try {
        const { data } = await api.get('/push/vapid-public')
        publicKey = data.publicKey || ''
      } catch {
        setStatus('error')
        push('Couldn’t reach the server — check the connection and try again.', 'error')
        return
      }
      if (!publicKey) {
        setStatus('unsupported')
        return
      }

      let permission = Notification.permission
      if (permission === 'default') {
        permission = await Notification.requestPermission().catch(() => 'denied')
      }
      if (permission !== 'granted') {
        // The user chose to block the prompt (or Android "Don't allow") —
        // not an error, just explain how to change it later.
        setStatus('denied')
        return
      }

      let registration
      try {
        registration = await withTimeout(navigator.serviceWorker.ready, 10000)
      } catch {
        if (env.ios && !env.standalone) {
          setStatus('ios-install')
        } else {
          setStatus('error')
          push('Notifications couldn’t finish setting up on this device — reload the app and try again.', 'error')
        }
        return
      }

      let subscription = null
      try {
        subscription = await registration.pushManager.getSubscription()
      } catch {
        subscription = null
      }
      if (!subscription) {
        const subscribe = () => registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        })
        try {
          subscription = await subscribe()
        } catch {
          // transient failures happen on Android Chrome — one quiet retry
          try {
            await new Promise((r) => setTimeout(r, 600))
            subscription = await subscribe()
          } catch {
            subscription = null
          }
        }
        if (!subscription) {
          if (env.ios && !env.standalone) {
            setStatus('ios-install')
          } else {
            setStatus('error')
            push('This device couldn’t subscribe right now — try again in a moment.', 'error')
          }
          return
        }
      }

      try {
        await api.post('/push/subscription', { subscription: subscription.toJSON() })
      } catch {
        setStatus('error')
        push('Almost there — syncing with the server failed. Tap Enable to retry.', 'error')
        return
      }

      setStatus('enabled')
      push('Phone notifications are now enabled')
    } finally {
      setBusy(false)
    }
  }, [push])

  if (!user) return null

  const showButton = status === 'idle' || status === 'denied' || status === 'error'

  return (
    <div className="card p-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-zinc-100 grid place-items-center text-zinc-600">
          <BellRing size={17} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-zinc-900">Phone notifications</p>
          <p className="mt-0.5 text-[12.5px] text-zinc-500">{PUSH_COPY[status] || PUSH_COPY.idle}</p>
        </div>
        {showButton ? (
          <button type="button" onClick={beginSubscribe} disabled={busy} className="btn btn-sm btn-outline shrink-0">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <CalendarClock size={14} />}
            Enable
          </button>
        ) : null}
      </div>
    </div>
  )
}
