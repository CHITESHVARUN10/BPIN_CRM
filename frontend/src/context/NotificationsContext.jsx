import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import api from '../api/client.js'
import { useAuth } from './AuthContext.jsx'

const NotificationsContext = createContext(null)

export function NotificationsProvider({ children }) {
  const { user } = useAuth()
  const [unread, setUnread] = useState(0)
  const [items, setItems] = useState([])

  const refresh = useCallback(async () => {
    if (!user) return
    try {
      const res = await api.get('/notifications/my')
      setUnread(res.data.unread || 0)
      setItems(res.data.items || [])
    } catch {
      // silent; bell keeps last state
    }
  }, [user])

  useEffect(() => {
    if (!user) {
      setUnread(0)
      setItems([])
      return
    }
    refresh()
    const timer = setInterval(refresh, 60000)
    window.addEventListener('focus', refresh)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [user, refresh])

  const markRead = useCallback(async (id) => {
    await api.patch(`/notifications/${id}/read`)
    setItems((prev) => prev.map((n) => (n._id === id ? { ...n, readAt: new Date().toISOString() } : n)))
    setUnread((u) => Math.max(0, u - 1))
  }, [])

  const value = useMemo(() => ({ unread, items, refresh, markRead }), [unread, items, refresh, markRead])
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext)
  if (!ctx) throw new Error('useNotifications must be used inside NotificationsProvider')
  return ctx
}
