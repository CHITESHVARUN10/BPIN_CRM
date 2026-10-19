import { useState } from 'react'
import { KeyRound, Loader2 } from 'lucide-react'
import api from '../api/client.js'
import { Field, PushEnable } from '../components/ui.jsx'
import PasswordInput from '../components/PasswordInput.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'

const LABELS = [
  ['Name', 'name'],
  ['Email', 'email'],
  ['Phone', 'phone'],
  ['Region', 'region'],
  ['Role', 'role'],
]

export default function Profile() {
  const { user } = useAuth()
  const push = useToast().push
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    const errs = {}
    if (!current) errs.current = 'Enter your current password'
    if (next.length < 6) errs.next = 'At least 6 characters'
    if (next !== confirm) errs.confirm = 'Passwords do not match'
    setErrors(errs)
    if (Object.keys(errs).length) return

    setBusy(true)
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: next })
      push('Password updated')
      setCurrent('')
      setNext('')
      setConfirm('')
    } catch (err) {
      push(err.response?.data?.message || 'Could not update password', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Profile</h1>
        <p className="text-[13px] text-zinc-500 mt-0.5">Your account details</p>
      </div>

      <div className="card p-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-zinc-900 text-white grid place-items-center text-sm font-semibold">
            {user?.name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')}
          </div>
          <div>
            <p className="text-sm font-semibold text-zinc-900">{user?.name}</p>
            <p className="text-[12px] text-zinc-500 capitalize">{user?.role}</p>
          </div>
        </div>
        <div className="divider my-4" />
        <dl className="space-y-3">
          {LABELS.map(([label, key]) => (
            <div key={key} className="flex items-center justify-between gap-4">
              <dt className="text-[12px] font-medium text-zinc-400 uppercase tracking-wide">{label}</dt>
              <dd className="text-sm text-zinc-900 text-right break-all">{user?.[key] || '—'}</dd>
            </div>
          ))}
        </dl>
      </div>

      <PushEnable />

      <form onSubmit={submit} className="card p-4 space-y-3.5">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-zinc-100 grid place-items-center text-zinc-600">
            <KeyRound size={16} />
          </div>
          <h2 className="text-sm font-semibold text-zinc-900">Change password</h2>
        </div>
        <Field label="Current password" required error={errors.current}>
          <PasswordInput value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </Field>
        <Field label="New password" required error={errors.next}>
          <PasswordInput value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="Confirm new password" required error={errors.confirm}>
          <PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </Field>
        <button type="submit" className="btn w-full" disabled={busy}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : null}
          Update password
        </button>
      </form>
    </div>
  )
}
