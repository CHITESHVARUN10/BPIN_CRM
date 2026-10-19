import { useCallback, useEffect, useState } from 'react'
import { X, UserPlus, ShieldAlert } from 'lucide-react'
import api from '../api/client.js'
import { EmptyState, SkeletonRows, formatDate, ConfirmDialog } from '../components/ui.jsx'
import PasswordInput from '../components/PasswordInput.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'

const REGIONS = ['MUMBAI', 'PUNE / MARATHWADA', 'DELHI / PUNJAB / UP / HARYANA', 'MADHYA PRADESH', 'WEST BENGAL / NORTH EAST', 'KARNATAKA', 'KERALA', 'TAMILNADU', 'ANDHRA / TELANGANA', 'GUJARAT', 'OTHER']

function Modal({ open, onClose, children }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[75] bg-zinc-950/40 flex items-end md:items-center justify-center p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div className="card p-5 w-full max-w-md bg-white" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

const emptyForm = { name: '', email: '', phone: '', region: REGIONS[0], role: 'technician', password: '' }

export default function AdminUsers() {
  const push = useToast().push
  const { user: me } = useAuth()
  const isSuperAdmin = me?.superAdmin === true
  const [items, setItems] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [addOpen, setAddOpen] = useState(false)
  const [formErr, setFormErr] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [pwdFor, setPwdFor] = useState(null)
  const [pwdVal, setPwdVal] = useState('')
  const [confirmState, setConfirmState] = useState(null)

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const load = useCallback(() => {
    api
      .get('/users')
      .then((res) => setItems(res.data.items))
      .catch(() => setItems([]))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const addUser = async (e) => {
    e.preventDefault()
    setFormErr('')
    try {
      await api.post('/users', form)
      setAddOpen(false)
      setForm(emptyForm)
      push('User created')
      load()
    } catch (err) {
      setFormErr(err.response?.data?.message || 'Could not create user')
    }
  }

  const patch = async (id, data, message) => {
    setBusyId(id)
    try {
      await api.patch(`/users/${id}`, data)
      push(message)
      load()
    } catch (err) {
      push(err.response?.data?.message || 'Update failed', 'error')
    } finally {
      setBusyId(null)
      setPwdFor(null)
      setPwdVal('')
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Users</h1>
          <p className="text-[13px] text-zinc-500 mt-0.5">{items?.length ?? '…'} accounts</p>
        </div>
        <button type="button" className="btn btn-sm" onClick={() => setAddOpen(true)}>
          <UserPlus size={14} />
          Add user
        </button>
      </div>

      {items === null ? (
        <SkeletonRows rows={6} className="h-12" />
      ) : items.length === 0 ? (
        <EmptyState title="No users yet" />
      ) : (
        <div className="space-y-2">
          {items.map((u) => (
            <div key={String(u._id)} className="card p-4">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-zinc-900">{u.name}</p>
                    <span className={`chip capitalize ${u.role === 'admin' ? 'chip-strong' : ''}`}>{u.role}</span>
                    {u.superAdmin ? <span className="chip chip-open">Super admin</span> : null}
                    {!u.active && <span className="chip !bg-red-50 !text-red-700">Disabled</span>}
                  </div>
                  <p className="mt-0.5 text-[12.5px] text-zinc-500 truncate">{u.email}</p>
                  <p className="text-[11px] text-zinc-400">
                    {[u.region, u.phone, `Joined ${formatDate(u.createdAt)}`].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </div>
              <div className="divider my-3" />
              <div className="flex flex-wrap items-center gap-2">
                {u.role === 'admin' && !isSuperAdmin ? (
                  <span className="chip inline-flex items-center gap-1 !bg-accent/10 !text-accent">
                    <ShieldAlert size={11} />
                    Managed by super admin
                  </span>
                ) : (
                  <>
                    <select
                      className="input !min-h-[36px] !w-auto text-[12.5px]"
                      value={u.role}
                      disabled={busyId === String(u._id)}
                      onChange={(e) => patch(u._id, { role: e.target.value }, 'Role updated')}
                    >
                      <option value="technician">Technician</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline"
                      disabled={busyId === String(u._id)}
                      onClick={() => {
                        setPwdFor(u)
                        setPwdVal('')
                      }}
                    >
                      Reset password
                    </button>
                    <button
                      type="button"
                      className={`btn btn-sm ${u.active ? 'btn-ghost !text-red-700' : 'btn-outline'}`}
                      disabled={busyId === String(u._id)}
                      onClick={() => setConfirmState({
                        title: u.active ? 'Deactivate account' : 'Activate account',
                        message: u.active
                          ? `${u.name} will lose access to the portal immediately. Their filed records stay intact.`
                          : `${u.name} will regain access immediately.`,
                        danger: u.active,
                        confirmLabel: u.active ? 'Deactivate' : 'Activate',
                        user: u,
                      })}
                    >
                      {u.active ? 'Deactivate' : 'Activate'}
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-zinc-900">Add user</h2>
          <button onClick={() => setAddOpen(false)} className="p-1.5 rounded-lg text-zinc-400 hover:bg-zinc-100" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={addUser} className="space-y-3">
          <div>
            <label className="label">Name<span className="text-red-600 ml-0.5">*</span></label>
            <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} />
          </div>
          <div>
            <label className="label">Email<span className="text-red-600 ml-0.5">*</span></label>
            <input className="input" type="email" autoCapitalize="none" value={form.email} onChange={(e) => set('email', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Phone</label>
              <input className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            </div>
            <div>
              <label className="label">Region</label>
              <select className="input" value={form.region} onChange={(e) => set('region', e.target.value)}>
                {REGIONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Role</label>
              <select className="input" value={form.role} onChange={(e) => set('role', e.target.value)}>
                <option value="technician">Technician</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div>
              <label className="label">Password<span className="text-red-600 ml-0.5">*</span></label>
              <PasswordInput value={form.password} onChange={(e) => set('password', e.target.value)} placeholder="min 6 characters" />
            </div>
          </div>
          {formErr ? <p className="text-[13px] text-red-600">{formErr}</p> : null}
          <button type="submit" className="btn w-full">Create user</button>
        </form>
      </Modal>

      <Modal open={Boolean(pwdFor)} onClose={() => setPwdFor(null)}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-zinc-900">Reset password · {pwdFor?.name}</h2>
          <button onClick={() => setPwdFor(null)} className="p-1.5 rounded-lg text-zinc-400 hover:bg-zinc-100" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (pwdVal.length < 6) {
              push('Password must be at least 6 characters', 'error')
              return
            }
            patch(pwdFor._id, { password: pwdVal }, 'Password reset')
          }}
          className="space-y-3"
        >
          <div>
            <label className="label">New password<span className="text-red-600 ml-0.5">*</span></label>
            <PasswordInput value={pwdVal} onChange={(e) => setPwdVal(e.target.value)} placeholder="min 6 characters" autoFocus />
          </div>
          <button type="submit" className="btn w-full">Set password</button>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(confirmState)}
        title={confirmState?.title}
        message={confirmState?.message}
        danger={confirmState?.danger}
        confirmLabel={confirmState?.confirmLabel}
        busy={busyId !== null}
        onClose={() => setConfirmState(null)}
        onConfirm={() => {
          setConfirmState(null)
          patch(confirmState.user._id, { active: !confirmState.user.active }, confirmState.user.active ? 'Account disabled' : 'Account activated')
        }}
      />
    </div>
  )
}
