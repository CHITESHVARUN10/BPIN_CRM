import { useEffect, useRef, useState } from 'react'
import api from '../api/client.js'
import { Search, X } from 'lucide-react'

export default function ProductSelect({ value, onSelect }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const boxRef = useRef(null)
  const timerRef = useRef(null)

  useEffect(() => {
    if (!open) return
    if (query.trim().length < 2) {
      setItems([])
      setLoading(false)
      return undefined
    }
    setLoading(true)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      try {
        const res = await api.get('/products', { params: { q: query.trim(), page: 1 } })
        setItems(res.data.items)
      } catch {
        setItems([])
      } finally {
        setLoading(false)
      }
    }, 250)
    return () => clearTimeout(timerRef.current)
  }, [query, open])

  useEffect(() => {
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const pick = (product) => {
    onSelect(product)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className="relative" ref={boxRef}>
      {value ? (
        <div className="card p-3 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-zinc-900 truncate">{value.description}</p>
            <p className="text-[12px] text-zinc-500 font-mono">{value.sku}</p>
          </div>
          {value.category ? <span className="chip">{value.category}</span> : null}
          <button
            type="button"
            className="btn btn-sm btn-ghost shrink-0"
            onClick={() => {
              onSelect(null)
              setQuery('')
            }}
            aria-label="Clear selection"
          >
            <X size={15} />
            Clear
          </button>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              className="input pl-9"
              placeholder="Search product by model or SKU…"
              value={query}
              onFocus={() => setOpen(true)}
              onChange={(e) => {
                setQuery(e.target.value)
                setOpen(true)
              }}
              autoComplete="off"
            />
          </div>
          {open && (
            <div className="card mt-1.5 absolute z-40 w-full max-h-72 overflow-y-auto divide-y divide-zinc-100">
              {loading && <div className="p-4 text-sm text-zinc-500">Searching…</div>}
              {!loading && query.trim().length < 2 && (
                <div className="p-4 text-sm text-zinc-500">Type at least 2 characters to search the product catalog.</div>
              )}
              {!loading && query.trim().length >= 2 && items.length === 0 && (
                <div className="p-4 text-sm text-zinc-500">No products found.</div>
              )}
              {!loading &&
                items.map((p) => (
                  <button
                    key={p._id}
                    type="button"
                    className="w-full text-left px-3.5 py-2.5 hover:bg-zinc-50 flex items-center gap-3"
                    onClick={() => pick(p)}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-zinc-900 truncate">{p.description}</p>
                      <p className="text-[12px] text-zinc-500 font-mono">{p.sku}</p>
                    </div>
                    {p.category ? <span className="chip shrink-0">{p.category}</span> : null}
                  </button>
                ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
