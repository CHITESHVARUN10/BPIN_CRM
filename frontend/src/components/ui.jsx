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

export function PushEnable({ state: initial = 'idle' }) {
  const push = useToast().push
  const { user } = useAuth()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(initial)

  useEffect(() => {
    let alive = true
    const detect = async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        if (alive) setStatus('unsupported')
        return
      }
      if (Notification.permission === 'granted') {
        try {
          const registration = await navigator.serviceWorker.ready
          const existing = await registration.pushManager.getSubscription()
          if (alive) setStatus(existing ? 'enabled' : 'idle')
        } catch {
          if (alive) setStatus('idle')
        }
      } else if (Notification.permission === 'denied') {
        if (alive) setStatus('denied')
      }
    }
    if (user) detect()
    return () => {
      alive = false
    }
  }, [user])

  const beginSubscribe = useCallback(async () => {
    setBusy(true)
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setStatus('unsupported')
        return
      }
      const { data } = await api.get('/push/vapid-public')
      if (!data.publicKey) {
        setStatus('unsupported')
        return
      }
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setStatus('denied')
        return
      }
      const registration = await navigator.serviceWorker.ready
      const existing = await registration.pushManager.getSubscription()
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(data.publicKey),
        }))
      await api.post('/push/subscription', { subscription: subscription.toJSON() })
      setStatus('enabled')
      push('Phone notifications are now enabled')
    } catch {
      setStatus('denied')
      push('Could not enable phone notifications. In-app alerts still work.', 'error')
    } finally {
      setBusy(false)
    }
  }, [push])

  if (!user) return null

  return (
    <div className="card p-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-zinc-100 grid place-items-center text-zinc-600">
          <BellRing size={17} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-zinc-900">Phone notifications</p>
          <p className="mt-0.5 text-[12.5px] text-zinc-500">
            {status === 'enabled'
              ? 'Push is enabled on this device.'
              : status === 'denied'
                ? 'Permission is blocked in the browser settings — in-app alerts still work here.'
                : status === 'unsupported'
                  ? 'Push is not available on this device — in-app alerts still work.'
                  : 'Get reminders on this phone when the admin tasks you or reopens a case.'}
          </p>
        </div>
        {status !== 'enabled' && status !== 'unsupported' ? (
          <button type="button" onClick={beginSubscribe} disabled={busy} className="btn btn-sm btn-outline shrink-0">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <CalendarClock size={14} />}
            Enable
          </button>
        ) : null}
      </div>
    </div>
  )
}
