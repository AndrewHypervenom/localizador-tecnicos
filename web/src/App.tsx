import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { Toaster } from 'sonner'
import { supabase } from '@/lib/supabase'
import { getRoleFromSession } from '@/lib/roles'
import { clearViewAs, getViewAs } from '@/lib/viewAs'
import { useTrackingStore } from '@/store/trackingStore'
import { useZonesStore } from '@/store/zonesStore'
import { useAppUpdate } from '@/hooks/useAppUpdate'
import { Dashboard } from '@/pages/Dashboard'
import { History } from '@/pages/History'
import { Login } from '@/pages/Login'
import { Zones } from '@/pages/Zones'
import { Admin } from '@/pages/Admin'
import { AdminMapPage } from '@/pages/AdminMapPage'
import { LeaderPanel } from '@/pages/LeaderPanel'
import { ChangePassword } from '@/pages/ChangePassword'
import { Reports } from '@/pages/Reports'
import type { Session } from '@supabase/supabase-js'

const Spinner = () => (
  <div className="h-full bg-base flex items-center justify-center">
    {/* Doble anillo contrarrotante: se lee como carga real, no como cuelgue. */}
    <div className="relative w-10 h-10">
      <div className="absolute inset-0 border-2 border-primary/20 rounded-full" />
      <div className="absolute inset-0 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      <div className="absolute inset-2 border-2 border-accent/40 border-b-transparent rounded-full animate-spin-slow" />
    </div>
  </div>
)

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) return <Spinner />
  if (!session) return <Navigate to="/login" replace />
  return <>{children}</>
}

function RoleRedirect({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) return <Spinner />
  if (!session) return <Navigate to="/login" replace />
  const role = getRoleFromSession(session)
  // Con el modo vista activo, la raíz lleva al panel de líder, no al de admin.
  if (role === 'superadmin') return <Navigate to={getViewAs() ? '/leader' : '/admin'} replace />
  if (role === 'leader')     return <Navigate to="/leader" replace />
  return <>{children}</>
}

/**
 * Salida del modo "ver como empresa". Ctrl/Cmd+Shift+V devuelve al listado de
 * empresas del panel de administración. No hace nada si el modo está apagado:
 * se entra desde el icono de ojo, no desde el teclado.
 */
function ViewAsExitHotkey() {
  const navigate = useNavigate()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'V' && e.key !== 'v') return
      if (!e.shiftKey || (!e.ctrlKey && !e.metaKey)) return
      if (!getViewAs()) return
      // Ctrl+Shift+V es "pegar como texto plano": no lo robamos mientras se
      // escribe, o salir del modo sería un accidente a mitad de un formulario.
      const el = document.activeElement
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement)?.isContentEditable) return
      e.preventDefault()
      clearViewAs()
      navigate('/admin?tab=companies', { replace: true })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  return null
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) return <Spinner />
  if (!session) return <Navigate to="/login" replace />
  if (getRoleFromSession(session) !== 'superadmin') return <Navigate to="/" replace />
  return <>{children}</>
}

function LeaderRoute({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) return <Spinner />
  if (!session) return <Navigate to="/login" replace />
  const role = getRoleFromSession(session)
  if (role !== 'leader' && role !== 'superadmin') return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  // Auto-actualiza el sitio cuando hay un despliegue nuevo (sin recargar a mano).
  useAppUpdate()

  useEffect(() => {
    // Limpiar sesión inválida automáticamente (token expirado o revocado)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' && !session) {
        // Si no, el siguiente que entre en esta pestaña heredaría el modo vista.
        clearViewAs()
        // Limpiar el estado en memoria para que el siguiente líder no vea
        // técnicos/zonas/alertas del anterior (el store es un singleton).
        useTrackingStore.getState().reset()
        useZonesStore.getState().setZones([])
        // Limpiar cualquier token residual del localStorage
        Object.keys(localStorage).forEach(k => {
          if (k.startsWith('sb-')) localStorage.removeItem(k)
        })
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  return (
    <BrowserRouter>
      <ViewAsExitHotkey />
      <Toaster
        theme="dark"
        position="top-right"
        richColors
        toastOptions={{
          style: {
            background: '#141420',
            border: '1px solid #252540',
            color: '#F1F5F9',
          },
        }}
      />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/change-password" element={<ChangePassword />} />
        <Route path="/admin" element={
          <AdminRoute><Admin /></AdminRoute>
        } />
        <Route path="/admin/map" element={
          <AdminRoute><AdminMapPage /></AdminRoute>
        } />
        <Route path="/leader" element={
          <LeaderRoute><LeaderPanel /></LeaderRoute>
        } />
        <Route path="/" element={
          <RoleRedirect><Dashboard /></RoleRedirect>
        } />
        <Route path="/map" element={
          <ProtectedRoute><Dashboard /></ProtectedRoute>
        } />
        <Route path="/history" element={
          <ProtectedRoute><History /></ProtectedRoute>
        } />
        <Route path="/zones" element={
          <ProtectedRoute><Zones /></ProtectedRoute>
        } />
        <Route path="/reports" element={
          <ProtectedRoute><Reports /></ProtectedRoute>
        } />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
