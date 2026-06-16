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
import type { Locale } from 'date-fns'
import { useI18n, getDateLocale, type TFunc } from '@/lib/i18n/i18n'
import { DateScroller, getWeekStart } from './DateScroller'
import { getLeaderScope } from '@/lib/leaderContext'
import { toast } from 'sonner'
import {
  deleteAllZones,
  generateRouteZones, previewRouteZones, type RouteZoneResult,
} from '@/lib/generateCityZones'
import { TechnicianList } from '@/components/panels/TechnicianList'
import {
  ChevronRight, RefreshCw, FolderOpen,
  Sun, Sunset, CheckCircle2, Clock, WifiOff,
  Eye, EyeOff, MapPinned, Layers, Trash2,
  AlertTriangle, Loader2, X,
  Plus, Upload, ClipboardList, Wrench, MapPin, Building2, BarChart3,
  History, FileText, Bell, Settings,
} from 'lucide-react'

type PanelView = 'stats' | 'upload' | 'routes' | 'technicians' | 'campaigns'
  | 'history' | 'reports' | 'alerts' | 'settings'

interface LeaderMapProps {
  onOpenPanel: (panel: PanelView) => void
  unreadAlertsCount?: number
}

const FAB_ACTIONS: { id: PanelView | 'zones'; icon: React.ElementType; labelKey: string }[] = [
  { id: 'stats',       icon: BarChart3,    labelKey: 'leaderMap.summary'        },
  { id: 'upload',      icon: Upload,       labelKey: 'leaderMap.uploadRoutes'   },
  { id: 'routes',      icon: ClipboardList,labelKey: 'leaderPanel.title.routes' },
  { id: 'technicians', icon: Wrench,       labelKey: 'dashboard.technicians'    },
  { id: 'campaigns',   icon: Building2,    labelKey: 'leaderPanel.title.campaigns' },
  { id: 'history',     icon: History,      labelKey: 'dashboard.history'        },
  { id: 'reports',     icon: FileText,     labelKey: 'dashboard.reports'        },
  { id: 'alerts',      icon: Bell,         labelKey: 'dashboard.alerts'         },
  { id: 'settings',    icon: Settings,     labelKey: 'leaderPanel.title.settings' },
  { id: 'zones',       icon: Layers,       labelKey: 'dashboard.zones'          },
]

const fabItemVariants = {
  hidden: { opacity: 0, scale: 0.85, y: 8 },
  visible: (i: number) => ({
    opacity: 1, scale: 1, y: 0,
    transition: { delay: i * 0.04, duration: 0.15, ease: 'easeOut' as const },
  }),
  exit: (i: number) => ({
    opacity: 0, scale: 0.85, y: 8,
    transition: { delay: (FAB_ACTIONS.length - 1 - i) * 0.03, duration: 0.12, ease: 'easeIn' as const },
  }),
}

interface RouteRow {
  id: string
  technician_name: string
  technician_id: string | null
  campaign_id: string | null
  am: number; pm: number; done: number; total: number
  techStatus: string
}

function dayLabel(d: string, t: TFunc, locale: Locale) {
  const p = parseISO(d)
  if (isToday(p))     return t('history.today')
  if (isTomorrow(p))  return t('assign.tomorrow')
  if (isYesterday(p)) return t('routes.yesterday')
  return format(p, "EEE d MMM", { locale })
}

export function LeaderMap({ onOpenPanel, unreadAlertsCount = 0 }: LeaderMapProps) {
  const { t, lang } = useI18n()
  const locale = getDateLocale(lang)
  const navigate = useNavigate()
  const today = format(new Date(), 'yyyy-MM-dd')
  const [selectedDate, setSelectedDate] = useState(today)

  const [scopeIds, setScopeIds] = useState<string[] | null>(null)
  // Todos los técnicos del líder (incl. inactivos) para acotar las rutas.
  const [allScopeIds, setAllScopeIds] = useState<string[] | null>(null)
  useEffect(() => {
    getLeaderScope().then(s => { setScopeIds(s.technicianIds); setAllScopeIds(s.allTechnicianIds) })
  }, [])

  useRealtimeTechnicians(scopeIds)
  useZones(selectedDate)
  useZoneEvents(scopeIds)

  const { selectedTechnicianId, realtimeStatus, selectTechnician } = useTrackingStore()
  const { zones, showZones, toggleShowZones, selectedZoneId, selectZone } = useZonesStore()
  const [weekStart, setWeekStart]       = useState(getWeekStart(today))
  const [markedDates, setMarkedDates]   = useState<string[]>([])
  const [routes, setRoutes]             = useState<RouteRow[]>([])
  const [loading, setLoading]           = useState(false)
  const [collapsed, setCollapsed]       = useState(false)

  const [sideTab, setSideTab] = useState<'techs' | 'routes'>('techs')
  const [fabOpen, setFabOpen] = useState(false)
  const [clearingZones, setClearingZones] = useState(false)
  const [genOpen,    setGenOpen]    = useState(false)

  const [routePreviewCnt, setRoutePreviewCnt] = useState<number | null>(null)
  const [routeLoading,    setRouteLoading]    = useState(false)
  const [routeProgress,   setRouteProgress]   = useState<{ done: number; total: number } | null>(null)
  const [routeResult,     setRouteResult]     = useState<RouteZoneResult | null>(null)

  // Load marked dates for the week (only the leader's technicians)
  useEffect(() => {
    if (allScopeIds === null) return
    if (allScopeIds.length === 0) { setMarkedDates([]); return }
    const monday = parseISO(weekStart)
    const weekDates = Array.from({ length: 7 }, (_, i) => format(addDays(monday, i), 'yyyy-MM-dd'))
    supabase
      .from('technician_routes')
      .select('route_date')
      .in('route_date', weekDates)
      .in('technician_id', allScopeIds)
      .then(({ data }) => {
        setMarkedDates([...new Set(data?.map(r => r.route_date) ?? [])])
      })
  }, [weekStart, allScopeIds])

  const loadRoutes = useCallback(async () => {
    if (allScopeIds === null) return
    if (allScopeIds.length === 0) { setRoutes([]); return }
    setLoading(true)
    try {
      const { data } = await supabase
        .from('technician_routes')
        .select(`id, technician_name, technician_id, campaign_id,
          route_items(franja, status)`)
        .eq('route_date', selectedDate)
        .in('technician_id', allScopeIds)
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
  }, [selectedDate, allScopeIds])

  useEffect(() => { loadRoutes() }, [loadRoutes])

  function handleDateChange(d: string) {
    setSelectedDate(d)
    setWeekStart(getWeekStart(d))
  }

  function openGenerateModal() {
    setRouteResult(null)
    setRouteProgress(null)
    setRoutePreviewCnt(null)
    setGenOpen(true)
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
        toast.success(t(result.created === 1 ? 'dashboard.gen.zonesCreatedOk_one' : 'dashboard.gen.zonesCreatedOk_other', { n: result.created }))
      else
        toast.warning(t('dashboard.noGeocode'))
    } catch (err: any) {
      toast.error(err.message ?? t('dashboard.genError'))
    } finally {
      setRouteLoading(false)
    }
  }

  async function handleDeleteAllZones() {
    if (!window.confirm(t('leaderMap.confirmDeleteZones'))) return
    setClearingZones(true)
    try {
      await deleteAllZones()
      toast.success(t('leaderMap.allZonesDeleted'))
    } catch (err: any) {
      toast.error(err.message ?? t('leaderMap.deleteZonesError'))
    } finally {
      setClearingZones(false)
    }
  }

  const statusDot = {
    moving:    'bg-success animate-pulse',
    idle:      'bg-success',
    stopped:   'bg-text-muted',
    no_signal: 'bg-amber-500',
    offline:   'bg-border',
  }

  const realtimeCfg = {
    connecting:   { dot: 'bg-warning animate-pulse', text: 'text-warning',    label: t('realtime.connecting') },
    connected:    { dot: 'bg-success animate-pulse',  text: 'text-success',    label: t('realtime.connected') },
    error:        { dot: 'bg-danger',                 text: 'text-danger',     label: t('realtime.error') },
    disconnected: { dot: 'bg-text-muted',             text: 'text-text-muted', label: t('realtime.disconnected') },
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
          {/* Tab switcher */}
          <div className="px-3 pt-3 pb-2 border-b border-border-soft flex-shrink-0">
            <div className="flex gap-1 bg-base rounded-xl p-1">
              <button
                onClick={() => setSideTab('techs')}
                className={cn('flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all',
                  sideTab === 'techs' ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'
                )}
              >
                {t('dashboard.technicians')}
              </button>
              <button
                onClick={() => setSideTab('routes')}
                className={cn('flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all',
                  sideTab === 'routes' ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'
                )}
              >
                {t('leaderMap.tabRoutes')}
              </button>
            </div>
          </div>

          {/* Routes date header */}
          {sideTab === 'routes' && (
            <div className="px-3 pt-2 pb-2 border-b border-border-soft flex-shrink-0 space-y-2">
              <DateScroller
                selected={selectedDate}
                onChange={handleDateChange}
                weekStart={weekStart}
                onWeekChange={setWeekStart}
                markedDates={markedDates}
              />
              <div className="flex items-center gap-1.5">
                {[
                  { label: t('routes.yesterday'), d: format(addDays(new Date(), -1), 'yyyy-MM-dd') },
                  { label: t('history.today'),    d: today },
                  { label: t('assign.tomorrow'),  d: format(addDays(new Date(), 1),  'yyyy-MM-dd') },
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
          )}

          {/* Content */}
          {sideTab === 'techs' ? (
            selectedTechnicianId ? (
              <div className="flex-1 overflow-y-auto">
                <button
                  onClick={() => selectTechnician(null)}
                  className="w-full flex items-center gap-1.5 px-3 py-2 text-xs text-text-muted hover:text-text-primary hover:bg-surface-raised transition-colors border-b border-border-soft"
                >
                  <ChevronRight className="w-3.5 h-3.5 rotate-180" />
                  {t('leaderMap.backToTechs')}
                </button>
                <TechnicianDetail />
              </div>
            ) : (
              <TechnicianList className="flex-1 overflow-hidden" variant="leader" />
            )
          ) : (
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex justify-center py-10">
                  <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              ) : routes.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 px-4 text-center">
                  <FolderOpen className="w-8 h-8 text-text-muted/30" />
                  <p className="text-text-muted text-xs">{t('leaderMap.noRoutesFor', { day: dayLabel(selectedDate, t, locale).toLowerCase() })}</p>
                </div>
              ) : (
                <>
                  <div className="px-3 py-2 flex items-center justify-between">
                    <span className="text-text-muted text-xs">{t('leaderStats.techsInstalls', { techs: routes.length, installs: routes.reduce((s, r) => s + r.total, 0) })}</span>
                    {onField > 0 && (
                      <span className="text-xs text-success font-medium">{t('leaderMap.onField', { n: onField })}</span>
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
                          {t('leaderMap.backToList')}
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
                                    <WifiOff className="w-2.5 h-2.5" /> {t('routes.unlinked')}
                                  </span>
                                )}
                                {r.total > 0 && r.done < r.total && isToday(parseISO(selectedDate)) && r.techStatus !== 'offline' && (
                                  <span className="text-xs text-text-muted flex items-center gap-0.5 ml-auto">
                                    <Clock className="w-2.5 h-2.5" />{t('leaderMap.pending', { n: r.total - r.done })}
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
          )}

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

        {/* Botón para limpiar técnico seleccionado y volver al mapa normal */}
        <AnimatePresence>
          {selectedTechnicianId && (
            <motion.button
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              onClick={() => selectTechnician(null)}
              className="absolute top-4 left-4 z-[500] flex items-center gap-2 bg-surface/95 backdrop-blur-sm border border-border-soft rounded-xl px-3 py-2 shadow-xl text-xs text-text-secondary hover:text-danger hover:border-danger/40 hover:bg-danger/5 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              {t('leaderMap.clearSelection')}
            </motion.button>
          )}
        </AnimatePresence>

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
            title={showZones ? t('dashboard.hideZones') : t('dashboard.showZones')}
            className={cn(
              'bg-surface/90 backdrop-blur-sm border border-border-soft rounded-xl px-3 py-2 flex items-center gap-1.5 hover:bg-surface transition-colors shadow-xl text-xs',
              showZones ? 'text-primary' : 'text-text-muted'
            )}
          >
            {showZones ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            {t('dashboard.zones')} {zones.length > 0 && <span className="font-mono font-bold">{zones.length}</span>}
          </button>
          <button
            onClick={handleDeleteAllZones}
            disabled={clearingZones || zones.length === 0}
            title={t('leaderMap.deleteAllZonesTitle')}
            className="bg-surface/90 backdrop-blur-sm border border-border-soft rounded-xl px-3 py-2 flex items-center gap-1.5 hover:bg-surface transition-colors shadow-xl text-xs text-danger hover:text-danger/80 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {clearingZones ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            {t('leaderMap.clearBtn')}
          </button>
          <button
            onClick={openGenerateModal}
            title={t('leaderMap.updateZonesTitle')}
            className="bg-surface/90 backdrop-blur-sm border border-border-soft rounded-xl px-3 py-2 flex items-center gap-1.5 hover:bg-surface transition-colors shadow-xl text-xs text-violet-400 hover:text-violet-300"
          >
            <MapPinned className="w-3.5 h-3.5" />
            {t('common.refresh')}
          </button>
        </div>

        {/* FAB — Speed Dial (bottom right) */}
        <div className="absolute bottom-6 right-4 z-[500]">
          {/* Items — posicionados sobre el botón, no afectan su layout */}
          <div className="absolute bottom-14 right-0 flex flex-col items-end gap-2">
            <AnimatePresence>
              {fabOpen && FAB_ACTIONS.map((action, i) => {
                const Icon = action.icon
                const showBadge = action.id === 'alerts' && unreadAlertsCount > 0
                return (
                  <motion.button
                    key={action.id}
                    custom={i}
                    variants={fabItemVariants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    onClick={() => {
                      setFabOpen(false)
                      if (action.id === 'zones') { navigate('/zones'); return }
                      onOpenPanel(action.id as PanelView)
                    }}
                    className="flex items-center gap-2.5 bg-surface/95 backdrop-blur-sm border border-border-soft rounded-xl px-3 py-2 shadow-xl hover:bg-surface transition-colors group cursor-pointer"
                  >
                    <span className="text-text-muted text-xs font-medium group-hover:text-text-primary whitespace-nowrap">
                      {t(action.labelKey)}
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
          </div>

          {/* Botón principal — siempre en la misma posición, nunca se mueve */}
          <button
            onClick={() => setFabOpen(v => !v)}
            className={cn(
              'w-12 h-12 rounded-full shadow-xl flex items-center justify-center transition-all duration-200 relative',
              fabOpen
                ? 'bg-surface border border-border-soft text-text-muted hover:bg-surface-raised'
                : 'bg-primary text-white hover:bg-primary/90',
            )}
            title={t('leaderMap.actions')}
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
            onClick={(e) => { if (!routeLoading && e.target === e.currentTarget) setGenOpen(false) }}
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
                  <p className="font-bold text-text-primary text-sm">{t('dashboard.gen.title')}</p>
                  <p className="text-text-muted text-xs mt-0.5">{t('leaderMap.gen.subtitle')}</p>
                </div>
                {!routeLoading && (
                  <button onClick={() => setGenOpen(false)} className="text-text-muted hover:text-text-primary transition-colors p-1 rounded-lg hover:bg-surface-raised">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Generar zonas por rutas cargadas */}
              {routeResult ? (
                    <div className="space-y-3">
                      <div className="bg-success/10 border border-success/30 rounded-xl p-4 flex items-start gap-3">
                        <CheckCircle2 className="w-5 h-5 text-success flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-success text-sm">{t('dashboard.gen.completed')}</p>
                          <p className="text-text-muted text-xs mt-1">
                            <strong className="text-text-primary">{routeResult.created}</strong> {t('leaderMap.gen.zonesCreatedSuffix')}
                            {routeResult.skipped > 0 && <> · <strong className="text-warning">{routeResult.skipped}</strong> {t('leaderMap.gen.skippedSuffix')}</>}
                          </p>
                        </div>
                      </div>
                      <button onClick={() => setGenOpen(false)}
                        className="w-full py-2.5 rounded-xl bg-surface-raised hover:bg-border-soft text-text-secondary text-sm font-medium transition-colors">
                        {t('common.close')}
                      </button>
                    </div>
                  ) : routeLoading && routeProgress ? (
                    <div className="space-y-4">
                      <div className="flex items-center gap-2 text-xs text-text-muted">
                        <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
                        <span>{t('leaderMap.gen.geocoding')}</span>
                      </div>
                      <div className="w-full bg-base rounded-full h-2 overflow-hidden">
                        <motion.div
                          className="h-full bg-violet-500 rounded-full"
                          animate={{ width: `${routeProgress.total > 0 ? Math.round((routeProgress.done / routeProgress.total) * 100) : 0}%` }}
                          transition={{ type: 'spring', stiffness: 80 }}
                        />
                      </div>
                      <p className="text-center text-xs text-text-muted font-mono">
                        {t('leaderMap.gen.progress', { done: routeProgress.done, total: routeProgress.total })}
                      </p>
                      <p className="text-center text-xs text-text-muted/60">{t('leaderMap.gen.dontClose')}</p>
                    </div>
                  ) : (
                    <>
                      <div className="mb-4">
                        {routePreviewCnt === null ? (
                          <div className="flex items-center justify-center gap-2 py-8 text-text-muted text-xs">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            {t('leaderMap.gen.counting')}
                          </div>
                        ) : routePreviewCnt === 0 ? (
                          <div className="text-center py-8 space-y-2">
                            <p className="text-text-muted text-sm">{t('leaderMap.gen.noRoutesAddr')}</p>
                            <p className="text-text-muted/60 text-xs">{t('leaderMap.gen.loadExcelFirst')}</p>
                          </div>
                        ) : (
                          <div className="bg-base border border-border-soft rounded-xl p-4 space-y-2">
                            <div className="flex items-center gap-2">
                              <Layers className="w-4 h-4 text-violet-400" />
                              <p className="text-sm font-semibold text-text-primary">{t('dashboard.gen.uniqueAddresses', { n: routePreviewCnt })}</p>
                            </div>
                            <p className="text-xs text-text-muted leading-relaxed">
                              {t('leaderMap.gen.explainA')}<strong className="text-text-primary">Google Maps</strong>{t('leaderMap.gen.explainB')}<strong className="text-text-primary">{t('leaderMap.gen.explainBold')}</strong>{t('leaderMap.gen.explainC')}
                            </p>
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => setGenOpen(false)}
                          className="flex-1 py-2.5 rounded-xl bg-surface-raised hover:bg-border-soft text-text-secondary text-sm font-medium transition-colors">
                          {t('common.cancel')}
                        </button>
                        <button
                          onClick={handleGenerateRouteZones}
                          disabled={!routePreviewCnt || routePreviewCnt === 0}
                          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-50"
                        >
                          <Layers className="w-4 h-4" />
                          {t('dashboard.gen.generate')} {routePreviewCnt ? `(${routePreviewCnt})` : ''}
                        </button>
                      </div>
                    </>
                  )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
