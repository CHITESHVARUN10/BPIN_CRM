import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'

export default function Page404() {
  const { user } = useAuth()
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center text-center px-5">
      <div className="w-16 h-16 rounded-2xl bg-accent/10 grid place-items-center text-accent">
        <Compass size={26} />
      </div>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Page not found</h1>
      <p className="mt-2 text-[14px] text-zinc-500 max-w-sm">The page you're looking for doesn't exist or may have been moved.</p>
      <Link to={user ? '/' : '/login'} className="btn mt-6 w-full max-w-xs">
        {user ? 'Back to home' : 'Go to sign in'}
      </Link>
    </div>
  )
}
