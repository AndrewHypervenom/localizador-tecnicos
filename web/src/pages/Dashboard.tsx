import { useState, useEffect, useRef, useMemo } from 'react'
import { format } from 'date-fns'
import { motion, AnimatePresence } from 'framer-motion'
import { TrackingMap } from '@/components/map/TrackingMap'
import { TechnicianList } from '@/components/panels/TechnicianList'
import { TechnicianDetail } from '@/components/panels/TechnicianDetail'
import { AlertsPanel } from '@/components/panels/AlertsPanel'
import { ZoneDetailPanel } from '@/components/map/ZoneDetailPanel'
import { useRealtimeTechnicians } from '@/hooks/useRealtimeTechnicians'
import { useZones } from '@/hooks/useZones'
import { useZoneEvents } from '@/hooks/useZoneEvents'
import { useFleetLocations } from '@/hooks/useFleetLocations'
import { useTrackingStore } from '@/store/trackingStore'
import { useZonesStore } from '@/store/zonesStore'
import { useFleetStore } from '@/store/fleetStore'
import { getRoleFromSession } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { useSearchParams } from 'react-router-dom'
import {
  Users, Bell, ChevronRight, ChevronDown,
  LogOut, History, Layers, EyeOff, Eye, Shield, FileText, ClipboardList,
  MapPinned, AlertTriangle, CheckCircle2, Loader2, X, Search, MapPin,
  Building2,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  generateCityZones, previewCityZones, type CityPreview,
  generateRouteZones, previewRouteZones, type RouteZoneResult,
} from '@/lib/generateCityZones'
import { geocodeAddress, circlePolygon } from '@/lib/geocoding'
import { coordsToWkt } from '@/hooks/useZones'
import { ZONE_PALETTE } from '@/types/zones'

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

// ── Menú desplegable de Zonas ──────────────────────────────────────
function ZonesMenu({
  showZones, zones, toggleShowZones, isSuperAdmin, onGenerateZones,
  showLocations, locationCount, toggleShowLocations,
}: {
  showZones: boolean
  zones: unknown[]
  toggleShowZones: () => void
  isSuperAdmin: boolean
  onGenerateZones: () => void
  showLocations: boolean
  locationCount: number
  toggleShowLocations: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors',
          open
            ? 'bg-surface-raised text-text-primary'
            : 'text-text-secondary hover:text-text-primary hover:bg-surface-raised',
        )}
      >
        <Layers className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Zonas</span>
        {zones.length > 0 && (
          <span className={cn('font-mono font-bold', showZones ? 'text-primary' : 'text-text-muted')}>
            {zones.length}
          </span>
        )}
        <ChevronDown className={cn('w-3 h-3 text-text-muted transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 bg-surface border border-border-soft rounded-xl shadow-2xl py-1 min-w-[190px] z-10">
          <button
            onClick={() => { toggleShowZones(); setOpen(false) }}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors"
          >
            {showZones ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {showZones ? 'Ocultar zonas' : 'Mostrar zonas'}
          </button>
          <button
            onClick={() => { toggleShowLocations(); setOpen(false) }}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors"
          >
            {showLocations ? <EyeOff className="w-3.5 h-3.5" /> : <Building2 className="w-3.5 h-3.5" />}
            <span className="flex-1 text-left">{showLocations ? 'Ocultar ubicaciones' : 'Mostrar ubicaciones'}</span>
            {locationCount > 0 && (
              <span className={cn('font-mono font-bold text-[10px]', showLocations ? 'text-primary' : 'text-text-muted')}>
                {locationCount}
              </span>
            )}
          </button>
          <Link
            to="/zones"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3.5 py-2 text-xs text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors"
          >
            <Layers className="w-3.5 h-3.5" />
            Editor de zonas
          </Link>
          {isSuperAdmin && (
            <>
              <div className="border-t border-border-soft my-1" />
              <button
                onClick={() => { onGenerateZones(); setOpen(false) }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-violet-400 hover:text-violet-300 hover:bg-violet-500/10 transition-colors"
              >
                <MapPinned className="w-3.5 h-3.5" />
                Generar zonas automáticas
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export function Dashboard() {
  const today = useMemo(() => format(new Date(), 'yyyy-MM-dd'), [])

  useRealtimeTechnicians()
  useZones(today)
  useZoneEvents()
  useFleetLocations()

  const [searchParams] = useSearchParams()
  const { selectedTechnicianId, selectTechnician, alerts, zoneAlerts, realtimeStatus, lastRealtimeEvent } = useTrackingStore()
  const { zones, showZones, toggleShowZones, selectedZoneId, selectZone } = useZonesStore()
  const { locations: fleetLocations, showLocations, toggleShowLocations } = useFleetStore()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [activeTab, setActiveTab] = useState<ActiveTab>('technicians')
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [isLeader, setIsLeader] = useState(false)

  // Modal: generar zonas desde ciudades (flujo 3 estados: preview → confirm → result)
  const [genOpen,    setGenOpen]    = useState(false)
  const [genPreview, setGenPreview] = useState<CityPreview[] | null>(null)
  const [genLoading, setGenLoading] = useState(false)
  const [genResult,  setGenResult]  = useState<{ created: string[]; skipped: string[]; deleted: number } | null>(null)

  // Geocoding manual (fallback cuando no hay ciudades en técnicos)
  const [manualCity,       setManualCity]       = useState('')
  const [manualGeoResult,  setManualGeoResult]  = useState<{ lat: number; lng: number; displayName: string } | null>(null)
  const [manualGeoLoading, setManualGeoLoading] = useState(false)
  const [manualRadius,     setManualRadius]     = useState(6)
  const [manualSaving,     setManualSaving]     = useState(false)

  // Modo "Por rutas"
  const [genMode,         setGenMode]         = useState<'city' | 'route'>('city')
  const [routePreviewCnt, setRoutePreviewCnt] = useState<number | null>(null)
  const [routeRadius,     setRouteRadius]     = useState(0.3)
  const [routeLoading,    setRouteLoading]    = useState(false)
  const [routeProgress,   setRouteProgress]   = useState<{ done: number; total: number } | null>(null)
  const [routeResult,     setRouteResult]     = useState<RouteZoneResult | null>(null)

  // Seleccionar técnico desde URL (?tech=<id>)
  useEffect(() => {
    const techId = searchParams.get('tech')
    if (techId) selectTechnician(techId)
  }, [searchParams, selectTechnician])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const role = getRoleFromSession(session)
      setIsSuperAdmin(role === 'superadmin')
      setIsLeader(role === 'leader')
    })
  }, [])

  const unreadAlerts =
    alerts.filter((a) => !a.acknowledged).length +
    zoneAlerts.filter((a) => !a.acknowledged).length

  const handleLogout = async () => {
    await supabase.auth.signOut()
  }

  async function handleManualGeocode() {
    if (!manualCity.trim() || manualGeoLoading) return
    setManualGeoLoading(true)
    setManualGeoResult(null)
    try {
      const result = await geocodeAddress(manualCity.trim())
      if (!result) { toast.error('No se encontró la ciudad'); return }
      setManualGeoResult(result)
    } catch {
      toast.error('Error al buscar la ciudad')
    } finally {
      setManualGeoLoading(false)
    }
  }

  async function handleCreateManualZone() {
    if (!manualGeoResult) return
    setManualSaving(true)
    try {
      const coords  = circlePolygon(manualGeoResult.lat, manualGeoResult.lng, manualRadius)
      const wkt     = coordsToWkt(coords)
      const { data: session } = await supabase.auth.getSession()
      const userId  = session?.session?.user?.id
      const { error } = await supabase.from('zones').insert({
        name:       manualCity.trim(),
        type:       'service_area',
        color:      ZONE_PALETTE[0],
        polygon:    wkt,
        is_active:  true,
        created_by: userId ?? null,
      })
      if (error) throw error
      toast.success(`Zona "${manualCity.trim()}" creada`)
      setGenOpen(false)
      setManualGeoResult(null)
      setManualCity('')
    } catch (err: any) {
      toast.error(err.message ?? 'Error al crear zona')
    } finally {
      setManualSaving(false)
    }
  }

  function openGenerateModal() {
    setGenResult(null)
    setGenPreview(null)
    setManualGeoResult(null)
    setManualCity('')
    setGenMode('city')
    setRouteResult(null)
    setRouteProgress(null)
    setRoutePreviewCnt(null)
    setGenOpen(true)
    previewCityZones()
      .then(setGenPreview)
      .catch((err) => toast.error(err.message ?? 'Error al cargar vista previa'))
    previewRouteZones()
      .then(setRoutePreviewCnt)
      .catch(() => {})
  }

  async function handleGenerateRouteZones() {
    setRouteLoading(true)
    setRouteProgress({ done: 0, total: routePreviewCnt ?? 0 })
    setRouteResult(null)
    try {
      const result = await generateRouteZones(routeRadius, (done, total) => {
        setRouteProgress({ done, total })
      }, today)
      setRouteResult(result)
      if (result.created > 0)
        toast.success(`${result.created} zona${result.created !== 1 ? 's' : ''} creada${result.created !== 1 ? 's' : ''}`)
      else
        toast.warning('No se pudo geocodificar ninguna dirección')
    } catch (err: any) {
      toast.error(err.message ?? 'Error al generar zonas')
    } finally {
      setRouteLoading(false)
    }
  }

  async function handleGenerateZones() {
    setGenLoading(true)
    try {
      const result = await generateCityZones(6)
      setGenResult(result)
      if (result.created.length > 0) {
        toast.success(`${result.created.length} zona${result.created.length !== 1 ? 's' : ''} generada${result.created.length !== 1 ? 's' : ''}`)
      } else {
        toast.warning('No se encontraron ciudades con técnicos asignados')
      }
    } catch (err: any) {
      toast.error(err.message ?? 'Error al generar zonas')
      setGenOpen(false)
    } finally {
      setGenLoading(false)
    }
  }

  return (
    <div className="flex h-screen bg-base overflow-hidden">
      {/* Sidebar izquierdo */}
      <motion.div
        animate={{ width: sidebarCollapsed ? 0 : 320 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="flex-shrink-0 bg-surface border-r border-border-soft overflow-hidden"
      >
        {/* Wrapper de ancho fijo — evita reflow del contenido durante la animación */}
        <motion.div
          animate={{ opacity: sidebarCollapsed ? 0 : 1 }}
          transition={{ duration: 0.12 }}
          className="w-[320px] h-full flex flex-col"
        >
          {/* Tabs del sidebar */}
          <div className="flex border-b border-border-soft flex-shrink-0">
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
          <div className="flex-1 overflow-hidden">
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
      </motion.div>

      {/* Botón colapsar/expandir sidebar — sigue el borde del sidebar con spring sincronizado */}
      <motion.button
        animate={{ left: sidebarCollapsed ? 0 : 320 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        onClick={() => setSidebarCollapsed(v => !v)}
        title={sidebarCollapsed ? 'Mostrar panel' : 'Ocultar panel'}
        className="absolute top-1/2 -translate-y-1/2 z-[500] group"
      >
        <div className={cn(
          'flex items-center justify-center px-[5px] py-7 rounded-r-xl',
          'bg-surface border border-l-0 border-border-soft shadow-md',
          'group-hover:bg-primary/5 group-hover:border-primary/30 group-hover:shadow-primary/10',
          'transition-colors duration-200'
        )}>
          <motion.div
            animate={{ rotate: sidebarCollapsed ? 0 : 180 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          >
            <ChevronRight className="w-4 h-4 text-text-muted group-hover:text-primary transition-colors duration-200" />
          </motion.div>
        </div>
      </motion.button>

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

          <div className="flex items-center gap-1.5 pointer-events-auto flex-shrink-0">
            {/* Navegación principal agrupada */}
            <div className="bg-surface/90 backdrop-blur-sm border border-border-soft rounded-xl px-1.5 py-1.5 flex items-center shadow-xl">
              <Link
                to="/history"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors whitespace-nowrap"
              >
                <History className="w-3.5 h-3.5" />
                <span className="hidden lg:inline">Historial</span>
              </Link>
              <Link
                to="/reports"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors whitespace-nowrap"
              >
                <FileText className="w-3.5 h-3.5" />
                <span className="hidden lg:inline">Reportes</span>
              </Link>
              <ZonesMenu
                showZones={showZones}
                zones={zones}
                toggleShowZones={toggleShowZones}
                isSuperAdmin={isSuperAdmin}
                onGenerateZones={openGenerateModal}
                showLocations={showLocations}
                locationCount={fleetLocations.length}
                toggleShowLocations={toggleShowLocations}
              />
            </div>

            {/* Accesos directos de rol */}
            {isLeader && (
              <Link
                to="/leader"
                className="bg-warning/90 backdrop-blur-sm border border-warning/50 rounded-xl px-3 py-2 flex items-center gap-1.5 hover:bg-warning transition-colors shadow-xl text-xs text-white font-medium"
              >
                <ClipboardList className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Mi Panel</span>
              </Link>
            )}
            {isSuperAdmin && (
              <Link
                to="/admin"
                className="bg-primary/90 backdrop-blur-sm border border-primary/50 rounded-xl px-3 py-2 flex items-center gap-1.5 hover:bg-primary transition-colors shadow-xl text-xs text-white font-medium"
              >
                <Shield className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Admin</span>
              </Link>
            )}

            {/* Logout */}
            <button
              onClick={handleLogout}
              title="Cerrar sesión"
              className="bg-surface/90 backdrop-blur-sm border border-border-soft rounded-xl p-2 hover:bg-danger/10 hover:border-danger/30 transition-colors shadow-xl"
            >
              <LogOut className="w-3.5 h-3.5 text-text-muted hover:text-danger transition-colors" />
            </button>
          </div>
        </div>

        {/* Panel de detalle de zona seleccionada */}
        <AnimatePresence>
          {selectedZoneId && (() => {
            const zone = zones.find(z => z.id === selectedZoneId)
            return zone ? (
              <div className="absolute bottom-16 left-4 z-[500]">
                <ZoneDetailPanel
                  zone={zone}
                  onClose={() => selectZone(null)}
                />
              </div>
            ) : null
          })()}
        </AnimatePresence>

        {/* Indicador de conexión en tiempo real */}
        <RealtimeIndicator status={realtimeStatus} lastEvent={lastRealtimeEvent} />
      </div>

      {/* ── Modal: Generar zonas desde ciudades ───────────────────────────── */}
      <AnimatePresence>
        {genOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={(e) => { if (!genLoading && !routeLoading && e.target === e.currentTarget) setGenOpen(false) }}
          >
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }} />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: '460px', margin: '0 16px' }}
              className="bg-surface border border-border-soft rounded-2xl shadow-2xl p-6"
            >
              {/* Header */}
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center flex-shrink-0">
                  <MapPinned className="w-5 h-5 text-violet-400" />
                </div>
                <div className="flex-1">
                  <p className="font-bold text-text-primary text-sm">Generar zonas en el mapa</p>
                  <p className="text-text-muted text-xs mt-0.5">
                    {genMode === 'route'
                      ? routeResult
                        ? 'Proceso completado'
                        : routePreviewCnt !== null
                          ? `${routePreviewCnt} dirección${routePreviewCnt !== 1 ? 'es' : ''} únicas en rutas`
                          : 'Cargando rutas…'
                      : genResult
                        ? 'Proceso completado'
                        : genPreview
                          ? `${genPreview.filter(c => c.hasCoords).length} ciudades detectadas`
                          : 'Cargando ciudades…'
                    }
                  </p>
                </div>
                {!genLoading && !routeLoading && (
                  <button onClick={() => setGenOpen(false)} className="text-text-muted hover:text-text-primary transition-colors p-1 rounded-lg hover:bg-surface-raised">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Tabs: Ciudades / Rutas */}
              {!genResult && !routeResult && (
                <div className="flex gap-1 bg-base rounded-xl p-1 mb-4">
                  <button
                    onClick={() => setGenMode('city')}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-all',
                      genMode === 'city'
                        ? 'bg-surface text-violet-400 shadow-sm'
                        : 'text-text-muted hover:text-text-secondary'
                    )}
                  >
                    <MapPinned className="w-3.5 h-3.5" />
                    Por ciudades
                  </button>
                  <button
                    onClick={() => setGenMode('route')}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-all',
                      genMode === 'route'
                        ? 'bg-surface text-violet-400 shadow-sm'
                        : 'text-text-muted hover:text-text-secondary'
                    )}
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    Por direcciones de ruta
                    {routePreviewCnt !== null && routePreviewCnt > 0 && (
                      <span className="ml-1 bg-violet-500/20 text-violet-400 text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                        {routePreviewCnt}
                      </span>
                    )}
                  </button>
                </div>
              )}

              {/* ── Modo Rutas ── */}
              {genMode === 'route' && (
                routeResult ? (
                  <div className="space-y-3">
                    <div className="bg-success/10 border border-success/30 rounded-xl p-4 flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-success flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-success text-sm">
                          {routeResult.created} zona{routeResult.created !== 1 ? 's' : ''} creada{routeResult.created !== 1 ? 's' : ''} correctamente
                        </p>
                        <p className="text-text-muted text-xs mt-0.5">
                          {routeResult.skipped > 0 && `${routeResult.skipped} sin geocodificar · `}
                          {routeResult.total} dirección{routeResult.total !== 1 ? 'es' : ''} procesada{routeResult.total !== 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>
                    <button onClick={() => setGenOpen(false)}
                      className="w-full py-2.5 rounded-xl bg-surface-raised hover:bg-border-soft text-text-secondary text-sm font-medium transition-colors">
                      Cerrar
                    </button>
                  </div>
                ) : routeLoading ? (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-text-muted">
                        <span>Geocodificando direcciones…</span>
                        <span className="font-mono">{routeProgress?.done ?? 0} / {routeProgress?.total ?? 0}</span>
                      </div>
                      <div className="w-full bg-base rounded-full h-2 overflow-hidden">
                        <div
                          className="h-2 rounded-full bg-violet-500 transition-all duration-300"
                          style={{ width: routeProgress?.total ? `${(routeProgress.done / routeProgress.total) * 100}%` : '0%' }}
                        />
                      </div>
                      <p className="text-xs text-text-muted/60 text-center">
                        Esto puede tomar ~{routeProgress?.total ? Math.ceil(routeProgress.total * 1.1) : '?'}s · No cierres esta ventana
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {routePreviewCnt === 0 ? (
                      <div className="text-center py-8">
                        <p className="text-text-muted text-sm">No hay rutas cargadas.</p>
                        <p className="text-text-muted/60 text-xs mt-1">Cargá rutas desde el Panel de Líder primero.</p>
                      </div>
                    ) : (
                      <>
                        <div className="bg-base border border-border-soft rounded-xl px-4 py-3 flex items-center justify-between">
                          <div>
                            <p className="text-sm font-semibold text-text-primary">{routePreviewCnt ?? '…'} direcciones únicas</p>
                            <p className="text-xs text-text-muted mt-0.5">Se creará un círculo en cada instalación</p>
                          </div>
                          <MapPin className="w-5 h-5 text-violet-400 flex-shrink-0" />
                        </div>

                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs text-text-muted">Radio por dirección</span>
                            <span className="text-xs font-mono text-text-primary">{routeRadius} km</span>
                          </div>
                          <input
                            type="range" min={0.1} max={5} step={0.1}
                            value={routeRadius}
                            onChange={e => setRouteRadius(Number(e.target.value))}
                            className="w-full accent-violet-500"
                          />
                          <div className="flex justify-between text-[10px] text-text-muted mt-0.5">
                            <span>100 m</span><span>5 km</span>
                          </div>
                        </div>

                        <div className="bg-warning/10 border border-warning/30 rounded-xl p-3 flex items-start gap-2.5">
                          <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
                          <p className="text-xs text-text-secondary leading-relaxed">
                            Las zonas existentes <strong className="text-text-primary">no se borran</strong>. Se agregan nuevas zonas tipo <em>Punto de control</em>.
                          </p>
                        </div>
                      </>
                    )}

                    <div className="flex gap-2">
                      <button onClick={() => setGenOpen(false)}
                        className="flex-1 py-2.5 rounded-xl bg-surface-raised hover:bg-border-soft text-text-secondary text-sm font-medium transition-colors">
                        Cancelar
                      </button>
                      <button
                        onClick={handleGenerateRouteZones}
                        disabled={!routePreviewCnt || routePreviewCnt === 0}
                        className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-50"
                      >
                        <MapPin className="w-4 h-4" />
                        Generar {routePreviewCnt !== null ? `(${routePreviewCnt})` : ''}
                      </button>
                    </div>
                  </div>
                )
              )}

              {/* ── Modo Ciudades ── */}
              {genMode === 'city' && (genResult ? (
                <div className="space-y-3">
                  <div className="bg-success/10 border border-success/30 rounded-xl p-4 flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-success flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-success text-sm">
                        {genResult.created.length} zona{genResult.created.length !== 1 ? 's' : ''} creada{genResult.created.length !== 1 ? 's' : ''} correctamente
                      </p>
                      {genResult.deleted > 0 && (
                        <p className="text-text-muted text-xs mt-0.5">{genResult.deleted} zona{genResult.deleted !== 1 ? 's' : ''} anterior{genResult.deleted !== 1 ? 'es' : ''} eliminada{genResult.deleted !== 1 ? 's' : ''}</p>
                      )}
                      {genResult.created.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {genResult.created.map(c => (
                            <span key={c} className="text-[11px] bg-success/10 text-success border border-success/20 rounded-lg px-2 py-0.5">{c}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {genResult.skipped.length > 0 && (
                    <div className="bg-warning/10 border border-warning/30 rounded-xl p-3 flex items-start gap-2.5">
                      <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-text-muted">
                        <strong className="text-warning">Sin coordenadas:</strong> {genResult.skipped.join(', ')}
                      </p>
                    </div>
                  )}
                  <button onClick={() => setGenOpen(false)}
                    className="w-full py-2.5 rounded-xl bg-surface-raised hover:bg-border-soft text-text-secondary text-sm font-medium transition-colors">
                    Cerrar
                  </button>
                </div>
              ) : (
                <>
                  {/* ── Vista previa de ciudades ── */}
                  <div className="mb-4">
                    {!genPreview ? (
                      <div className="flex items-center justify-center gap-2 py-8 text-text-muted text-xs">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Consultando técnicos…
                      </div>
                    ) : genPreview.length === 0 ? (
                      <div className="space-y-4">
                        <div className="text-center py-4 space-y-1">
                          <p className="text-text-muted text-sm">Ningún técnico tiene ciudad asignada.</p>
                          <p className="text-text-muted/60 text-xs">Podés crear una zona de ciudad manualmente:</p>
                        </div>

                        <div className="border-t border-border-soft pt-4 space-y-3">
                          <div className="flex gap-2">
                            <input
                              value={manualCity}
                              onChange={e => setManualCity(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter' && !manualGeoLoading) handleManualGeocode() }}
                              placeholder="Ej: Bogotá, Colombia"
                              className="flex-1 bg-base border border-border-soft rounded-xl px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
                            />
                            <button
                              onClick={handleManualGeocode}
                              disabled={manualGeoLoading || !manualCity.trim()}
                              className="px-3 py-2 rounded-xl bg-violet-600/10 hover:bg-violet-600/20 text-violet-400 transition-colors disabled:opacity-50 flex items-center justify-center"
                            >
                              {manualGeoLoading
                                ? <span className="w-4 h-4 border-2 border-violet-400/30 border-t-violet-400 rounded-full animate-spin block" />
                                : <Search className="w-4 h-4" />
                              }
                            </button>
                          </div>

                          {manualGeoResult && (
                            <div className="bg-base border border-violet-500/20 rounded-xl p-3 space-y-3">
                              <div className="flex items-start gap-2">
                                <MapPin className="w-3.5 h-3.5 text-violet-400 flex-shrink-0 mt-0.5" />
                                <p className="text-xs text-text-secondary leading-relaxed line-clamp-2">{manualGeoResult.displayName}</p>
                              </div>
                              <div>
                                <div className="flex items-center justify-between mb-1.5">
                                  <span className="text-xs text-text-muted">Radio de zona</span>
                                  <span className="text-xs font-mono text-text-primary">{manualRadius} km</span>
                                </div>
                                <input
                                  type="range" min={1} max={50} step={1}
                                  value={manualRadius}
                                  onChange={e => setManualRadius(Number(e.target.value))}
                                  className="w-full accent-violet-500"
                                />
                              </div>
                              <button
                                onClick={handleCreateManualZone}
                                disabled={manualSaving}
                                className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-semibold bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-60"
                              >
                                {manualSaving
                                  ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                  : <><MapPinned className="w-4 h-4" />Crear zona circular</>
                                }
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-xs text-text-muted uppercase tracking-wider font-medium mb-2">
                          Zonas que se crearán
                        </p>
                        <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                          {genPreview.map((c) => (
                            <div key={c.city} className={cn(
                              'flex items-center gap-2.5 px-3 py-2 rounded-xl border text-xs',
                              c.hasCoords
                                ? 'bg-base border-border-soft text-text-secondary'
                                : 'bg-warning/5 border-warning/30 text-text-muted'
                            )}>
                              <span className={cn(
                                'w-1.5 h-1.5 rounded-full flex-shrink-0',
                                c.hasCoords ? 'bg-success' : 'bg-warning'
                              )} />
                              <span className="font-medium">{c.city}</span>
                              {c.country && <span className="text-text-muted">· {c.country}</span>}
                              {!c.hasCoords && <span className="ml-auto text-warning text-[10px]">sin coords</span>}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Advertencia */}
                  {genPreview && genPreview.length > 0 && (
                    <div className="bg-warning/10 border border-warning/30 rounded-xl p-3 flex items-start gap-2.5 mb-4">
                      <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-text-secondary leading-relaxed">
                        Se <strong className="text-text-primary">borrarán todas las zonas existentes</strong> y se crearán zonas circulares de 6 km por cada ciudad.
                      </p>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button onClick={() => setGenOpen(false)} disabled={genLoading}
                      className="flex-1 py-2.5 rounded-xl bg-surface-raised hover:bg-border-soft text-text-secondary text-sm font-medium transition-colors disabled:opacity-50">
                      Cancelar
                    </button>
                    <button
                      onClick={handleGenerateZones}
                      disabled={genLoading || !genPreview || genPreview.filter(c => c.hasCoords).length === 0}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-50"
                    >
                      {genLoading
                        ? <><Loader2 className="w-4 h-4 animate-spin" />Generando…</>
                        : <><MapPinned className="w-4 h-4" />Generar {genPreview && `(${genPreview.filter(c => c.hasCoords).length})`}</>
                      }
                    </button>
                  </div>
                </>
              ))}

            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
