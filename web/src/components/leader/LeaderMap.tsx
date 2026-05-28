import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { TrackingMap } from '@/components/map/TrackingMap'
import { ZoneDetailPanel } from '@/components/map/ZoneDetailPanel'
import { TechnicianDetail } from '@/components/panels/TechnicianDetail'
import { useRealtimeTechnicians } from '@/hooks/useRealtimeTechnicians'
import { useZones } from '@/hooks/useZones'
import { useZoneEvents } from '@/hooks/useZoneEvents'
import { useTrackingStore } from '@/store/trackingStore'
import { useZonesStore } from '@/store/zonesStore'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { format, addDays, parseISO, isToday, isTomorrow, isYesterday } from 'date-fns'
import { es } from 'date-fns/locale'
import { DateScroller, getWeekStart } from './DateScroller'
import { toast } from 'sonner'
import {
  generateCityZones, previewCityZones, deleteAllZones, type CityPreview,
  generateRouteZones, previewRouteZones, type RouteZoneResult,
} from '@/lib/generateCityZones'
import {
  ChevronRight, RefreshCw, FolderOpen,
  Sun, Sunset, CheckCircle2, Clock, WifiOff,
  Eye, EyeOff, MapPinned, Layers, Trash2,
  AlertTriangle, Loader2, X,
  Plus, Upload, ClipboardList, Wrench, MapPin, Building2, BarChart3,
  History, FileText, Bell,
} from 'lucide-react'

type PanelView = 'stats' | 'upload' | 'routes' | 'technicians' | 'campaigns' | 'fleet'
  | 'history' | 'reports' | 'alerts'

interface LeaderMapProps {
  onOpenPanel: (panel: PanelView) => void
  unreadAlertsCount?: number
}

const FAB_ACTIONS: { id: PanelView | 'zones'; icon: React.ElementType; label: string }[] = [
  { id: 'stats',       icon: BarChart3,    label: 'Resumen'     },
  { id: 'upload',      icon: Upload,       label: 'Subir rutas' },
  { id: 'routes',      icon: ClipboardList,label: 'Ver rutas'   },
  { id: 'technicians', icon: Wrench,       label: 'Técnicos'    },
  { id: 'fleet',       icon: MapPin,       label: 'Ubicaciones' },
  { id: 'campaigns',   icon: Building2,    label: 'Campañas'    },
  { id: 'history',     icon: History,      label: 'Historial'   },
  { id: 'reports',     icon: FileText,     label: 'Reportes'    },
  { id: 'alerts',      icon: Bell,         label: 'Alertas'     },
  { id: 'zones',       icon: Layers,       label: 'Zonas'       },
]

interface RouteRow {
  id: string
  technician_name: string
  technician_id: string | null
  campaign_id: string | null
  am: number; pm: number; done: number; total: number
  techStatus: string
}

function dayLabel(d: string) {
  const p = parseISO(d)
  if (isToday(p))     return 'Hoy'
  if (isTomorrow(p))  return 'Mañana'
  if (isYesterday(p)) return 'Ayer'
  return format(p, "EEE d MMM", { locale: es })
}

export function LeaderMap({ onOpenPanel, unreadAlertsCount = 0 }: LeaderMapProps) {
  const navigate = useNavigate()
  const today = format(new Date(), 'yyyy-MM-dd')
  const [selectedDate, setSelectedDate] = useState(today)

  useRealtimeTechnicians()
  useZones(selectedDate)
  useZoneEvents()

  const { selectedTechnicianId, realtimeStatus, selectTechnician } = useTrackingStore()
  const { zones, showZones, toggleShowZones, selectedZoneId, selectZone } = useZonesStore()
  const [weekStart, setWeekStart]       = useState(getWeekStart(today))
  const [markedDates, setMarkedDates]   = useState<string[]>([])
  const [routes, setRoutes]             = useState<RouteRow[]>([])
  const [loading, setLoading]           = useState(false)
  const [collapsed, setCollapsed]       = useState(false)

  const [fabOpen, setFabOpen] = useState(false)
  const [clearingZones, setClearingZones] = useState(false)
  const [genOpen,    setGenOpen]    = useState(false)
  const [genMode,    setGenMode]    = useState<'city' | 'route'>('route')
  const [genPreview, setGenPreview] = useState<CityPreview[] | null>(null)
  const [genLoading, setGenLoading] = useState(false)
  const [genResult,  setGenResult]  = useState<{ created: string[]; skipped: string[]; deleted: number } | null>(null)

  const [routePreviewCnt, setRoutePreviewCnt] = useState<number | null>(null)
  const [routeLoading,    setRouteLoading]    = useState(false)
  const [routeProgress,   setRouteProgress]   = useState<{ done: number; total: number } | null>(null)
  const [routeResult,     setRouteResult]     = useState<RouteZoneResult | null>(null)

  // Load marked dates for the week
  useEffect(() => {
    const monday = parseISO(weekStart)
    const weekDates = Array.from({ length: 7 }, (_, i) => format(addDays(monday, i), 'yyyy-MM-dd'))
    supabase
      .from('technician_routes')
      .select('route_date')
      .in('route_date', weekDates)
      .then(({ data }) => {
        setMarkedDates([...new Set(data?.map(r => r.route_date) ?? [])])
      })
  }, [weekStart])

  const loadRoutes = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await supabase
        .from('technician_routes')
        .select(`id, technician_name, technician_id, campaign_id,
          route_items(franja, status)`)
        .eq('route_date', selectedDate)
        .order('technician_name')

      const techIds = (data ?? []).map(r => r.technician_id).filter(Boolean) as string[]
      let statusMap = new Map<string, string>()
      if (techIds.length > 0) {
        const { data: st } = await supabase
          .from('technician_current_status')
          .select('id, status')
          .in('id', techIds)
        statusMap = new Map(st?.map(s => [s.id, s.status]) ?? [])
      }

      setRoutes((data ?? []).map(r => {
        const items = r.route_items as Array<{ franja: string; status: string }>
        return {
          id: r.id,
          technician_name: r.technician_name,
          technician_id: r.technician_id,
          campaign_id: r.campaign_id,
          am:    items.filter(i => i.franja === 'AM').length,
          pm:    items.filter(i => i.franja === 'PM').length,
          done:  items.filter(i => i.status === 'completed').length,
          total: items.length,
          techStatus: r.technician_id ? (statusMap.get(r.technician_id) ?? 'offline') : 'offline',
        }
      }))
    } finally {
      setLoading(false)
    }
  }, [selectedDate])

  useEffect(() => { loadRoutes() }, [loadRoutes])

  function handleDateChange(d: string) {
    setSelectedDate(d)
    setWeekStart(getWeekStart(d))
  }

  function openGenerateModal() {
    setGenResult(null)
    setGenPreview(null)
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
      const result = await generateRouteZones(0.3, (done, total) => setRouteProgress({ done, total }), selectedDate)
      setRouteResult(result)
      if (result.created > 0)
        toast.success(`${result.created} zona${result.created !== 1 ? 's' : ''} creada${result.created !== 1 ? 's' : ''} correctamente`)
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

  async function handleDeleteAllZones() {
    if (!window.confirm(`¿Borrar todas las zonas? Esta acción no se puede deshacer.`)) return
    setClearingZones(true)
    try {
      await deleteAllZones()
      toast.success('Todas las zonas eliminadas')
    } catch (err: any) {
      toast.error(err.message ?? 'Error al borrar zonas')
    } finally {
      setClearingZones(false)
    }
  }

  const statusDot = {
    moving:  'bg-success animate-pulse',
    idle:    'bg-warning',
    stopped: 'bg-text-muted',
    offline: 'bg-border',
  }

  const realtimeCfg = {
    connecting:   { dot: 'bg-warning animate-pulse', text: 'text-warning',    label: 'Conectando…' },
    connected:    { dot: 'bg-success animate-pulse',  text: 'text-success',    label: 'En vivo' },
    error:        { dot: 'bg-danger',                 text: 'text-danger',     label: 'Sin conexión' },
    disconnected: { dot: 'bg-text-muted',             text: 'text-text-muted', label: 'Desconectado' },
  }[realtimeStatus]

  const onField = routes.filter(r => r.techStatus !== 'offline').length

  return (
    <div className="flex h-full overflow-hidden relative">
      {/* Sidebar */}
      <motion.div
        animate={{ width: collapsed ? 0 : 300 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="flex-shrink-0 bg-surface border-r border-border-soft overflow-hidden"
      >
        <motion.div
          animate={{ opacity: collapsed ? 0 : 1 }}
          transition={{ duration: 0.12 }}
          className="w-[300px] h-full flex flex-col"
        >
          {/* Sidebar header */}
          <div className="px-3 pt-3 pb-2 border-b border-border-soft flex-shrink-0 space-y-2">
            <DateScroller
              selected={selectedDate}
              onChange={handleDateChange}
              weekStart={weekStart}
              onWeekChange={setWeekStart}
              markedDates={markedDates}
            />
            <div className="flex items-center gap-1.5">
              {[
                { label: 'Ayer',   d: format(addDays(new Date(), -1), 'yyyy-MM-dd') },
                { label: 'Hoy',    d: today },
                { label: 'Mañana', d: format(addDays(new Date(), 1),  'yyyy-MM-dd') },
              ].map(({ label, d }) => (
                <button key={label} onClick={() => handleDateChange(d)}
                  className={cn('flex-1 text-xs py-1 rounded-lg border transition-colors font-medium',
                    selectedDate === d
                      ? 'bg-primary text-white border-primary'
                      : 'border-border-soft text-text-muted hover:text-text-primary hover:bg-surface-raised'
                  )}>
                  {label}
                </button>
              ))}
              <button onClick={loadRoutes} className="p-1.5 text-text-muted hover:text-text-primary transition-colors rounded-lg hover:bg-surface-raised">
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Route list */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex justify-center py-10">
                <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : routes.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 px-4 text-center">
                <FolderOpen className="w-8 h-8 text-text-muted/30" />
                <p className="text-text-muted text-xs">Sin rutas para {dayLabel(selectedDate).toLowerCase()}</p>
              </div>
            ) : (
              <>
                <div className="px-3 py-2 flex items-center justify-between">
                  <span className="text-text-muted text-xs">{routes.length} técnicos · {routes.reduce((s, r) => s + r.total, 0)} instalaciones</span>
                  {onField > 0 && (
                    <span className="text-xs text-success font-medium">{onField} en campo</span>
                  )}
                </div>

                <AnimatePresence mode="wait">
                  {selectedTechnicianId ? (
                    <motion.div
                      key="detail"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="h-full overflow-y-auto"
                    >
                      <button
                        onClick={() => selectTechnician(null)}
                        className="w-full flex items-center gap-1.5 px-3 py-2 text-xs text-text-muted hover:text-text-primary hover:bg-surface-raised transition-colors border-b border-border-soft"
                      >
                        <ChevronRight className="w-3.5 h-3.5 rotate-180" />
                        Volver a la lista
                      </button>
                      <TechnicianDetail />
                    </motion.div>
                  ) : (
                    <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <div className="divide-y divide-border-soft">
                        {routes.map(r => (
                          <div
                            key={r.id}
                            onClick={() => r.technician_id && selectTechnician(r.technician_id)}
                            className={cn(
                              'px-3 py-3 transition-colors',
                              r.technician_id
                                ? 'hover:bg-surface-raised cursor-pointer'
                                : 'opacity-60',
                              selectedTechnicianId === r.technician_id && r.technician_id
                                ? 'bg-primary/5 border-l-2 border-primary pl-[10px]'
                                : ''
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <div className={cn('w-2 h-2 rounded-full flex-shrink-0',
                                statusDot[r.techStatus as keyof typeof statusDot] ?? 'bg-border'
                              )} />
                              <p className="text-text-primary text-xs font-semibold flex-1 truncate">{r.technician_name}</p>
                              {r.done > 0 && (
                                <span className="text-xs text-success font-medium flex items-center gap-0.5">
                                  <CheckCircle2 className="w-3 h-3" />{r.done}/{r.total}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 mt-1.5 pl-4">
                              {r.am > 0 && (
                                <span className="text-xs px-1.5 py-0.5 rounded bg-warning/10 text-warning border border-warning/20 flex items-center gap-1">
                                  <Sun className="w-2.5 h-2.5" />{r.am} AM
                                </span>
                              )}
                              {r.pm > 0 && (
                                <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 flex items-center gap-1">
                                  <Sunset className="w-2.5 h-2.5" />{r.pm} PM
                                </span>
                              )}
                              {r.techStatus === 'offline' && !r.technician_id && (
                                <span className="text-xs text-text-muted/50 flex items-center gap-0.5">
                                  <WifiOff className="w-2.5 h-2.5" /> Sin vincular
                                </span>
                              )}
                              {r.total > 0 && r.done < r.total && isToday(parseISO(selectedDate)) && r.techStatus !== 'offline' && (
                                <span className="text-xs text-text-muted flex items-center gap-0.5 ml-auto">
                                  <Clock className="w-2.5 h-2.5" />{r.total - r.done} pend.
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}
          </div>

          {/* Realtime status */}
          <div className="border-t border-border-soft px-3 py-2 flex items-center gap-2 flex-shrink-0">
            <div className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', realtimeCfg.dot)} />
            <span className={cn('text-xs font-medium', realtimeCfg.text)}>{realtimeCfg.label}</span>
          </div>
        </motion.div>
      </motion.div>

      {/* Collapse toggle */}
      <motion.button
        animate={{ left: collapsed ? 0 : 300 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        onClick={() => setCollapsed(v => !v)}
        className="absolute top-1/2 -translate-y-1/2 z-[500] group"
        style={{ position: 'absolute' }}
      >
        <div className={cn(
          'flex items-center justify-center px-[5px] py-7 rounded-r-xl',
          'bg-surface border border-l-0 border-border-soft shadow-md',
          'group-hover:bg-primary/5 group-hover:border-primary/30 transition-colors duration-200'
        )}>
          <motion.div animate={{ rotate: collapsed ? 0 : 180 }} transition={{ type: 'spring', stiffness: 300, damping: 30 }}>
            <ChevronRight className="w-4 h-4 text-text-muted group-hover:text-primary transition-colors duration-200" />
          </motion.div>
        </div>
      </motion.button>

      {/* Map */}
      <div className="flex-1 relative min-w-0">
        <TrackingMap className="h-full w-full" date={selectedDate} />

        {/* Panel de detalle de zona seleccionada */}
        <AnimatePresence>
          {selectedZoneId && (() => {
            const zone = zones.find(z => z.id === selectedZoneId)
            return zone ? (
              <div className="absolute bottom-4 left-4 z-[500]">
                <ZoneDetailPanel zone={zone} onClose={() => selectZone(null)} />
              </div>
            ) : null
          })()}
        </AnimatePresence>

        <div className="absolute top-4 right-4 z-[500] flex items-center gap-2">
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
          <button
            onClick={handleDeleteAllZones}
            disabled={clearingZones || zones.length === 0}
            title="Borrar todas las zonas"
            className="bg-surface/90 backdrop-blur-sm border border-border-soft rounded-xl px-3 py-2 flex items-center gap-1.5 hover:bg-surface transition-colors shadow-xl text-xs text-danger hover:text-danger/80 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {clearingZones ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            Borrar
          </button>
          <button
            onClick={openGenerateModal}
            title="Actualizar zonas desde ciudades de técnicos activos"
            className="bg-surface/90 backdrop-blur-sm border border-border-soft rounded-xl px-3 py-2 flex items-center gap-1.5 hover:bg-surface transition-colors shadow-xl text-xs text-violet-400 hover:text-violet-300"
          >
            <MapPinned className="w-3.5 h-3.5" />
            Actualizar
          </button>
        </div>

        {/* FAB — Speed Dial (bottom right) */}
        <div className="absolute bottom-6 right-4 z-[500] flex flex-col-reverse items-end gap-2">
          <AnimatePresence>
            {fabOpen && FAB_ACTIONS.map((action, i) => {
              const Icon = action.icon
              const showBadge = action.id === 'alerts' && unreadAlertsCount > 0
              return (
                <motion.button
                  key={action.id}
                  initial={{ opacity: 0, scale: 0.85, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.85, y: 8 }}
                  transition={{ delay: i * 0.035, duration: 0.15 }}
                  onClick={() => {
                    setFabOpen(false)
                    if (action.id === 'zones') { navigate('/zones'); return }
                    onOpenPanel(action.id as PanelView)
                  }}
                  className="flex items-center gap-2.5 bg-surface/95 backdrop-blur-sm border border-border-soft rounded-xl px-3 py-2 shadow-xl hover:bg-surface transition-colors group cursor-pointer"
                >
                  <span className="text-text-muted text-xs font-medium group-hover:text-text-primary whitespace-nowrap">
                    {action.label}
                  </span>
                  <div className="relative flex-shrink-0">
                    <Icon className="w-4 h-4 text-text-muted group-hover:text-primary transition-colors" />
                    {showBadge && (
                      <span className="absolute -top-1.5 -right-1.5 bg-danger text-white text-[9px] font-bold min-w-[14px] h-3.5 rounded-full flex items-center justify-center px-0.5 animate-pulse">
                        {unreadAlertsCount > 9 ? '9+' : unreadAlertsCount}
                      </span>
                    )}
                  </div>
                </motion.button>
              )
            })}
          </AnimatePresence>
          <button
            onClick={() => setFabOpen(v => !v)}
            className={cn(
              'w-12 h-12 rounded-full shadow-xl flex items-center justify-center transition-all duration-200 relative',
              fabOpen
                ? 'bg-surface border border-border-soft text-text-muted hover:bg-surface-raised'
                : 'bg-primary text-white hover:bg-primary/90',
            )}
            title="Acciones"
          >
            <motion.div
              animate={{ rotate: fabOpen ? 45 : 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            >
              <Plus className="w-5 h-5" />
            </motion.div>
            {!fabOpen && unreadAlertsCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-danger rounded-full text-[9px] text-white flex items-center justify-center font-bold animate-pulse">
                {unreadAlertsCount > 9 ? '9+' : unreadAlertsCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Modal: Generar zonas */}
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
              style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: '480px', margin: '0 16px' }}
              className="bg-surface border border-border-soft rounded-2xl shadow-2xl p-6"
            >
              {/* Header */}
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center flex-shrink-0">
                  <MapPinned className="w-5 h-5 text-violet-400" />
                </div>
                <div className="flex-1">
                  <p className="font-bold text-text-primary text-sm">Generar zonas en el mapa</p>
                  <p className="text-text-muted text-xs mt-0.5">Ubica automáticamente las zonas de trabajo</p>
                </div>
                {!genLoading && !routeLoading && (
                  <button onClick={() => setGenOpen(false)} className="text-text-muted hover:text-text-primary transition-colors p-1 rounded-lg hover:bg-surface-raised">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Tabs */}
              {!genResult && !routeResult && (
                <div className="flex gap-1 p-1 bg-base rounded-xl mb-4">
                  <button
                    onClick={() => setGenMode('route')}
                    disabled={routeLoading || genLoading}
                    className={cn(
                      'flex-1 py-2 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5',
                      genMode === 'route'
                        ? 'bg-violet-600 text-white shadow'
                        : 'text-text-muted hover:text-text-primary'
                    )}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    Por rutas cargadas
                    {routePreviewCnt !== null && <span className="bg-white/20 rounded-full px-1.5 py-0.5 text-[10px]">{routePreviewCnt}</span>}
                  </button>
                  <button
                    onClick={() => setGenMode('city')}
                    disabled={routeLoading || genLoading}
                    className={cn(
                      'flex-1 py-2 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5',
                      genMode === 'city'
                        ? 'bg-violet-600 text-white shadow'
                        : 'text-text-muted hover:text-text-primary'
                    )}
                  >
                    <MapPinned className="w-3.5 h-3.5" />
                    Por ciudad
                    {genPreview && <span className="bg-white/20 rounded-full px-1.5 py-0.5 text-[10px]">{genPreview.filter(c => c.hasCoords).length}</span>}
                  </button>
                </div>
              )}

              {/* ── Tab: RUTAS ── */}
              {genMode === 'route' && !genResult && (
                <>
                  {routeResult ? (
                    <div className="space-y-3">
                      <div className="bg-success/10 border border-success/30 rounded-xl p-4 flex items-start gap-3">
                        <CheckCircle2 className="w-5 h-5 text-success flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-success text-sm">Proceso completado</p>
                          <p className="text-text-muted text-xs mt-1">
                            <strong className="text-text-primary">{routeResult.created}</strong> zonas creadas correctamente
                            {routeResult.skipped > 0 && <> · <strong className="text-warning">{routeResult.skipped}</strong> sin geocodificar</>}
                          </p>
                        </div>
                      </div>
                      <button onClick={() => setGenOpen(false)}
                        className="w-full py-2.5 rounded-xl bg-surface-raised hover:bg-border-soft text-text-secondary text-sm font-medium transition-colors">
                        Cerrar
                      </button>
                    </div>
                  ) : routeLoading && routeProgress ? (
                    <div className="space-y-4">
                      <div className="flex items-center gap-2 text-xs text-text-muted">
                        <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
                        <span>Geocodificando con Google Maps…</span>
                      </div>
                      <div className="w-full bg-base rounded-full h-2 overflow-hidden">
                        <motion.div
                          className="h-full bg-violet-500 rounded-full"
                          animate={{ width: `${routeProgress.total > 0 ? Math.round((routeProgress.done / routeProgress.total) * 100) : 0}%` }}
                          transition={{ type: 'spring', stiffness: 80 }}
                        />
                      </div>
                      <p className="text-center text-xs text-text-muted font-mono">
                        {routeProgress.done} / {routeProgress.total} direcciones
                      </p>
                      <p className="text-center text-xs text-text-muted/60">No cierres esta ventana</p>
                    </div>
                  ) : (
                    <>
                      <div className="mb-4">
                        {routePreviewCnt === null ? (
                          <div className="flex items-center justify-center gap-2 py-8 text-text-muted text-xs">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Contando direcciones…
                          </div>
                        ) : routePreviewCnt === 0 ? (
                          <div className="text-center py-8 space-y-2">
                            <p className="text-text-muted text-sm">No hay rutas cargadas con direcciones.</p>
                            <p className="text-text-muted/60 text-xs">Carga un Excel primero en la pestaña "Cargar".</p>
                          </div>
                        ) : (
                          <div className="bg-base border border-border-soft rounded-xl p-4 space-y-2">
                            <div className="flex items-center gap-2">
                              <Layers className="w-4 h-4 text-violet-400" />
                              <p className="text-sm font-semibold text-text-primary">{routePreviewCnt} direcciones únicas</p>
                            </div>
                            <p className="text-xs text-text-muted leading-relaxed">
                              Se creará una zona circular por cada dirección usando <strong className="text-text-primary">Google Maps</strong> para ubicarlas con precisión.
                              Las zonas existentes <strong className="text-text-primary">no se borran</strong> — se agregan.
                            </p>
                          </div>
                        )}
                      </div>
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
                          <Layers className="w-4 h-4" />
                          Generar {routePreviewCnt ? `(${routePreviewCnt})` : ''}
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}

              {/* ── Tab: CIUDADES ── */}
              {genMode === 'city' && !routeResult && (
                <>
                  {genResult ? (
                    <div className="space-y-3">
                      <div className="bg-success/10 border border-success/30 rounded-xl p-4 flex items-start gap-3">
                        <CheckCircle2 className="w-5 h-5 text-success flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-success text-sm">
                            {genResult.created.length} zona{genResult.created.length !== 1 ? 's' : ''} creada{genResult.created.length !== 1 ? 's' : ''} correctamente
                          </p>
                          {genResult.deleted > 0 && (
                            <p className="text-text-muted text-xs mt-0.5">{genResult.deleted} zonas anteriores eliminadas</p>
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
                      <div className="mb-4">
                        {!genPreview ? (
                          <div className="flex items-center justify-center gap-2 py-8 text-text-muted text-xs">
                            <Loader2 className="w-4 h-4 animate-spin" />Consultando técnicos…
                          </div>
                        ) : genPreview.length === 0 ? (
                          <div className="text-center py-8">
                            <p className="text-text-muted text-sm">Ningún técnico tiene ciudad asignada.</p>
                          </div>
                        ) : (
                          <>
                            <p className="text-xs text-text-muted uppercase tracking-wider font-medium mb-2">Zonas que se crearán</p>
                            <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                              {genPreview.map((c) => (
                                <div key={c.city} className={cn(
                                  'flex items-center gap-2.5 px-3 py-2 rounded-xl border text-xs',
                                  c.hasCoords ? 'bg-base border-border-soft text-text-secondary' : 'bg-warning/5 border-warning/30 text-text-muted'
                                )}>
                                  <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', c.hasCoords ? 'bg-success' : 'bg-warning')} />
                                  <span className="font-medium">{c.city}</span>
                                  {c.country && <span className="text-text-muted">· {c.country}</span>}
                                  {!c.hasCoords && <span className="ml-auto text-warning text-[10px]">sin coords</span>}
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                      {genPreview && genPreview.length > 0 && (
                        <div className="bg-warning/10 border border-warning/30 rounded-xl p-3 flex items-start gap-2.5 mb-4">
                          <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
                          <p className="text-xs text-text-secondary leading-relaxed">
                            Se <strong className="text-text-primary">borrarán todas las zonas existentes</strong> y se crearán zonas de 6 km por ciudad.
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
                  )}
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
