import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, History } from 'lucide-react'
import api from '../api/client.js'
import { EmptyState, SkeletonRows, formatDateTime } from '../components/ui.jsx'

const ACTION_LABELS = {
  user_created: 'User created',
  user_updated: 'User updated',
  case_created: 'Assessment filed',
  case_edited: 'Case edited',
  case_closed: 'Case closed',
  case_reopened: 'Case reopened',
  product_created: 'Product created',
  product_updated: 'Product updated',
  assignment_created: 'Assignment handed out',
  assignment_updated: 'Assignment updated',
  problem_created: 'Problem added',
  problem_updated: 'Problem updated',
  backup_started: 'Backup started',
  backup_completed: 'Backup completed',
  backup_failed: 'Backup failed',
  backup_retry: 'Backup automatic retry',
  backup_retry_manual: 'Backup manual retry',
  backup_rotated: 'Backup generation rotated',
  backup_attempt_skipped: 'Backup attempt skipped',
  backup_attempt_failed: 'Backup attempt failed',
  backup_worker_failed: 'Backup worker error',
  recovery_reauth_success: 'Recovery: re-authenticated',
  recovery_reauth_failed: 'Recovery: failed re-auth',
  recovery_reauth_rate_limited: 'Recovery: rate limited',
  recovery_access_denied: 'Recovery: access denied',
  recovery_inventory_listed: 'Recovery: inventory viewed',
  recovery_dry_run: 'Recovery: dry-run',
  recovery_restore_requested: 'Recovery: restore requested',
  recovery_snapshot_created: 'Recovery: snapshot created',
  recovery_database_restored: 'Recovery: database restored',
  recovery_assets_restored: 'Recovery: media restored',
  recovery_references_repaired: 'Recovery: references repaired',
  recovery_restore_completed: 'Recovery: completed',
  recovery_restore_partial_failure: 'Recovery: partial failure',
  recovery_restore_failed: 'Recovery: failed',
  recovery_rollback_started: 'Recovery: rollback started',
  recovery_rollback_completed: 'Recovery: rolled back',
  recovery_rollback_failed: 'Recovery: rollback failed',
  recovery_rollback_manual_requested: 'Recovery: manual rollback',
  recovery_recovery_locked: 'Recovery: locked',
  recovery_backup_activity_viewed: 'Recovery: backup activity viewed',
}

const ROLE_COLORS = {
  admin: 'chip chip-strong',
  technician: 'chip chip-open',
}

export default function AdminLogs() {
  const [items, setItems] = useState(null)
  const [action, setAction] = useState('')
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (pageNum = 1) => {
    setLoading(true)
    try {
      const res = await api.get('/logs', { params: { page: pageNum, action: action || undefined } })
      setItems(res.data.items)
      setPages(res.data.pages)
      setPage(res.data.page)
      setTotal(res.data.total)
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [action])

  useEffect(() => {
    load(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Logs</h1>
          <p className="text-[13px] text-zinc-500 mt-0.5">Every important action by admins and engineers</p>
        </div>
        <div>
          <p className="text-[11px] font-medium text-zinc-500 mb-1">Action filter</p>
          <select className="input !min-h-[40px] !w-auto text-[13px]" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">All actions</option>
            {Object.entries(ACTION_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <SkeletonRows rows={8} className="h-11" />
      ) : items.length === 0 ? (
        <EmptyState icon={History} title="No log entries" hint={action ? 'No actions of this type yet.' : 'Actions will appear here as the team works.'} />
      ) : (
        <div className="space-y-2">
          {items.map((log) => (
            <div key={String(log._id)} className="card p-3.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`capitalize ${ROLE_COLORS[log.actorRole] || 'chip'}`}>{log.actorRole || 'system'}</span>
                <p className="text-sm font-semibold text-zinc-900">{log.actorName || 'System'}</p>
                <span className="chip">{ACTION_LABELS[log.action] || log.action}</span>
                <span className="text-[11px] text-zinc-400 ml-auto">{formatDateTime(log.createdAt)}</span>
              </div>
              {log.targetLabel ? <p className="mt-1 text-[13px] text-zinc-800">{log.targetLabel}</p> : null}
              {log.detail ? <p className="mt-1 text-[12px] text-zinc-500 break-words">{log.detail}</p> : null}
            </div>
          ))}
        </div>
      )}

      {!loading && pages > 1 ? (
        <div className="flex items-center justify-center gap-2">
          <button className="btn btn-sm btn-outline" disabled={page <= 1} onClick={() => load(page - 1)}>
            <ChevronLeft size={15} />
            Prev
          </button>
          <span className="text-[13px] text-zinc-500 tabular-nums">{page} / {pages}</span>
          <button className="btn btn-sm btn-outline" disabled={page >= pages} onClick={() => load(page + 1)}>
            Next
            <ChevronRight size={15} />
          </button>
        </div>
      ) : null}
    </div>
  )
}
