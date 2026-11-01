import { useCallback, useEffect, useState } from 'react'
import { Archive, ArchiveRestore, Pencil, Plus } from 'lucide-react'
import api from '../api/client.js'
import { EmptyState, SkeletonRows, ConfirmDialog } from '../components/ui.jsx'
import { useToast } from '../context/ToastContext.jsx'

export default function AdminProblems() {
  const push = useToast().push
  const [items, setItems] = useState(null)
  const [name, setName] = useState('')
  const [editing, setEditing] = useState(null)
  const [editVal, setEditVal] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [archiveFor, setArchiveFor] = useState(null)

  const load = useCallback(() => {
    api
      .get('/problems', { params: { all: 'true' } })
      .then((res) => setItems(res.data.items))
      .catch(() => setItems([]))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const add = async (e) => {
    e.preventDefault()
    const clean = name.trim()
    if (!clean) return
    try {
      await api.post('/problems', { name: clean })
      setName('')
      push('Problem added')
      load()
    } catch (err) {
      push(err.response?.data?.message || 'Could not add', 'error')
    }
  }

  const saveEdit = async () => {
    if (!editing) return
    setBusyId(editing)
    try {
      await api.patch(`/problems/${editing}`, { name: editVal.trim() })
      setEditing(null)
      setEditVal('')
      push('Problem renamed')
      load()
    } catch (err) {
      push(err.response?.data?.message || 'Could not rename', 'error')
    } finally {
      setBusyId(null)
    }
  }

  const toggleArchive = async (item) => {
    setBusyId(String(item._id))
    try {
      await api.patch(`/problems/${item._id}`, { archived: !item.archived })
      push(item.archived ? 'Problem restored' : 'Problem archived')
      load()
    } catch (err) {
      push(err.response?.data?.message || 'Update failed', 'error')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Problems</h1>
        <p className="text-[13px] text-zinc-500 mt-0.5">The list engineers can pick from. Archived problems stay on old records.</p>
      </div>

      <form onSubmit={add} className="card p-3 flex gap-2 items-center">
        <input className="input !min-h-[40px] flex-1" placeholder="New problem, e.g. Battery Drain Issue" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="btn btn-sm shrink-0">
          <Plus size={14} />
          Add
        </button>
      </form>

      {items === null ? (
        <SkeletonRows rows={8} className="h-11" />
      ) : items.length === 0 ? (
        <EmptyState title="No problems yet" hint="Add the common issues engineers should pick from." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="data-table min-w-[640px]">
            <thead>
              <tr>
                <th>Problem</th>
                <th className="w-[140px]">Status</th>
                <th className="w-[280px] text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => {
                const isEditing = editing === String(p._id)
                const busy = busyId === String(p._id)
                return (
                  <tr key={String(p._id)} className={p.archived ? 'opacity-60' : ''}>
                    <td>
                      {isEditing ? (
                        <input
                          className="input !min-h-[36px]"
                          value={editVal}
                          onChange={(e) => setEditVal(e.target.value)}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              saveEdit()
                            }
                          }}
                        />
                      ) : (
                        <p className="font-medium text-zinc-900 dark:text-zinc-100">{p.name}</p>
                      )}
                    </td>
                    <td>
                      {p.archived ? (
                        <span className="chip">Archived</span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-emerald-600 dark:text-emerald-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          Active
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                        {isEditing ? (
                          <>
                            <button type="button" className="btn btn-sm" disabled={busy || !editVal.trim()} onClick={saveEdit}>
                              Save
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-ghost"
                              onClick={() => {
                                setEditing(null)
                                setEditVal('')
                              }}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-sm btn-outline"
                            disabled={busy}
                            onClick={() => {
                              setEditing(String(p._id))
                              setEditVal(p.name)
                            }}
                          >
                            <Pencil size={13} />
                            Rename
                          </button>
                        )}
                        <button
                          type="button"
                          className={`btn btn-sm ${p.archived ? 'btn-outline' : 'btn-ghost'}`}
                          disabled={busy}
                          onClick={() => (p.archived ? toggleArchive(p) : setArchiveFor(p))}
                        >
                          {p.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                          {p.archived ? 'Restore' : 'Archive'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(archiveFor)}
        title={`Archive "${archiveFor?.name}"?`}
        message="Engineers won't see it when filing new assessments. Old records keep it, and you can restore it any time."
        confirmLabel="Archive"
        busy={busyId !== null}
        onClose={() => setArchiveFor(null)}
        onConfirm={() => {
          const target = archiveFor
          setArchiveFor(null)
          toggleArchive(target)
        }}
      />
    </div>
  )
}
