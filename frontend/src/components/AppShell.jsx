import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Bell, CalendarDays, ClipboardList, FilePlus2, History, House, LayoutDashboard, MapPin, Package, ShieldCheck, SquareActivity, UserRound, LogOut, Wrench } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { useNotifications } from '../context/NotificationsContext.jsx'
import ThemeToggle from './ThemeToggle.jsx'
import logo from '../assets/logo.png'

function initials(name = '') {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')
}

const TECH_NAV = [
  { to: '/', label: 'Home', icon: House },
  { to: '/new', label: 'New Report', icon: FilePlus2 },
  { to: '/records', label: 'Records', icon: ClipboardList },
  { to: '/assignments', label: 'Visits', icon: MapPin },
  { to: '/profile', label: 'Profile', icon: UserRound },
]

const ADMIN_NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/reports', label: 'Reports', icon: ClipboardList },
  { to: '/admin/records', label: 'Records', icon: CalendarDays },
  { to: '/admin/assignments', label: 'Assignments', icon: MapPin },
  { to: '/admin/activity', label: 'Activity', icon: SquareActivity },
  { to: '/admin/products', label: 'Products', icon: Package },
  { to: '/admin/users', label: 'Users', icon: UserRound },
  { to: '/admin/problems', label: 'Problems', icon: Wrench },
  { to: '/admin/logs', label: 'Logs', icon: History },
]

export default function AppShell() {
  const { user, logout } = useAuth()
  const { unread } = useNotifications()
  const navigate = useNavigate()
  const isAdmin = user?.role === 'admin'
  const adminNav = user?.superAdmin ? [...ADMIN_NAV, { to: '/admin/recovery', label: 'Recovery', icon: ShieldCheck }] : ADMIN_NAV
  const nav = isAdmin ? adminNav : TECH_NAV

  const onLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-svh bg-zinc-50">
      <aside className="hidden md:flex fixed top-0 left-0 bottom-0 w-60 bg-white border-r border-zinc-200 flex-col p-4 z-30">
        <img src={logo} alt="Blaupunkt" className="h-6 self-start" />
        <nav className="mt-8 flex flex-col gap-1 flex-1">
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `navlink ${isActive ? 'navlink-active' : ''}`}>
              <item.icon size={18} strokeWidth={2} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="divider my-3" />
        <div className="flex items-center gap-2.5 px-1 py-1">
          <div className="w-9 h-9 rounded-full bg-zinc-900 text-white grid place-items-center text-xs font-semibold">{initials(user?.name)}</div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-900 truncate">{user?.name}</p>
            <p className="text-[11px] text-zinc-500 capitalize">{user?.role}</p>
          </div>
          <ThemeToggle className="ml-auto" />
          <button onClick={onLogout} className="p-2 rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900" aria-label="Log out">
            <LogOut size={17} />
          </button>
        </div>
      </aside>

      <div className="md:pl-60">
        <header className="sticky top-0 z-30 bg-white/85 backdrop-blur border-b border-zinc-200 md:hidden">
          <div className="h-14 flex items-center gap-3 px-4">
            <img src={logo} alt="Blaupunkt" className="h-5" />
            <div className="ml-auto flex items-center gap-1">
              <ThemeToggle />
              <NavLink to="/notifications" className="relative p-2.5 rounded-xl text-zinc-700 hover:bg-zinc-100" aria-label="Notifications">
                <Bell size={20} />
                {unread > 0 && <span className="absolute top-1.5 right-1.5 min-w-4 h-4 px-1 rounded-full bg-accent text-white text-[10px] font-semibold grid place-items-center">{unread > 9 ? '9+' : unread}</span>}
              </NavLink>
              <button onClick={onLogout} className="p-2.5 rounded-xl text-zinc-700 hover:bg-zinc-100" aria-label="Log out">
                <LogOut size={20} />
              </button>
            </div>
          </div>
        </header>

        <div className="hidden md:flex justify-end items-center gap-0 px-4 pt-4">
          <div className="card flex items-center gap-2 px-3 py-1.5">
            <NavLink to="/notifications" className="relative p-1 rounded-lg text-zinc-700 hover:bg-zinc-100" aria-label="Notifications">
              <Bell size={17} />
              {unread > 0 && <span className="absolute -top-1 -right-1 min-w-3.5 h-3.5 px-0.5 rounded-full bg-zinc-900 text-white text-[9px] font-semibold grid place-items-center">{unread > 9 ? '9+' : unread}</span>}
            </NavLink>
            <span className="chip capitalize">{user?.role}</span>
          </div>
        </div>

        <main className="mx-auto w-full max-w-5xl px-4 pt-5 pb-24 md:pb-12">
          <Outlet />
        </main>
      </div>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur border-t border-zinc-200" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="grid grid-cols-5">
          {TECH_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium min-h-[54px] ${isActive ? 'text-accent' : 'text-zinc-400'}`}
            >
              {({ isActive }) => (
                <span className={item.to === '/new' ? (isActive ? 'text-white bg-zinc-900 p-1 rounded-xl' : 'text-zinc-900 bg-zinc-100 p-1 rounded-xl') : ''}>
                  <item.icon size={20} />
                </span>
              )}
              <span>{item.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
