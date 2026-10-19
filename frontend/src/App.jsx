import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/AuthContext.jsx'
import AppShell from './components/AppShell.jsx'
import logo from './assets/logo.png'
import Forbidden from './pages/Forbidden.jsx'
import Page404 from './pages/Page404.jsx'

const Login = lazy(() => import('./pages/Login.jsx'))
const TechHome = lazy(() => import('./pages/TechHome.jsx'))
const NewReport = lazy(() => import('./pages/NewReport.jsx'))
const MyRecords = lazy(() => import('./pages/MyRecords.jsx'))
const ReportDetail = lazy(() => import('./pages/ReportDetail.jsx'))
const Notifications = lazy(() => import('./pages/Notifications.jsx'))
const Profile = lazy(() => import('./pages/Profile.jsx'))
const AdminDashboard = lazy(() => import('./pages/AdminDashboard.jsx'))
const AdminReports = lazy(() => import('./pages/AdminReports.jsx'))
const AdminActivity = lazy(() => import('./pages/AdminActivity.jsx'))
const AdminUsers = lazy(() => import('./pages/AdminUsers.jsx'))
const AdminProblems = lazy(() => import('./pages/AdminProblems.jsx'))
const AdminRecords = lazy(() => import('./pages/AdminRecords.jsx'))
const FollowUp = lazy(() => import('./pages/FollowUp.jsx'))
const CloseCase = lazy(() => import('./pages/CloseCase.jsx'))
const Assignments = lazy(() => import('./pages/Assignments.jsx'))
const AdminAssignments = lazy(() => import('./pages/AdminAssignments.jsx'))
const AdminProducts = lazy(() => import('./pages/AdminProducts.jsx'))
const AdminLogs = lazy(() => import('./pages/AdminLogs.jsx'))
const AdminEditCase = lazy(() => import('./pages/AdminEditCase.jsx'))
const AdminRecovery = lazy(() => import('./pages/AdminRecovery.jsx'))

function Splash() {
  return (
    <div className="min-h-svh grid place-items-center bg-zinc-50">
      <img src={logo} alt="Blaupunkt" className="h-7 animate-pulse" />
    </div>
  )
}

function RequireAuth({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <Splash />
  if (!user) return <Navigate to="/login" replace />
  return children
}

function RequireTech({ children }) {
  const { user } = useAuth()
  if (user && user.role !== 'technician') return <Forbidden />
  return children
}

function RequireAdmin({ children }) {
  const { user } = useAuth()
  if (user && user.role !== 'admin') return <Forbidden />
  return children
}

function RequireSuperAdmin({ children }) {
  const { user } = useAuth()
  if (user && (user.role !== 'admin' || user.superAdmin !== true)) return <Forbidden />
  return children
}

function Home() {
  const { user } = useAuth()
  return user?.role === 'admin' ? <AdminDashboard /> : <TechHome />
}

function NotFound() {
  const { user, loading } = useAuth()
  if (loading) return <Splash />
  if (!user) return <Navigate to="/login" replace />
  return <Page404 />
}

export default function App() {
  return (
    <Suspense fallback={<Splash />}>
      <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Home />} />
        <Route
          path="/new"
          element={
            <RequireTech>
              <NewReport />
            </RequireTech>
          }
        />
        <Route path="/records" element={<MyRecords />} />
        <Route path="/records/:id" element={<ReportDetail />} />
        <Route
          path="/records/:id/follow-up"
          element={
            <RequireTech>
              <FollowUp />
            </RequireTech>
          }
        />
        <Route path="/records/:id/close" element={<CloseCase />} />
        <Route
          path="/records/:id/edit"
          element={
            <RequireAdmin>
              <AdminEditCase />
            </RequireAdmin>
          }
        />
        <Route
          path="/assignments"
          element={
            <RequireTech>
              <Assignments />
            </RequireTech>
          }
        />
        <Route
          path="/admin/assignments"
          element={
            <RequireAdmin>
              <AdminAssignments />
            </RequireAdmin>
          }
        />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/profile" element={<Profile />} />
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <AdminDashboard />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/reports"
          element={
            <RequireAdmin>
              <AdminReports />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/records"
          element={
            <RequireAdmin>
              <AdminRecords />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/reports/:id"
          element={
            <RequireAdmin>
              <ReportDetail />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/activity"
          element={
            <RequireAdmin>
              <AdminActivity />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/users"
          element={
            <RequireAdmin>
              <AdminUsers />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/problems"
          element={
            <RequireAdmin>
              <AdminProblems />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/products"
          element={
            <RequireAdmin>
              <AdminProducts />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/logs"
          element={
            <RequireAdmin>
              <AdminLogs />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/recovery"
          element={
            <RequireSuperAdmin>
              <AdminRecovery />
            </RequireSuperAdmin>
          }
        />
      </Route>
      <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  )
}
