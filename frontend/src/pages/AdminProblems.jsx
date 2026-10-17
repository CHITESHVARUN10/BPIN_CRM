import { useCallback, useEffect, useState } from 'react'
import { Archive, ArchiveRestore, Plus } from 'lucide-react'
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
        <div className="space-y-2">
          {items.map((p) => (
            <div key={String(p._id)} className={`card p-3.5 flex items-center gap-3 ${p.archived ? 'opacity-55' : ''}`}>
              <div className="min-w-0 flex-1">
                {editing === String(p._id) ? (
                  <input className="input !min-h-[38px]" value={editVal} onChange={(e) => setEditVal(e.target.value)} autoFocus onKeyDown={(e) => { if (e.key === 'Enter') saveEdit() }} />
                ) : (
                  <p className="text-sm font-medium text-zinc-900 truncate">{p.name}</p>
                )}
              </div>
              {p.archived ? <span className="chip">Archived</span> : null}
              {editing === String(p._id) ? (
                <>
                  <button type="button" className="btn btn-sm" disabled={busyId === editing || !editVal.trim()} onClick={saveEdit}>Save</button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setEditing(null); setEditVal('') }}>Cancel</button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost !text-[12.5px]"
                  disabled={busyId === String(p._id)}
                  onClick={() => { setEditing(String(p._id)); setEditVal(p.name) }}
                >
                  Rename
                </button>
              )}
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                disabled={busyId === String(p._id)}
                onClick={() => (p.archived ? toggleArchive(p) : setArchiveFor(p))}
                aria-label={p.archived ? 'Restore' : 'Archive'}
              >
                {p.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
              </button>
            </div>
          ))}
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
