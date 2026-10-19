import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  History,
  Images,
  Loader2,
  Lock,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  ShieldOff,
  X,
} from 'lucide-react'
import api from '../api/client.js'
import { EmptyState, SkeletonRows, formatDateTime } from '../components/ui.jsx'
import PasswordInput from '../components/PasswordInput.jsx'

const MODES = [
  { id: 'db', label: 'Database only', icon: Database, hint: 'Roll MongoDB back to the checkpoint. Media files are not written; missing references are reported.' },
  { id: 'assets', label: 'Images and videos only', icon: Images, hint: 'Restore missing media and verify existing assets. MongoDB is left untouched.' },
  { id: 'both', label: 'Database + images/videos', icon: ShieldCheck, hint: 'Restore the database and reconcile every referenced asset with Blob storage.' },
]

const TERMINAL = ['completed', 'partial_failure', 'rolled_back', 'failed', 'manual_intervention_required']
const STATUS_LABELS = {
  pending: 'Queued',
  validating: 'Validating',
  snapshotting: 'Creating snapshot',
  ready: 'Ready',
  restoring_database: 'Restoring database',
  restoring_assets: 'Restoring media',
  verifying: 'Verifying',
  completed: 'Completed',
  partial_failure: 'Partial failure',
  rolling_back: 'Rolling back',
  rolled_back: 'Rolled back',
  failed: 'Failed',
  manual_intervention_required: 'Manual intervention required',
}

const BACKUP_STATUS_LABELS = {
  completed: 'Completed',
  running: 'Running',
  failed: 'Failed',
  rotated: 'Rotated',
}

const BACKUP_ACTION_LABELS = {
  backup_started: 'Backup started',
  backup_completed: 'Backup completed',
  backup_failed: 'Backup failed',
  backup_retry: 'Automatic retry',
  backup_retry_manual: 'Manual retry',
  backup_rotated: 'Old generation rotated',
  backup_attempt_skipped: 'Attempt skipped',
  backup_attempt_failed: 'Attempt failed',
  backup_worker_failed: 'Worker error',
}

const apiError = (err, fallback) => err?.response?.data?.message || err?.message || fallback
const isRecoveryAuthError = (err) => err?.response?.data?.code === 'recovery_auth_required' || err?.response?.status === 403

function bytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function Modal({ open, title, onClose, children, wide = false }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[85] bg-zinc-950/50 backdrop-blur-[2px] flex items-end md:items-center justify-center p-4" onClick={onClose}>
      <div className={`card p-5 w-full ${wide ? 'max-w-lg' : 'max-w-md'} bg-white`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-zinc-400 hover:bg-zinc-100" aria-label="Close">
            <X size={15} />
          </button>
        </div>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  )
}

function statusChip(status) {
  if (status === 'completed') return 'chip chip-strong'
  if (status === 'partial_failure') return 'chip chip-open'
  if (status === 'failed' || status === 'manual_intervention_required') return 'chip !bg-red-50 !text-red-700'
  if (status === 'rolled_back') return 'chip'
  return 'chip'
}

function backupStatusChip(status) {
  if (status === 'completed') return 'chip chip-strong'
  if (status === 'running') return 'chip chip-open'
  if (status === 'failed') return 'chip !bg-red-50 !text-red-700'
  return 'chip'
}

export default function AdminRecovery() {
  const [session, setSession] = useState(null)
  const [password, setPassword] = useState('')
  const [reauthBusy, setReauthBusy] = useState(false)
  const [reauthError, setReauthError] = useState('')

  const [checkpoints, setCheckpoints] = useState(null)
  const [inventoryError, setInventoryError] = useState('')
  const [inventoryBusy, setInventoryBusy] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const [mode, setMode] = useState('both')

  const [plan, setPlan] = useState(null)
  const [planBusy, setPlanBusy] = useState(false)
  const [planError, setPlanError] = useState('')

  const [dialog1, setDialog1] = useState(false)
  const [dialog2, setDialog2] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [startBusy, setStartBusy] = useState(false)
  const [startError, setStartError] = useState('')

  const [operation, setOperation] = useState(null)
  const [operations, setOperations] = useState([])
  const [rollbackBusy, setRollbackBusy] = useState(false)
  const [activity, setActivity] = useState(null)
  const [activityBusy, setActivityBusy] = useState(false)
  const [activityError, setActivityError] = useState('')
  const pollRef = useRef(null)

  const selected = useMemo(() => (checkpoints || []).find((c) => c.id === selectedId) || null, [checkpoints, selectedId])
  const elevated = session?.authenticated === true
  const opActive = operation && !TERMINAL.includes(operation.status)

  const handleApiError = useCallback((err) => {
    if (isRecoveryAuthError(err) && (err?.response?.data?.code === 'recovery_auth_required')) {
      setSession({ authenticated: false, expiresInSec: 0 })
    }
  }, [])

  const loadSession = useCallback(async () => {
    try {
      const { data } = await api.get('/recovery/session')
      setSession(data)
      return data
    } catch (err) {
      setSession({ authenticated: false, expiresInSec: 0 })
      return { authenticated: false }
    }
  }, [])

  const loadInventory = useCallback(async () => {
    setInventoryBusy(true)
    setInventoryError('')
    try {
      const { data } = await api.get('/recovery/checkpoints')
      setCheckpoints(data.items || [])
      setSelectedId((prev) => (prev && data.items.some((c) => c.id === prev) ? prev : data.items.find((c) => c.valid)?.id || ''))
    } catch (err) {
      setCheckpoints([])
      setInventoryError(apiError(err, 'Could not load backup checkpoints'))
      handleApiError(err)
    } finally {
      setInventoryBusy(false)
    }
  }, [handleApiError])

  const loadOperations = useCallback(async () => {
    try {
      const { data } = await api.get('/recovery/operations')
      setOperations(data.items || [])
    } catch {
      // recent operations are informational
    }
  }, [])

  const loadBackupActivity = useCallback(async () => {
    setActivityBusy(true)
    setActivityError('')
    try {
      const { data } = await api.get('/recovery/backup-activity')
      setActivity({ runs: data.runs || [], events: data.events || [] })
    } catch (err) {
      setActivity({ runs: [], events: [] })
      setActivityError(apiError(err, 'Could not load backup activity'))
      handleApiError(err)
    } finally {
      setActivityBusy(false)
    }
  }, [handleApiError])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const state = await loadSession()
      if (!alive) return
      if (state.authenticated) {
        loadInventory()
        loadOperations()
        loadBackupActivity()
      }
    })()
    return () => {
      alive = false
    }
  }, [loadSession, loadInventory, loadOperations, loadBackupActivity])

  useEffect(() => {
    setPlan(null)
    setPlanError('')
  }, [selectedId, mode])

  useEffect(() => {
    if (operation?.id && !TERMINAL.includes(operation.status)) {
      clearInterval(pollRef.current)
      pollRef.current = setInterval(async () => {
        try {
          // skipAuthRedirect: while the users collection is atomically swapped
          // during a restore, an in-flight request can briefly see no user.
          // Keep polling instead of logging the operator out.
          const { data } = await api.get(`/recovery/operations/${operation.id}`, { skipAuthRedirect: true })
          setOperation(data.operation)
          if (TERMINAL.includes(data.operation.status)) {
            clearInterval(pollRef.current)
            loadOperations()
          }
        } catch (err) {
          if (err?.response?.status === 401) return
          clearInterval(pollRef.current)
          handleApiError(err)
        }
      }, 2000)
    }
    return () => clearInterval(pollRef.current)
  }, [operation?.id, operation?.status, loadOperations, handleApiError])

  async function onReauth(e) {
    e.preventDefault()
    setReauthBusy(true)
    setReauthError('')
    try {
      const { data } = await api.post('/recovery/reauth', { password })
      setPassword('')
      setSession(data)
      await loadInventory()
      await loadOperations()
      await loadBackupActivity()
    } catch (err) {
      setReauthError(apiError(err, 'Re-authentication failed'))
    } finally {
      setReauthBusy(false)
    }
  }

  async function onLock() {
    try {
      await api.post('/recovery/session/lock')
    } catch {
      // session may already be expired
    }
    setSession({ authenticated: false, expiresInSec: 0 })
    setPlan(null)
    setCheckpoints(null)
    setOperation(null)
  }

  async function onDryRun() {
    if (!selected) return
    setPlanBusy(true)
    setPlanError('')
    try {
      const { data } = await api.post('/recovery/dry-run', { checkpointId: selected.id, mode })
      setPlan(data.plan)
    } catch (err) {
      setPlan(null)
      setPlanError(apiError(err, 'Dry-run failed'))
      handleApiError(err)
    } finally {
      setPlanBusy(false)
    }
  }

  async function onStart() {
    if (!selected || !plan?.canProceed) return
    setStartBusy(true)
    setStartError('')
    try {
      const { data } = await api.post('/recovery/operations', {
        checkpointId: selected.id,
        mode,
        confirmation: confirmText,
        acknowledge: acknowledged,
      })
      setDialog1(false)
      setDialog2(false)
      setConfirmText('')
      setAcknowledged(false)
      setOperation({ id: data.operationId, status: 'pending', progress: 0, phase: 'Queued', mode, steps: [] })
      await loadOperations()
    } catch (err) {
      setStartError(apiError(err, 'Could not start the restore'))
      handleApiError(err)
    } finally {
      setStartBusy(false)
    }
  }

  async function onRollback(id) {
    setRollbackBusy(true)
    try {
      await api.post(`/recovery/operations/${id}/rollback`)
      const { data } = await api.get(`/recovery/operations/${id}`)
      setOperation(data.operation)
      await loadOperations()
    } catch (err) {
      setStartError(apiError(err, 'Could not start the rollback'))
      handleApiError(err)
    } finally {
      setRollbackBusy(false)
    }
  }

  const canRollback = operation && ['failed', 'manual_intervention_required', 'partial_failure'].includes(operation.status) && operation.snapshot

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <ShieldCheck size={20} /> Recovery
          </h1>
          <p className="text-[13px] text-zinc-500 mt-0.5">Inspect Google Drive backups and restore the CRM to a checkpoint.</p>
        </div>
        {elevated ? (
          <div className="flex items-center gap-2">
            <span className="chip chip-strong">Elevated access</span>
            <button className="btn btn-sm btn-outline" onClick={onLock}>
              <Lock size={14} /> Lock
            </button>
          </div>
        ) : null}
      </div>

      {!elevated ? (
        <div className="card p-5 max-w-md">
          <div className="w-10 h-10 rounded-xl bg-zinc-100 grid place-items-center text-zinc-600">
            <ShieldOff size={18} />
          </div>
          <h2 className="mt-3 text-sm font-semibold text-zinc-900">Re-authenticate to continue</h2>
          <p className="mt-1 text-[13px] text-zinc-500">
            Recovery is a privileged operation. Confirm your password to open a short-lived recovery session
            {session?.expiresInSec ? ` (${Math.round(session.expiresInSec / 60)} min of inactivity)` : ''}.
          </p>
          <form onSubmit={onReauth} className="mt-4 space-y-3">
            <div>
              <label className="label">Password</label>
              <PasswordInput
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your account password"
              />
            </div>
            {reauthError ? <p className="text-[13px] text-red-600">{reauthError}</p> : null}
            <button className="btn w-full" disabled={reauthBusy || !password}>
              {reauthBusy ? <Loader2 size={15} className="animate-spin" /> : <Lock size={15} />}
              Unlock recovery
            </button>
          </form>
          <p className="mt-3 text-[11.5px] text-zinc-400">Failed attempts are rate-limited and recorded in the audit log.</p>
        </div>
      ) : (
        <>
          <div className="card p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-zinc-900">Backup checkpoints</h2>
                <p className="text-[12.5px] text-zinc-500 mt-0.5">Valid checkpoints are verified against their manifest before any restore.</p>
              </div>
              <button className="btn btn-sm btn-outline" onClick={loadInventory} disabled={inventoryBusy}>
                {inventoryBusy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                Refresh
              </button>
            </div>

            <div className="mt-3">
              {inventoryBusy && !checkpoints ? (
                <SkeletonRows rows={3} className="h-14" />
              ) : inventoryError ? (
                <p className="text-[13px] text-red-600">{inventoryError}</p>
              ) : (checkpoints || []).length === 0 ? (
                <EmptyState icon={Database} title="No checkpoints found" hint="No completed backup folders exist in the configured Google Drive location." />
              ) : (
                <div className="space-y-2">
                  {checkpoints.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedId(c.id)}
                      className={`w-full text-left card p-3.5 transition border ${selectedId === c.id ? 'border-zinc-900' : 'border-transparent hover:border-zinc-200'}`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`chip ${c.valid ? 'chip-strong' : '!bg-red-50 !text-red-700'}`}>{c.valid ? 'Valid' : 'Invalid'}</span>
                        <p className="text-sm font-semibold text-zinc-900">{c.name}</p>
                        <span className="text-[11px] text-zinc-400 ml-auto">{formatDateTime(c.completedAt || c.cutoffAt)}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-zinc-500">
                        <span className="inline-flex items-center gap-1">
                          <Database size={13} /> {c.db.valid ? `${c.db.docs} docs` : 'DB invalid'}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Images size={13} /> {c.media.files} media · {bytes(c.media.bytes)}
                        </span>
                        <span>db {bytes(c.db.bytes)}</span>
                        <span>total {bytes(c.totals.totalBytes)}</span>
                        <span className="text-zinc-400">id {String(c.id).slice(-10)}</span>
                      </div>
                      {!c.valid && c.errors.length ? (
                        <p className="mt-1.5 text-[12px] text-red-600 break-words">{c.errors.slice(0, 3).join(' · ')}</p>
                      ) : null}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-zinc-900 flex items-center gap-2">
                  <History size={15} />
                  Backup activity
                </h2>
                <p className="text-[12.5px] text-zinc-500 mt-0.5">
                  Every cron attempt, result and rotation recorded in MongoDB. Visible only to the super admin.
                </p>
              </div>
              <button className="btn btn-sm btn-outline" onClick={loadBackupActivity} disabled={activityBusy}>
                {activityBusy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                Refresh
              </button>
            </div>

            <div className="mt-3 space-y-4">
              {activityBusy && !activity ? (
                <SkeletonRows rows={3} className="h-12" />
              ) : activityError ? (
                <p className="text-[13px] text-red-600">{activityError}</p>
              ) : !activity || (!activity.runs.length && !activity.events.length) ? (
                <EmptyState
                  icon={History}
                  title="No backup activity yet"
                  hint="Start attempts and results from the backup cron will appear here."
                />
              ) : (
                <>
                  {activity.runs.length ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-[12px] min-w-[620px]">
                        <thead>
                          <tr className="text-left text-[10.5px] uppercase tracking-wider text-zinc-400 border-b border-zinc-200">
                            <th className="py-1.5 pr-3 font-medium">Backup</th>
                            <th className="py-1.5 pr-3 font-medium">Status</th>
                            <th className="py-1.5 pr-3 font-medium">Started</th>
                            <th className="py-1.5 pr-3 font-medium">Finished</th>
                            <th className="py-1.5 font-medium">Content</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activity.runs.map((run) => (
                            <tr key={run.id} className="border-t border-zinc-100 align-top">
                              <td className="py-1.5 pr-3">
                                <span className="font-medium text-zinc-800">{run.folder || '—'}</span>
                                {run.lastError ? <p className="text-[11px] text-red-600 break-words mt-0.5">{run.lastError}</p> : null}
                              </td>
                              <td className="py-1.5 pr-3">
                                <span className={backupStatusChip(run.status)}>
                                  {BACKUP_STATUS_LABELS[run.status] || run.status}
                                </span>
                                {run.retryAttempts ? (
                                  <span className="block text-[10.5px] text-zinc-400 mt-0.5">retry {run.retryAttempts}</span>
                                ) : null}
                              </td>
                              <td className="py-1.5 pr-3 text-zinc-500 whitespace-nowrap">
                                {run.startedAt ? formatDateTime(run.startedAt) : '—'}
                              </td>
                              <td className="py-1.5 pr-3 text-zinc-500 whitespace-nowrap">
                                {run.completedAt ? formatDateTime(run.completedAt) : '—'}
                              </td>
                              <td className="py-1.5 text-zinc-500 whitespace-nowrap">
                                {run.docs} docs · {run.mediaFiles} media ({bytes(run.mediaBytes)})
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}

                  {activity.events.length ? (
                    <div>
                      <p className="text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400">
                        Recent attempts and results
                      </p>
                      <div className="mt-1.5 max-h-56 overflow-y-auto space-y-1.5">
                        {activity.events.map((event, index) => (
                          <div key={`${event.at || 'event'}-${index}`} className="rounded-lg bg-zinc-50 px-2.5 py-1.5">
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                              <span className="text-[10.5px] text-zinc-400 tabular-nums">
                                {event.at ? formatDateTime(event.at) : '—'}
                              </span>
                              <span className="text-[12px] font-medium text-zinc-800">
                                {BACKUP_ACTION_LABELS[event.action] || event.action}
                              </span>
                              {event.targetLabel ? (
                                <span className="text-[10.5px] text-zinc-400">{event.targetLabel}</span>
                              ) : null}
                            </div>
                            {event.detail ? (
                              <p className="mt-0.5 text-[11.5px] text-zinc-500 break-words">{event.detail}</p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>

          {selected ? (
            <div className="card p-4 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-zinc-900">Restoration mode</h2>
                <p className="text-[12.5px] text-zinc-500 mt-0.5">Choose exactly one mode, then run the dry-run analysis.</p>
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                {MODES.map((m) => {
                  const eligible = selected.restorable[m.id] || (m.id === 'assets' && selected.media.files === 0)
                  return (
                    <button
                      key={m.id}
                      type="button"
                      disabled={!eligible}
                      onClick={() => setMode(m.id)}
                      className={`text-left card p-3 border transition ${mode === m.id ? 'border-zinc-900' : 'border-transparent'} ${eligible ? 'hover:border-zinc-300' : 'opacity-50 cursor-not-allowed'}`}
                    >
                      <div className="flex items-center gap-2">
                        <m.icon size={16} />
                        <p className="text-[13px] font-semibold text-zinc-900">{m.label}</p>
                      </div>
                      <p className="mt-1 text-[12px] text-zinc-500">{m.hint}</p>
                    </button>
                  )
                })}
              </div>

              <div className="flex items-center gap-2">
                <button className="btn btn-sm" onClick={onDryRun} disabled={planBusy || !selectedId}>
                  {planBusy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                  Run dry-run analysis
                </button>
                {planError ? <p className="text-[13px] text-red-600">{planError}</p> : null}
              </div>

              {plan ? (
                <div className="rounded-xl border border-zinc-200 p-3.5 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`chip ${plan.canProceed ? 'chip-strong' : '!bg-red-50 !text-red-700'}`}>{plan.canProceed ? 'Ready to restore' : 'Cannot restore'}</span>
                    <span className="text-[12px] text-zinc-500">{MODES.find((m) => m.id === plan.mode)?.label}</span>
                  </div>

                  {plan.errors.length ? (
                    <div className="rounded-lg bg-red-50 p-2.5">
                      <p className="text-[12px] font-semibold text-red-700">Integrity problems</p>
                      <ul className="mt-1 list-disc list-inside text-[12px] text-red-700 space-y-0.5">
                        {plan.errors.map((e, i) => <li key={i}>{e}</li>)}
                      </ul>
                    </div>
                  ) : null}

                  {plan.db ? (
                    <div>
                      <p className="text-[12px] font-semibold text-zinc-700">Database</p>
                      <div className="mt-1 overflow-x-auto">
                        <table className="w-full text-[12px]">
                          <thead>
                            <tr className="text-left text-zinc-400">
                              <th className="py-1 pr-3 font-medium">Collection</th>
                              <th className="py-1 pr-3 font-medium">Current docs</th>
                              <th className="py-1 font-medium">Checkpoint docs</th>
                            </tr>
                          </thead>
                          <tbody>
                            {plan.db.collections.map((c) => (
                              <tr key={c.name} className="border-t border-zinc-100">
                                <td className="py-1 pr-3 text-zinc-700">{c.name}</td>
                                <td className="py-1 pr-3 tabular-nums">{c.currentDocs}</td>
                                <td className="py-1 tabular-nums">{c.checkpointDocs}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}

                  {plan.assets ? (
                    <div>
                      <p className="text-[12px] font-semibold text-zinc-700">Media</p>
                      <div className="mt-1 flex flex-wrap gap-2 text-[12px]">
                        <span className="chip">total {plan.assets.total}</span>
                        <span className="chip">reuse {plan.assets.reuse}</span>
                        <span className="chip">restore {plan.assets.missing}</span>
                        <span className="chip">replace {plan.assets.replace}</span>
                        <span className="chip">{bytes(plan.assets.bytes)} to restore</span>
                      </div>
                    </div>
                  ) : null}

                  <div className="text-[12px] text-zinc-500 space-y-0.5">
                    <p>Safety snapshot: {plan.snapshot.required ? 'required and will be created and verified before any change' : 'not required for this mode'}.</p>
                    {plan.requiresDbRollback ? <p className="text-amber-700">Database rollback is part of this operation — newer records may be discarded.</p> : null}
                  </div>

                  {plan.warnings.length ? (
                    <ul className="text-[12px] text-amber-700 space-y-0.5 list-disc list-inside">
                      {plan.warnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  ) : null}

                  {plan.missingAssets?.length ? (
                    <div className="rounded-lg bg-amber-50 p-2.5">
                      <p className="text-[12px] font-semibold text-amber-800">Missing assets in current storage (reported after restore)</p>
                      <p className="mt-0.5 text-[12px] text-amber-800 break-words">
                        {plan.missingAssets.slice(0, 6).map((m) => m.pathname).join(', ')}
                        {plan.missingAssets.length > 6 ? ` … +${plan.missingAssets.length - 6} more` : ''}
                      </p>
                    </div>
                  ) : null}

                  <button className="btn btn-danger w-full" disabled={!plan.canProceed} onClick={() => setDialog1(true)}>
                    Continue to confirmation
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {operation ? (
            <div className="card p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-zinc-900">Restore operation</h2>
                <span className={statusChip(operation.status)}>{STATUS_LABELS[operation.status] || operation.status}</span>
                <span className="text-[11px] text-zinc-400 ml-auto">{operation.id}</span>
              </div>
              <div className="h-2 rounded-full bg-zinc-100 overflow-hidden">
                <div className="h-full bg-zinc-900 transition-all" style={{ width: `${Math.max(2, operation.progress || 0)}%` }} />
              </div>
              <p className="text-[12px] text-zinc-500">{operation.phase}</p>

              {operation.lastError ? <p className="text-[13px] text-red-600 break-words">{operation.lastError}</p> : null}
              {operation.warnings?.length ? (
                <ul className="text-[12px] text-amber-700 list-disc list-inside space-y-0.5">
                  {operation.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              ) : null}
              {operation.result?.assets?.failed?.length ? (
                <div className="rounded-lg bg-red-50 p-2.5">
                  <p className="text-[12px] font-semibold text-red-700">Assets that could not be restored</p>
                  <ul className="mt-1 text-[12px] text-red-700 space-y-0.5">
                    {operation.result.assets.failed.map((f, i) => <li key={i} className="break-words">{f.pathname} — {f.error}</li>)}
                  </ul>
                </div>
              ) : null}
              {operation.verification?.refs?.missing?.length ? (
                <div className="rounded-lg bg-amber-50 p-2.5">
                  <p className="text-[12px] font-semibold text-amber-800">Database references with missing assets</p>
                  <ul className="mt-1 text-[12px] text-amber-800 space-y-0.5">
                    {operation.verification.refs.missing.slice(0, 12).map((r, i) => <li key={i} className="break-words">{r.pathname} ({r.refs} ref{r.refs === 1 ? '' : 's'})</li>)}
                  </ul>
                </div>
              ) : null}

              {operation.steps?.length ? (
                <div className="max-h-52 overflow-y-auto rounded-lg bg-zinc-50 p-2.5 space-y-1">
                  {operation.steps.map((s, i) => (
                    <p key={i} className={`text-[11.5px] ${s.level === 'error' ? 'text-red-600' : 'text-zinc-500'}`}>
                      <span className="text-zinc-400">{new Date(s.at).toLocaleTimeString()} </span>
                      {s.message}
                    </p>
                  ))}
                </div>
              ) : null}

              {opActive ? (
                <p className="text-[12px] text-zinc-400 inline-flex items-center gap-1.5">
                  <Loader2 size={13} className="animate-spin" /> Conflicting actions are disabled while the restore runs.
                </p>
              ) : null}

              {canRollback && !opActive ? (
                <button className="btn btn-outline btn-sm" onClick={() => onRollback(operation.id)} disabled={rollbackBusy}>
                  {rollbackBusy ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                  Roll back from the verified snapshot
                </button>
              ) : null}
            </div>
          ) : null}

          {operations.length ? (
            <div className="card p-4">
              <h2 className="text-sm font-semibold text-zinc-900">Recent recovery operations</h2>
              <div className="mt-2 space-y-1.5">
                {operations.map((op) => (
                  <button
                    key={op.id}
                    type="button"
                    className="w-full text-left flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-zinc-50"
                    onClick={async () => {
                      try {
                        const { data } = await api.get(`/recovery/operations/${op.id}`)
                        setOperation(data.operation)
                      } catch (err) {
                        handleApiError(err)
                      }
                    }}
                  >
                    <span className={statusChip(op.status)}>{STATUS_LABELS[op.status] || op.status}</span>
                    <span className="text-[12.5px] text-zinc-800">{op.checkpoint?.name}</span>
                    <span className="text-[11px] text-zinc-400">{op.mode}</span>
                    <span className="text-[11px] text-zinc-400 ml-auto">{formatDateTime(op.createdAt)}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}

      <Modal open={dialog1} title="Confirm restoration" onClose={() => !startBusy && setDialog1(false)} wide>
        {selected ? (
          <div className="space-y-3">
            <div className="rounded-xl bg-amber-50 p-3 text-[13px] text-amber-900">
              You are about to restore BPIN CRM to checkpoint <strong>{selected.name}</strong>
              {selected.completedAt ? <> taken on <strong>{formatDateTime(selected.completedAt)}</strong></> : null} (id {String(selected.id).slice(-10)}).
              Database records may be rolled back to that date and changes made after the checkpoint may no longer be present in the restored database.
              This action is audited. Continue only if you understand the consequences.
            </div>
            <p className="text-[12px] text-zinc-500">Mode: {MODES.find((m) => m.id === mode)?.label}</p>
            <div className="grid grid-cols-2 gap-2">
              <button className="btn btn-outline" onClick={() => setDialog1(false)} disabled={startBusy}>Cancel</button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  setDialog1(false)
                  setStartError('')
                  setDialog2(true)
                }}
                disabled={startBusy}
              >
                I understand, continue
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal open={dialog2} title="Type the confirmation phrase" onClose={() => !startBusy && setDialog2(false)} wide>
        <div className="space-y-3">
          <label className="flex items-start gap-2 text-[13px] text-zinc-700">
            <input type="checkbox" className="mt-0.5" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
            <span>I understand that data created after this checkpoint may be lost from the active database.</span>
          </label>
          <div>
            <label className="label">Type <span className="font-mono">RESTORE BPIN CRM</span> to confirm</label>
            <input className="input font-mono" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="RESTORE BPIN CRM" />
          </div>
          {startError ? <p className="text-[13px] text-red-600">{startError}</p> : null}
          <div className="grid grid-cols-2 gap-2">
            <button className="btn btn-outline" onClick={() => setDialog2(false)} disabled={startBusy}>Cancel</button>
            <button className="btn btn-danger" onClick={onStart} disabled={startBusy || confirmText !== 'RESTORE BPIN CRM' || !acknowledged}>
              {startBusy ? <Loader2 size={15} className="animate-spin" /> : <AlertTriangle size={15} />}
              Restore now
            </button>
          </div>
        </div>
      </Modal>

      {operation && TERMINAL.includes(operation.status) && operation.status === 'completed' ? (
        <p className="text-[12px] text-emerald-700 inline-flex items-center gap-1.5">
          <CheckCircle2 size={14} /> Restoration completed and verified.
        </p>
      ) : null}
    </div>
  )
}
