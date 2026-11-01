import { useCallback, useEffect, useState } from 'react'
import { KeyRound, Pencil, ShieldAlert, UserCheck, UserPlus, UserX, X } from 'lucide-react'
import api from '../api/client.js'
import { EmptyState, SkeletonRows, formatDate, ConfirmDialog } from '../components/ui.jsx'
import PasswordInput from '../components/PasswordInput.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'

const REGIONS = ['MUMBAI', 'PUNE / MARATHWADA', 'DELHI / PUNJAB / UP / HARYANA', 'MADHYA PRADESH', 'WEST BENGAL / NORTH EAST', 'KARNATAKA', 'KERALA', 'TAMILNADU', 'ANDHRA / TELANGANA', 'GUJARAT', 'OTHER']

const ROLE_STYLES = {
  admin: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-300',
  technician: 'border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900/70 dark:bg-teal-950/40 dark:text-teal-300',
}
const SUPER_ADMIN_STYLE = 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/70 dark:bg-violet-950/40 dark:text-violet-300'

const AVATAR_STYLES = [
  'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300',
  'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
]

function avatarStyle(name = '') {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return AVATAR_STYLES[Math.abs(hash) % AVATAR_STYLES.length]
}

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

function initials(name = '') {
  return (
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join('') || '?'
  )
}

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
  const [editFor, setEditFor] = useState(null)
  const [editForm, setEditForm] = useState({ name: '', phone: '', region: REGIONS[0], role: 'technician' })

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const setEdit = (k, v) => setEditForm((f) => ({ ...f, [k]: v }))

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
      return true
    } catch (err) {
      push(err.response?.data?.message || 'Update failed', 'error')
      return false
    } finally {
      setBusyId(null)
      setPwdFor(null)
      setPwdVal('')
    }
  }

  const openEdit = (user) => {
    setEditFor(user)
    setEditForm({
      name: user.name || '',
      phone: user.phone || '',
      region: user.region || REGIONS[0],
      role: user.role || 'technician',
    })
  }

  const saveEdit = async (event) => {
    event.preventDefault()
    if (!editFor) return
    if (!editForm.name.trim()) {
      push('Name is required', 'error')
      return
    }

    const payload = {
      name: editForm.name.trim(),
      phone: editForm.phone.trim(),
      region: editForm.region,
    }
    if (isSuperAdmin && String(editFor._id) !== String(me?._id)) payload.role = editForm.role
    const saved = await patch(editFor._id, payload, 'User updated')
    if (saved) setEditFor(null)
  }

  const selfId = String(me?._id || '')

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Users</h1>
          <p className="text-[13px] text-zinc-500 mt-0.5">{items?.length ?? '…'} accounts</p>
        </div>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            setForm((f) => ({ ...f, role: isSuperAdmin ? f.role : 'technician' }))
            setAddOpen(true)
          }}
        >
          <UserPlus size={14} />
          Add user
        </button>
      </div>

      {items === null ? (
        <SkeletonRows rows={6} className="h-12" />
      ) : items.length === 0 ? (
        <EmptyState title="No users yet" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="data-table min-w-[980px]">
            <thead>
              <tr>
                <th className="w-[280px]">User</th>
                <th className="w-[150px]">Role</th>
                <th className="w-[180px]">Region</th>
                <th className="w-[120px]">Status</th>
                <th className="w-[360px] text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => {
                const self = String(u._id) === selfId
                const lockedAdmin = u.role === 'admin' && !isSuperAdmin
                return (
                  <tr key={String(u._id)} className={!u.active ? 'opacity-60' : ''}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[10px] font-semibold ring-1 ring-black/5 dark:ring-white/10 ${avatarStyle(u.name)}`}
                        >
                          {initials(u.name)}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="truncate text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">{u.name}</p>
                            {u.superAdmin ? (
                              <span
                                className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${SUPER_ADMIN_STYLE}`}
                              >
                                Super admin
                              </span>
                            ) : null}
                          </div>
                          <p className="truncate text-[11px] text-zinc-500">{u.email}</p>
                          {u.phone ? <p className="text-[10px] text-zinc-400">{u.phone}</p> : null}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span
                        className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          ROLE_STYLES[u.role] || ROLE_STYLES.technician
                        }`}
                      >
                        {u.role}
                      </span>
                    </td>
                    <td>
                      <p className="text-[12px] text-zinc-600 dark:text-zinc-300">{u.region || '—'}</p>
                      <p className="text-[10px] text-zinc-400">Joined {formatDate(u.createdAt)}</p>
                    </td>
                    <td>
                      <span
                        className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${
                          u.active ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-400'
                        }`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${u.active ? 'bg-emerald-500' : 'bg-zinc-400'}`} />
                        {u.active ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td>
                      {lockedAdmin ? (
                        <div className="flex justify-end">
                          <span className="chip inline-flex items-center gap-1 !bg-accent/10 !text-accent">
                            <ShieldAlert size={11} />
                            Managed by super admin
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                          <button
                            type="button"
                            className="btn btn-sm btn-outline"
                            disabled={busyId === String(u._id)}
                            onClick={() => openEdit(u)}
                          >
                            <Pencil size={13} />
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline"
                            disabled={busyId === String(u._id)}
                            onClick={() => {
                              setPwdFor(u)
                              setPwdVal('')
                            }}
                          >
                            <KeyRound size={13} />
                            Reset
                          </button>
                          <button
                            type="button"
                            className={`btn btn-sm ${u.active ? 'btn-ghost btn-danger-ghost' : 'btn-outline'}`}
                            disabled={busyId === String(u._id) || (self && u.active)}
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
                            {u.active ? <UserX size={13} /> : <UserCheck size={13} />}
                            {u.active ? 'Deactivate' : 'Activate'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
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
                {isSuperAdmin ? <option value="admin">Admin</option> : null}
              </select>
              {!isSuperAdmin ? (
                <p className="mt-1 text-[11px] text-zinc-400">Only the super admin can create administrator accounts.</p>
              ) : null}
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

      <Modal open={Boolean(editFor)} onClose={() => setEditFor(null)}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-zinc-900">Edit user</h2>
          <button onClick={() => setEditFor(null)} className="p-1.5 rounded-lg text-zinc-400 hover:bg-zinc-100" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={saveEdit} className="space-y-3">
          <div>
            <label className="label">Name<span className="text-red-600 ml-0.5">*</span></label>
            <input className="input" value={editForm.name} onChange={(e) => setEdit('name', e.target.value)} />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input bg-zinc-50 text-zinc-500" value={editFor?.email || ''} readOnly />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Phone</label>
              <input className="input" value={editForm.phone} onChange={(e) => setEdit('phone', e.target.value)} />
            </div>
            <div>
              <label className="label">Region</label>
              <select className="input" value={editForm.region} onChange={(e) => setEdit('region', e.target.value)}>
                {REGIONS.map((region) => (
                  <option key={region} value={region}>{region}</option>
                ))}
                {editForm.region && !REGIONS.includes(editForm.region) ? (
                  <option value={editForm.region}>{editForm.region}</option>
                ) : null}
              </select>
            </div>
          </div>
          {isSuperAdmin ? (
            <div>
              <label className="label">Role</label>
              <select
                className="input"
                value={editForm.role}
                disabled={String(editFor?._id) === selfId}
                onChange={(e) => setEdit('role', e.target.value)}
              >
                <option value="technician">Technician</option>
                <option value="admin">Admin</option>
              </select>
              {String(editFor?._id) === selfId ? (
                <p className="mt-1 text-[11px] text-zinc-400">You cannot change your own admin role.</p>
              ) : null}
            </div>
          ) : null}
          <button type="submit" className="btn w-full" disabled={busyId === String(editFor?._id)}>
            {busyId === String(editFor?._id) ? 'Saving…' : 'Save changes'}
          </button>
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
