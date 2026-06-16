import { useState, useEffect, useRef, useMemo } from 'react'
import { motion } from 'framer-motion'
import { MapContainer, Polyline, useMap } from 'react-leaflet'
import { MapBaseLayer } from '@/components/map/MapBaseLayer'
import { supabase } from '@/lib/supabase'
import api from '@/lib/api'
import { ElevationChart } from '@/components/charts/ElevationChart'
import { SpeedChart } from '@/components/charts/SpeedChart'
import {
  ArrowLeft, Play, Pause, SkipBack,
  Route, Gauge, Clock, AlertTriangle, TrendingUp,
  CornerDownLeft, RotateCcw, CalendarDays, CalendarX, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { format, parseISO, addDays } from 'date-fns'
import { Link } from 'react-router-dom'
import { useI18n, getDateLocale } from '@/lib/i18n/i18n'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'

type DateFilter = 'today' | 'expired' | 'custom'

interface Trip {
  id: string
  technician_id: string
  started_at: string
  ended_at: string | null
  status: string
  distance_km: number
  max_speed_kmh: number
  avg_speed_kmh: number
  min_speed_kmh: number
  duration_min: number | null
  hard_brakes: number
  rapid_accels: number
  harsh_turns: number
  accidents: number
}

interface RoutePoint {
  ts: string
  lat: number
  lng: number
  speed_kmh: number
  altitude: number
  bearing: number
  speed_band: 'low' | 'medium' | 'high'
}

const BAND_COLORS: Record<string, string> = {
  low: '#10B981', medium: '#F59E0B', high: '#EF4444',
}

const SPEEDS = [0.25, 0.5, 1, 2, 5, 10] as const
type Speed = typeof SPEEDS[number]
// Base: 250ms a 1x → ~4 puntos/segundo, perceptible y controlable
const BASE_MS = 250

function RoutePlayback({ points }: { points: RoutePoint[] }) {
  const { lang } = useI18n()
  const map = useMap()
  const [playhead, setPlayhead] = useState(0)
  const [playing, setPlaying]   = useState(false)
  const [speed, setSpeed]       = useState<Speed>(1)
  const intervalRef = useRef<number>()
  const markerRef   = useRef<any>(null)

  useEffect(() => {
    if (!points.length) return
    const latlngs: [number, number][] = points.map((p) => [p.lat, p.lng])
    const bounds = L.latLngBounds(latlngs)
    map.fitBounds(bounds, { padding: [40, 40] })
  }, [points, map])

  useEffect(() => {
    if (!playing) return
    intervalRef.current = window.setInterval(() => {
      setPlayhead((prev) => {
        if (prev >= points.length - 1) {
          setPlaying(false)
          return prev
        }
        return prev + 1
      })
    }, Math.round(BASE_MS / speed))
    return () => clearInterval(intervalRef.current)
  }, [playing, points.length, speed])

  useEffect(() => {
    if (!points[playhead]) return
    const p = points[playhead]

    if (markerRef.current) map.removeLayer(markerRef.current)
    markerRef.current = L.circleMarker([p.lat, p.lng], {
      radius: 8, fillColor: '#00D632', color: '#fff',
      fillOpacity: 1, weight: 2
    }).addTo(map)
  }, [playhead, points, map])

  // Segmentos coloreados por velocidad
  const segments: { points: [number, number][]; color: string }[] = []
  for (let i = 0; i < Math.min(playhead + 1, points.length - 1); i++) {
    const p = points[i]
    segments.push({
      points: [[p.lat, p.lng], [points[i + 1].lat, points[i + 1].lng]],
      color: BAND_COLORS[p.speed_band] ?? '#64748B',
    })
  }

  // Ruta completa (gris)
  const fullRoute: [number, number][] = points.map((p) => [p.lat, p.lng])

  return (
    <>
      <Polyline positions={fullRoute} pathOptions={{ color: '#252540', weight: 2, opacity: 0.5 }} />
      {segments.map((seg, i) => (
        <Polyline key={i} positions={seg.points} pathOptions={{ color: seg.color, weight: 4, opacity: 0.9 }} />
      ))}

      {/* Controles de playback */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1000] bg-surface/95 backdrop-blur-sm border border-border-soft rounded-2xl px-4 py-3 shadow-xl flex items-center gap-3">
        <button
          onClick={() => { setPlayhead(0); setPlaying(false) }}
          className="p-1.5 rounded-lg hover:bg-surface-raised text-text-secondary hover:text-text-primary transition-colors"
        >
          <SkipBack className="w-4 h-4" />
        </button>
        <button
          onClick={() => setPlaying(!playing)}
          className="p-2 bg-primary rounded-lg hover:bg-primary-hover transition-colors shadow-lg shadow-primary/30"
        >
          {playing ? <Pause className="w-4 h-4 text-white" /> : <Play className="w-4 h-4 text-white" />}
        </button>
        <span className="font-mono text-xs text-text-secondary min-w-[4.5rem]">
          {points[playhead] ? format(parseISO(points[playhead].ts), 'hh:mm:ss a', { locale: getDateLocale(lang) }) : '--:--:--'}
        </span>
        <input
          type="range" min={0} max={points.length - 1} value={playhead}
          onChange={(e) => { setPlaying(false); setPlayhead(Number(e.target.value)) }}
          className="w-40 accent-primary"
        />
        {/* Control de velocidad */}
        <div className="flex items-center gap-1 border-l border-border-soft pl-3">
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={cn(
                'px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold transition-colors',
                speed === s
                  ? 'bg-primary text-white'
                  : 'text-text-muted hover:text-text-secondary hover:bg-surface-raised'
              )}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>
    </>
  )
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}


function StatBadge({ icon: Icon, value, label, color = 'text-text-secondary' }: {
  icon: any; value: string | number; label: string; color?: string
}) {
  return (
    <div className="bg-surface-raised rounded-xl p-3 text-center">
      <Icon className={cn('w-4 h-4 mx-auto mb-1', color)} />
      <div className={cn('font-mono font-bold text-lg leading-none', color)}>{value}</div>
      <div className="text-text-muted text-xs mt-0.5">{label}</div>
    </div>
  )
}

export function History() {
  const { t, lang } = useI18n()
  const [technicians, setTechnicians] = useState<any[]>([])
  const [selectedTech, setSelectedTech] = useState<string>('')
  const [dateFilter, setDateFilter]     = useState<DateFilter>('today')
  const [customDate, setCustomDate]     = useState<string>('')
  const [trips, setTrips]               = useState<Trip[]>([])
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null)
  const [routePoints, setRoutePoints]   = useState<RoutePoint[]>([])
  const [elevData, setElevData]         = useState<any[]>([])
  const [loading, setLoading]           = useState(false)

  const todayStr = format(new Date(), 'yyyy-MM-dd')

  const liveRouteStats = useMemo(() => {
    if (!routePoints.length) return null
    const totalKm = routePoints.reduce((sum, p, i) => {
      if (i === 0) return 0
      return sum + haversineKm(routePoints[i - 1].lat, routePoints[i - 1].lng, p.lat, p.lng)
    }, 0)
    return {
      totalKm,
      maxSpeed: Math.max(...routePoints.map((p) => p.speed_kmh)),
      avgSpeed: routePoints.reduce((s, p) => s + p.speed_kmh, 0) / routePoints.length,
    }
  }, [routePoints])

  useEffect(() => {
    supabase.from('technicians').select('id, name').eq('active', true)
      .then(({ data }) => setTechnicians(data ?? []))
  }, [])

  const searchTrips = async (filter: DateFilter, custom: string, tech: string) => {
    if (!tech) return
    let from: string, to: string
    const now = new Date()
    if (filter === 'today') {
      from = to = format(now, 'yyyy-MM-dd')
    } else if (filter === 'expired') {
      from = format(new Date(Date.now() - 30 * 86400_000), 'yyyy-MM-dd')
      to   = format(new Date(Date.now() - 86400_000), 'yyyy-MM-dd')
    } else if (filter === 'custom' && custom) {
      from = to = custom
    } else {
      return
    }
    setLoading(true)
    const toNextDay = format(addDays(new Date(to + 'T12:00:00Z'), 1), 'yyyy-MM-dd')
    const { data } = await supabase.from('trips')
      .select('*')
      .eq('technician_id', tech)
      .gte('started_at', `${from}T05:00:00Z`)
      .lt('started_at', `${toNextDay}T05:00:00Z`)
      .order('started_at', { ascending: false })
    setTrips(data ?? [])
    setSelectedTrip(null)
    setLoading(false)
  }

  useEffect(() => {
    searchTrips(dateFilter, customDate, selectedTech)
  }, [selectedTech, dateFilter, customDate])

  const loadTripDetail = async (trip: Trip) => {
    setSelectedTrip(trip)
    setLoading(true)
    try {
      const to = trip.ended_at ?? new Date().toISOString()
      const [routeRes, elevRes] = await Promise.all([
        api.get(`/api/analytics/trips/${trip.id}/route`),
        api.get(`/api/analytics/technicians/${selectedTech}/elevation`, {
          params: { from: trip.started_at, to },
        }),
      ])
      setRoutePoints(routeRes.data)
      setElevData(elevRes.data)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  return (
    <div className="flex h-screen bg-base overflow-hidden">
      {/* Panel izquierdo */}
      <div className="w-80 flex-shrink-0 flex flex-col border-r border-border-soft bg-surface">
        <div className="px-4 py-3 border-b border-border-soft flex items-center gap-2">
          <Link to="/" className="p-1.5 rounded-lg hover:bg-surface-raised text-text-muted hover:text-text-primary transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <h1 className="font-bold text-text-primary text-sm flex-1">{t('history.title')}</h1>
          <LanguageSwitcher />
        </div>

        <div className="p-4 space-y-3 border-b border-border-soft">
          <div>
            <label className="block text-xs text-text-muted mb-1">{t('common.technician')}</label>
            <select
              value={selectedTech}
              onChange={(e) => setSelectedTech(e.target.value)}
              className="w-full bg-surface-raised border border-border rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary"
            >
              <option value="">{t('history.selectTech')}</option>
              {technicians.map((tech) => (
                <option key={tech.id} value={tech.id}>{tech.name}</option>
              ))}
            </select>
          </div>

          {/* Filtros rápidos por día */}
          <div className="flex gap-1.5">
            <button
              onClick={() => { setDateFilter('today'); setCustomDate('') }}
              className={cn(
                'flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors',
                dateFilter === 'today'
                  ? 'bg-primary/15 text-primary border border-primary/30'
                  : 'text-text-muted hover:text-text-secondary hover:bg-surface-raised border border-transparent'
              )}
            >
              <Clock className="w-3 h-3" />
              {t('history.today')}
            </button>
            <button
              onClick={() => { setDateFilter('expired'); setCustomDate('') }}
              className={cn(
                'flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors',
                dateFilter === 'expired'
                  ? 'bg-warning/15 text-warning border border-warning/30'
                  : 'text-text-muted hover:text-text-secondary hover:bg-surface-raised border border-transparent'
              )}
            >
              <CalendarX className="w-3 h-3" />
              {t('history.previous')}
            </button>
          </div>

          {/* Selector de día específico */}
          <div className="flex items-center gap-1.5">
            <CalendarDays className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
            <input
              type="date"
              value={customDate}
              max={todayStr}
              onChange={(e) => {
                setCustomDate(e.target.value)
                if (e.target.value) setDateFilter('custom')
                else setDateFilter('today')
              }}
              className={cn(
                'flex-1 bg-surface-raised border rounded-lg px-2 py-1 text-xs text-text-primary',
                'focus:outline-none focus:ring-1 focus:ring-primary/50 transition-colors',
                dateFilter === 'custom'
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-border'
              )}
            />
            {dateFilter === 'custom' && customDate && (
              <button
                onClick={() => { setCustomDate(''); setDateFilter('today') }}
                className="text-text-muted hover:text-text-primary transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Etiqueta del filtro activo */}
          <div className="text-xs text-text-muted flex items-center gap-1">
            <span>{t('history.showing')}</span>
            <span className={cn(
              'font-medium',
              dateFilter === 'today'   && 'text-primary',
              dateFilter === 'expired' && 'text-warning',
              dateFilter === 'custom'  && 'text-text-secondary',
            )}>
              {dateFilter === 'today'   && t('history.todayLabel', { date: format(new Date(), 'd MMM', { locale: getDateLocale(lang) }) })}
              {dateFilter === 'expired' && t('history.last30')}
              {dateFilter === 'custom'  && customDate && format(new Date(customDate + 'T00:00:00'), "d 'de' MMMM yyyy", { locale: getDateLocale(lang) })}
            </span>
            {trips.length > 0 && <span className="ml-auto">{t('history.tripsCount', { n: trips.length })}</span>}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {trips.map((trip) => {
            const inProgress = trip.status !== 'completed'
            const durationLabel = trip.duration_min != null
              ? `${trip.duration_min} min`
              : inProgress
                ? `${Math.round((Date.now() - new Date(trip.started_at).getTime()) / 60_000)} min`
                : '—'
            return (
              <motion.div
                key={trip.id}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => loadTripDetail(trip)}
                className={cn(
                  'p-3 rounded-xl cursor-pointer border transition-all',
                  selectedTrip?.id === trip.id
                    ? 'bg-primary/10 border-primary/30'
                    : inProgress
                      ? 'bg-success/5 border-success/20 hover:border-success/40'
                      : 'bg-surface-raised border-border-soft hover:border-border'
                )}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-medium text-text-primary">
                    {format(parseISO(trip.started_at), 'd MMM, h:mm a', { locale: getDateLocale(lang) })}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {inProgress && (
                      <span className="flex items-center gap-1 text-xs text-success font-medium">
                        <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                        {t('history.inProgress')}
                      </span>
                    )}
                    {trip.accidents > 0 && (
                      <span className="text-danger text-xs flex items-center gap-0.5">
                        <AlertTriangle className="w-3 h-3" /> {trip.accidents}
                      </span>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-1 text-xs text-text-muted">
                  <span className="flex items-center gap-0.5">
                    <Route className="w-3 h-3" /> {trip.distance_km?.toFixed(1) ?? '—'} km
                  </span>
                  <span className="flex items-center gap-0.5">
                    <Gauge className="w-3 h-3" /> {trip.max_speed_kmh?.toFixed(0) ?? '—'} km/h
                  </span>
                  <span className="flex items-center gap-0.5">
                    <Clock className="w-3 h-3" /> {durationLabel}
                  </span>
                </div>
              </motion.div>
            )
          })}
          {trips.length === 0 && !loading && selectedTech && (
            <div className="text-center text-text-muted text-sm py-8">
              {t('history.noTrips')}
            </div>
          )}
        </div>
      </div>

      {/* Panel derecho: mapa + estadísticas */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {selectedTrip && (
          <>
            <div className="p-4 border-b border-border-soft bg-surface">
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                  {selectedTrip.status !== 'completed' ? t('history.tripInProgress') : t('history.tripAnalysis')} — {format(parseISO(selectedTrip.started_at), 'd MMMM yyyy, h:mm a', { locale: getDateLocale(lang) })}
                </h2>
                {selectedTrip.status !== 'completed' && (
                  <span className="flex items-center gap-1 text-xs text-success font-medium">
                    <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" /> {t('history.inProgress')}
                  </span>
                )}
              </div>
              {(() => {
                const inProgress = selectedTrip.status !== 'completed'
                const distKm = inProgress && liveRouteStats ? liveRouteStats.totalKm.toFixed(2) : (selectedTrip.distance_km?.toFixed(2) ?? '—')
                const maxSpd = inProgress && liveRouteStats ? liveRouteStats.maxSpeed.toFixed(0) : (selectedTrip.max_speed_kmh?.toFixed(0) ?? '—')
                const avgSpd = inProgress && liveRouteStats ? liveRouteStats.avgSpeed.toFixed(0) : (selectedTrip.avg_speed_kmh?.toFixed(0) ?? '—')
                const durLabel = selectedTrip.duration_min != null
                  ? `${selectedTrip.duration_min} min`
                  : `${Math.round((Date.now() - new Date(selectedTrip.started_at).getTime()) / 60_000)} min`
                return (
                  <div className="grid grid-cols-4 lg:grid-cols-8 gap-2">
                    <StatBadge icon={Route}          value={distKm + ' km'}   label={t('history.distance')}  color="text-primary" />
                    <StatBadge icon={Clock}          value={durLabel}          label={t('history.duration')}  color="text-text-secondary" />
                    <StatBadge icon={TrendingUp}     value={maxSpd + ' km/h'} label={t('history.maxSpeed')}  color="text-danger" />
                    <StatBadge icon={Gauge}          value={avgSpd + ' km/h'} label={t('history.avgSpeed')}  color="text-warning" />
                    <StatBadge icon={AlertTriangle}  value={selectedTrip.accidents}    label={t('history.accidents')} color={selectedTrip.accidents > 0 ? 'text-danger' : 'text-text-muted'} />
                    <StatBadge icon={CornerDownLeft} value={selectedTrip.hard_brakes}  label={t('history.brakes')}    color={selectedTrip.hard_brakes > 0 ? 'text-warning' : 'text-text-muted'} />
                    <StatBadge icon={TrendingUp}     value={selectedTrip.rapid_accels} label={t('history.accels')}    color={selectedTrip.rapid_accels > 0 ? 'text-warning' : 'text-text-muted'} />
                    <StatBadge icon={RotateCcw}      value={selectedTrip.harsh_turns}  label={t('history.harshTurns')} color="text-text-muted" />
                  </div>
                )
              })()}
            </div>
            <div className="flex-1 flex overflow-hidden">
              <div className="flex-1 relative">
                <MapContainer center={[14.0723, -87.2061]} zoom={12} style={{ height: '100%', width: '100%' }} zoomControl={false} attributionControl={false}>
                  <MapBaseLayer />
                  {routePoints.length > 0 && <RoutePlayback points={routePoints} />}
                </MapContainer>
              </div>
              <div className="w-72 flex-shrink-0 flex flex-col border-l border-border-soft bg-surface overflow-y-auto p-4 space-y-4">
                <div>
                  <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">{t('history.elevation')}</h4>
                  <ElevationChart data={elevData} />
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">{t('history.speed')}</h4>
                  <SpeedChart data={routePoints.map((p) => ({ ts: p.ts, speed_kmh: p.speed_kmh, speed_band: p.speed_band }))} />
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">{t('history.speedOnRoute')}</h4>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-center gap-2"><div className="w-6 h-2 rounded bg-success" /><span className="text-text-muted">{t('history.speedLow')}</span></div>
                    <div className="flex items-center gap-2"><div className="w-6 h-2 rounded bg-warning" /><span className="text-text-muted">{t('history.speedMedium')}</span></div>
                    <div className="flex items-center gap-2"><div className="w-6 h-2 rounded bg-danger" /><span className="text-text-muted">{t('history.speedHigh')}</span></div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {!selectedTrip && (
          <div className="flex-1 flex items-center justify-center text-text-muted">
            <div className="text-center">
              <Route className="w-16 h-16 mx-auto mb-4 opacity-20" />
              <p className="text-lg font-medium">{t('history.selectTrip')}</p>
              <p className="text-sm mt-1">{t('history.selectTripHint')}</p>
            </div>
          </div>
        )}

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-base/60 backdrop-blur-sm z-50">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
    </div>
  )
}

import L from 'leaflet'
