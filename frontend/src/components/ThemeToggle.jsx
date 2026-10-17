import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'

function applyTheme(theme) {
  const dark = theme === 'dark'
  document.documentElement.classList.toggle('dark', dark)
}

export default function ThemeToggle({ className = '' }) {
  const [theme, setTheme] = useState(() => localStorage.getItem('bpin:theme') || 'light')
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    applyTheme(theme)
    localStorage.setItem('bpin:theme', theme)
    setIsDark(document.documentElement.classList.contains('dark'))
    if (theme !== 'system') return undefined
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      applyTheme('system')
      setIsDark(document.documentElement.classList.contains('dark'))
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))

  return (
    <button type="button" onClick={toggle} className={`p-2.5 rounded-xl text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 transition ${className}`} aria-label="Toggle dark mode">
      {isDark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  )
}
