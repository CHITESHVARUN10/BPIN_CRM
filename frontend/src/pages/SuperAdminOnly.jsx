import { useNavigate } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'

export default function SuperAdminOnly() {
  const navigate = useNavigate()

  return (
    <div
      className="fixed inset-0 z-[90] bg-zinc-950/50 backdrop-blur-[2px] flex items-end md:items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="super-admin-only-title"
    >
      <div className="card p-6 w-full max-w-md bg-white">
        <div className="w-12 h-12 rounded-2xl bg-red-50 border border-red-100 grid place-items-center text-red-600">
          <ShieldAlert size={22} />
        </div>
        <h1 id="super-admin-only-title" className="mt-4 text-lg font-semibold tracking-tight text-zinc-900">
          Access restricted
        </h1>
        <p className="mt-2 text-[13.5px] text-zinc-600">
          Backup Recovery is restricted to the super admin. Your account does not have permission to open this page.
        </p>
        <p className="mt-2 text-[13px] text-zinc-500">
          Please contact your super admin or IT coordinator to request access.
        </p>
        <button type="button" className="btn w-full mt-5" onClick={() => navigate('/', { replace: true })}>
          Back to dashboard
        </button>
      </div>
    </div>
  )
}
