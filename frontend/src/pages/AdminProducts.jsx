import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Package, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import api from '../api/client.js'
import { ConfirmDialog, EmptyState, SkeletonRows } from '../components/ui.jsx'
import { useToast } from '../context/ToastContext.jsx'

const CATEGORIES = ['BP Car Multimedia', 'BP Car Accessories', 'Sound Product', 'ROCKFORD FOSGATE', 'Others']

function ProductModal({ open, initial, onClose, onSaved }) {
  const push = useToast().push
  const [form, setForm] = useState({ sku: '', description: '', category: CATEGORIES[0] })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setForm(initial ? { sku: initial.sku, description: initial.description, category: initial.category || CATEGORIES[0] } : { sku: '', description: '', category: CATEGORIES[0] })
    setErr('')
  }, [initial, open])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    const clean = { sku: form.sku.trim(), description: form.description.trim(), category: form.category }
    if (!clean.sku || !clean.description) {
      setErr('SKU and description are required')
      return
    }
    setBusy(true)
    try {
      if (initial) {
        await api.patch(`/products/${initial._id}`, clean)
        push('Product updated')
      } else {
        await api.post('/products', clean)
        push('Product created')
      }
      onSaved()
      onClose()
    } catch (error) {
      setErr(error.response?.data?.message || 'Could not save product')
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[75] bg-zinc-950/40 flex items-end md:items-center justify-center p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div className="card p-5 w-full max-w-md bg-white" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-zinc-900">{initial ? 'Edit product' : 'Add product'}</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-zinc-400 hover:bg-zinc-100" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="label">SKU code<span className="text-red-600 ml-0.5">*</span></label>
            <input className="input font-mono" value={form.sku} onChange={(e) => set('sku', e.target.value)} placeholder="e.g. 1012230988E-106" />
          </div>
          <div>
            <label className="label">Description<span className="text-red-600 ml-0.5">*</span></label>
            <textarea className="input min-h-[64px] resize-none" value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Model name the engineers will see" />
          </div>
          <div>
            <label className="label">Category</label>
            <select className="input" value={form.category} onChange={(e) => set('category', e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
              {!CATEGORIES.includes(form.category) ? <option value={form.category}>{form.category}</option> : null}
            </select>
          </div>
          {err ? <p className="text-[13px] text-red-600">{err}</p> : null}
          <button type="submit" className="btn w-full" disabled={busy}>
            {busy ? 'Saving…' : initial ? 'Save changes' : 'Create product'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default function AdminProducts() {
  const push = useToast().push
  const [items, setItems] = useState(null)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [modal, setModal] = useState(null) // null | {} | product
  const [deleteFor, setDeleteFor] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async (pageNum = 1) => {
    try {
      const res = await api.get('/products', { params: { page: pageNum, limit: 50, q: q.trim() || undefined, category: category || undefined } })
      setItems(res.data.items)
      setPages(res.data.pages)
      setPage(res.data.page)
      setTotal(res.data.total)
    } catch {
      setItems([])
    }
  }, [q, category])

  const remove = async () => {
    if (!deleteFor) return
    setDeleting(true)
    try {
      await api.delete(`/products/${deleteFor._id}`)
      push('Product deleted')
      const nextPage = items.length === 1 && page > 1 ? page - 1 : page
      setDeleteFor(null)
      await load(nextPage)
    } catch (error) {
      push(error.response?.data?.message || 'Could not delete product', 'error')
    } finally {
      setDeleting(false)
    }
  }

  useEffect(() => {
    const t = setTimeout(() => load(1), q ? 350 : 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, category])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Products</h1>
          <p className="text-[13px] text-zinc-500 mt-0.5">{total} in catalog · shown to engineers in the assessment form</p>
        </div>
        <button type="button" className="btn btn-sm" onClick={() => setModal({})}>
          <Plus size={14} />
          Add product
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-56">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input className="input !min-h-[40px] pl-9 text-[13px]" placeholder="Search SKU or description…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input !min-h-[40px] !w-auto text-[13px]" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {items === null ? (
        <SkeletonRows rows={8} className="h-11" />
      ) : items.length === 0 ? (
        <EmptyState icon={Package} title="No products found" hint="Try another search, or add the product manually." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="data-table min-w-[760px]">
            <thead>
              <tr>
                <th className="w-[210px]">Part number</th>
                <th>Name</th>
                <th className="w-[190px]">Category</th>
                <th className="w-[190px] text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p._id}>
                  <td>
                    <span className="font-mono text-[12px] text-zinc-600 dark:text-zinc-300">{p.sku}</span>
                  </td>
                  <td>
                    <p className="font-medium text-zinc-900 dark:text-zinc-100">{p.description}</p>
                  </td>
                  <td>
                    <span className="chip">{p.category}</span>
                  </td>
                  <td>
                    <div className="flex items-center justify-end gap-1.5">
                      <button type="button" className="btn btn-sm btn-outline" onClick={() => setModal(p)}>
                        <Pencil size={13} />
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost !text-red-600"
                        onClick={() => setDeleteFor(p)}
                      >
                        <Trash2 size={14} />
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 ? (
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

      <ConfirmDialog
        open={Boolean(deleteFor)}
        title={deleteFor ? `Delete "${deleteFor.description}"?` : 'Delete product?'}
        message={
          deleteFor
            ? `${deleteFor.sku} will be removed from the catalog. This cannot be undone. Products already used by service records cannot be deleted.`
            : ''
        }
        confirmLabel="Delete product"
        danger
        busy={deleting}
        onClose={() => {
          if (!deleting) setDeleteFor(null)
        }}
        onConfirm={remove}
      />

      <ProductModal open={modal !== null} initial={modal && modal._id ? modal : null} onClose={() => setModal(null)} onSaved={() => load(page)} />
    </div>
  )
}
