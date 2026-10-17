import { Link } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'

export default function Forbidden() {
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center text-center px-5">
      <div className="w-16 h-16 rounded-2xl bg-red-50 border border-red-100 dark:bg-red-950/40 dark:border-red-900/50 grid place-items-center text-red-600 dark:text-red-400">
        <ShieldAlert size={26} />
      </div>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Access denied</h1>
      <p className="mt-2 text-[14px] text-zinc-500 max-w-sm">
        You don't have permission to view this area. If you believe this is a mistake, ask the admin team to update your role.
      </p>
      <Link to="/" className="btn mt-6 w-full max-w-xs">
        Back to home
      </Link>
    </div>
  )
}
