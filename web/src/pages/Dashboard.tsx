import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { TrackingMap } from '@/components/map/TrackingMap'
import { TechnicianList } from '@/components/panels/TechnicianList'
import { TechnicianDetail } from '@/components/panels/TechnicianDetail'
import { AlertsPanel } from '@/components/panels/AlertsPanel'
import { useRealtimeTechnicians } from '@/hooks/useRealtimeTechnicians'
import { useZones } from '@/hooks/useZones'
import { useZoneEvents } from '@/hooks/useZoneEvents'
import { useTrackingStore } from '@/store/trackingStore'
import { useZonesStore } from '@/store/zonesStore'
import { cn } from '@/lib/utils'
import {
  Users, Bell, ChevronLeft, ChevronRight,
  LogOut, History, Layers, EyeOff, Eye
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Link } from 'react-router-dom'

type ActiveTab = 'technicians' | 'alerts'

// ── Indicador de estado Realtime ──────────────────────────────────
type RealtimeStatus = 'connecting' | 'connected' | 'error' | 'disconnected'

function RealtimeIndicator({ status, lastEvent }: { status: RealtimeStatus; lastEvent: string | null }) {
  const [secsSince, setSecsSince] = useState<number | null>(null)

  useEffect(() => {
    if (!lastEvent) { setSecsSince(null); return }
    const update = () => setSecsSince(Math.floor((Date.now() - new Date(lastEvent).getTime()) / 1000))
    update()
    const t = setInterval(update, 5000)
    return () => clearInterval(t)
  }, [lastEvent])

  const cfg = {
    connecting:   { dot: 'bg-warning animate-pulse', label: 'Conectando…',    text: 'text-warning' },
    connected:    { dot: 'bg-success animate-pulse',  label: 'En vivo',        text: 'text-success' },
    error:        { dot: 'bg-danger',                 label: 'Sin conexión',   text: 'text-danger'  },
    disconnected: { dot: 'bg-text-muted',             label: 'Desconectado',   text: 'text-text-muted' },
  }[status]

  const lastEventLabel = secsSince === null
    ? 'sin eventos'
    : secsSince < 60
      ? `hace ${secsSince}s`
      : `hace ${Math.floor(secsSince / 60)}m`

  return (
    <div className="absolute bottom-4 right-4 z-[500] bg-surface/90 backdrop-blur-sm border border-border-soft rounded-xl px-3 py-1.5 flex items-center gap-2 text-xs shadow-xl">
      <div className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', cfg.dot)} />
      <span className={cn('font-medium', cfg.text)}>{cfg.label}</span>
      {status === 'connected' && (
        <span className="text-text-muted">· último evento {lastEventLabel}</span>
      )}
      {status === 'error' && (
        <span className="text-text-muted">· revisa consola</span>
      )}
    </div>
  )
}

export function Dashboard() {
  useRealtimeTechnicians()
  useZones()
  useZoneEvents()

  const { selectedTechnicianId, alerts, zoneAlerts, realtimeStatus, lastRealtimeEvent } = useTrackingStore()
  const { zones, showZones, toggleShowZones } = useZonesStore()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [activeTab, setActiveTab] = useState<ActiveTab>('technicians')
  const unreadAlerts =
    alerts.filter((a) => !a.acknowledged).length +
    zoneAlerts.filter((a) => !a.acknowledged).length

  const handleLogout = async () => {
    await supabase.auth.signOut()
  }

  return (
    <div className="flex h-screen bg-base overflow-hidden">
      {/* Sidebar izquierdo */}
      <motion.div
        animate={{ width: sidebarCollapsed ? 0 : 320 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="relative flex-shrink-0 bg-surface border-r border-border-soft overflow-hidden"
      >
        {/* Tabs del sidebar */}
        <div className="flex border-b border-border-soft">
          <button
            onClick={() => setActiveTab('technicians')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-medium transition-colors',
              activeTab === 'technicians'
                ? 'text-primary border-b-2 border-primary'
                : 'text-text-muted hover:text-text-primary'
            )}
          >
            <Users className="w-3.5 h-3.5" />
            Técnicos
          </button>
          <button
            onClick={() => setActiveTab('alerts')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-medium transition-colors relative',
              activeTab === 'alerts'
                ? 'text-primary border-b-2 border-primary'
                : 'text-text-muted hover:text-text-primary'
            )}
          >
            <Bell className="w-3.5 h-3.5" />
            Alertas
            {unreadAlerts > 0 && (
              <span className="absolute top-2 right-6 bg-danger text-white text-xs font-bold w-4 h-4 rounded-full flex items-center justify-center animate-pulse">
                {unreadAlerts > 9 ? '9+' : unreadAlerts}
              </span>
            )}
          </button>
        </div>

        {/* Contenido del panel */}
        <div className="h-[calc(100%-48px)] overflow-hidden">
          <AnimatePresence mode="wait">
            {activeTab === 'alerts' ? (
              <motion.div
                key="alerts"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="h-full overflow-y-auto"
              >
                <AlertsPanel className="h-full" />
              </motion.div>
            ) : selectedTechnicianId ? (
              <motion.div
                key="detail"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="h-full overflow-y-auto"
              >
                <TechnicianDetail />
              </motion.div>
            ) : (
              <motion.div
                key="list"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="h-full overflow-y-auto"
              >
                <TechnicianList className="h-full" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* Botón colapsar sidebar */}
      <button
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        className="absolute left-0 top-1/2 -translate-y-1/2 z-[500] bg-surface border border-border-soft rounded-r-lg p-1 hover:bg-surface-raised transition-colors"
        style={{ left: sidebarCollapsed ? 0 : 320 }}
      >
        {sidebarCollapsed
          ? <ChevronRight className="w-3.5 h-3.5 text-text-muted" />
          : <ChevronLeft  className="w-3.5 h-3.5 text-text-muted" />
        }
      </button>

      {/* Mapa principal (ocupa el resto) */}
      <div className="flex-1 relative">
        <TrackingMap className="h-full w-full" />

        {/* Barra superior flotante */}
        <div className="absolute top-4 left-4 right-4 z-[500] flex items-center justify-between pointer-events-none">
          <div className="bg-surface/90 backdrop-blur-sm border border-border-soft rounded-xl px-4 py-2 flex items-center gap-2 pointer-events-auto shadow-xl">
            <div className="w-7 h-7 rounded-lg overflow-hidden flex-shrink-0">
              <img src="/favicon.png" alt="PositivoS+" className="w-full h-full object-cover" />
            </div>
            <span className="font-bold text-text-primary text-sm">Localizador</span>
            <span className="text-xs text-primary font-semibold">PositivoS+</span>
          </div>

          <div className="flex items-center gap-2 pointer-events-auto">
            <button
              onClick={toggleShowZones}
              title={showZones ? 'Ocultar zonas' : 'Mostrar zonas'}
              className={cn(
                'bg-surface/90 backdrop-blur-sm border border-border-soft rounded-xl px-3 py-2 flex items-center gap-1.5 hover:bg-surface transition-colors shadow-xl text-xs',
                showZones ? 'text-primary' : 'text-text-muted'
              )}
            >
              {showZones ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              Zonas {zones.length > 0 && <span className="font-mono font-bold">{zones.length}</span>}
            </button>
            <Link
              to="/zones"
              className="bg-surface/90 backdrop-blur-sm border border-border-soft rounded-xl px-3 py-2 flex items-center gap-1.5 hover:bg-surface transition-colors shadow-xl text-xs text-text-secondary hover:text-text-primary"
            >
              <Layers className="w-3.5 h-3.5" />
              Zonas
            </Link>
            <Link
              to="/history"
              className="bg-surface/90 backdrop-blur-sm border border-border-soft rounded-xl px-3 py-2 flex items-center gap-1.5 hover:bg-surface transition-colors shadow-xl text-xs text-text-secondary hover:text-text-primary"
            >
              <History className="w-3.5 h-3.5" />
              Historial
            </Link>
            <button
              onClick={handleLogout}
              className="bg-surface/90 backdrop-blur-sm border border-border-soft rounded-xl p-2 hover:bg-surface transition-colors shadow-xl"
            >
              <LogOut className="w-3.5 h-3.5 text-text-muted hover:text-text-primary" />
            </button>
          </div>
        </div>

        {/* Indicador de conexión en tiempo real */}
        <RealtimeIndicator status={realtimeStatus} lastEvent={lastRealtimeEvent} />
      </div>
    </div>
  )
}
