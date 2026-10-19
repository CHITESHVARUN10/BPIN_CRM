import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Loader2, LogIn } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import ThemeToggle from '../components/ThemeToggle.jsx'
import PasswordInput from '../components/PasswordInput.jsx'
import logo from '../assets/logo.png'

export default function Login() {
  const { login, user } = useAuth()
  const navigate = useNavigate()
  const push = useToast().push
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to="/" replace />

  const onSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!email.trim() || !password) {
      setError('Enter your email and password')
      return
    }
    setBusy(true)
    try {
      const user = await login(email, password)
      push(`Welcome, ${user.name.split(' ')[0]}`)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-svh bg-zinc-50 flex flex-col items-center justify-center px-5">
      <div className="w-full max-w-sm">
        <div className="flex justify-end">
          <ThemeToggle />
        </div>
        <div className="flex flex-col items-center pb-7">
          <img src={logo} alt="Blaupunkt" className="h-8" />
          <p className="mt-4 text-[13px] text-zinc-500">Service engineer portal</p>
        </div>
        <form onSubmit={onSubmit} className="card p-5">
          <div>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@blaupunktcar.in"
              autoComplete="email"
              autoCapitalize="none"
            />
          </div>
          <div className="mt-3.5">
            <label className="label" htmlFor="password">
              Password
            </label>
            <PasswordInput
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>
          {error ? <p className="mt-3 text-[13px] text-red-600">{error}</p> : null}
          <button type="submit" className="btn w-full mt-5" disabled={busy}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
            Sign in
          </button>
        </form>
        <p className="mt-6 text-center text-[12px] text-zinc-400">Blaupunkt Car Multimedia · Field Service</p>
      </div>
    </div>
  )
}
