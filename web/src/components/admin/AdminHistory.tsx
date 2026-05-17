import { useState, useEffect, useRef, useMemo } from 'react'
import { motion } from 'framer-motion'
import { MapContainer, TileLayer, Polyline, useMap } from 'react-leaflet'
import { supabase } from '@/lib/supabase'
import api from '@/lib/api'
import { ElevationChart } from '@/components/charts/ElevationChart'
import { SpeedChart } from '@/components/charts/SpeedChart'
import {
  Play, Pause, SkipBack,
  Route, Gauge, Clock, AlertTriangle, TrendingUp,
  CornerDownLeft, RotateCcw, CalendarDays, CalendarX, X, Trash2, Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { format, parseISO, addDays } from 'date-fns'
import { es } from 'date-fns/locale'
import L from 'leaflet'

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
const BASE_MS = 250

function RoutePlayback({ points }: { points: RoutePoint[] }) {
  const map = useMap()
  const [playhead, setPlayhead] = useState(0)
  const [playing, setPlaying]   = useState(false)
  const [speed, setSpeed]       = useState<Speed>(1)
  const intervalRef = useRef<number>()
  const markerRef   = useRef<any>(null)

  useEffect(() => {
    if (!points.length) return
    const latlngs: [number, number][] = points.map(p => [p.lat, p.lng])
    map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40] })
  }, [points, map])

  useEffect(() => {
    if (!playing) return
    intervalRef.current = window.setInterval(() => {
      setPlayhead(prev => {
        if (prev >= points.length - 1) { setPlaying(false); return prev }
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
      radius: 8, fillColor: '#00D632', color: '#fff', fillOpacity: 1, weight: 2,
    }).addTo(map)
  }, [playhead, points, map])

  const segments: { points: [number, number][]; color: string }[] = []
  for (let i = 0; i < Math.min(playhead + 1, points.length - 1); i++) {
    const p = points[i]
    segments.push({
      points: [[p.lat, p.lng], [points[i + 1].lat, points[i + 1].lng]],
      color: BAND_COLORS[p.speed_band] ?? '#64748B',
    })
  }
  const fullRoute: [number, number][] = points.map(p => [p.lat, p.lng])

  return (
    <>
      <Polyline positions={fullRoute} pathOptions={{ color: '#252540', weight: 2, opacity: 0.5 }} />
      {segments.map((seg, i) => (
        <Polyline key={i} positions={seg.points} pathOptions={{ color: seg.color, weight: 4, opacity: 0.9 }} />
      ))}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1000] bg-surface/95 backdrop-blur-sm border border-border-soft rounded-2xl px-4 py-3 shadow-xl flex items-center gap-3">
        <button onClick={() => { setPlayhead(0); setPlaying(false) }}
          className="p-1.5 rounded-lg hover:bg-surface-raised text-text-secondary hover:text-text-primary transition-colors">
          <SkipBack className="w-4 h-4" />
        </button>
        <button onClick={() => setPlaying(!playing)}
          className="p-2 bg-primary rounded-lg hover:bg-primary-hover transition-colors shadow-lg shadow-primary/30">
          {playing ? <Pause className="w-4 h-4 text-white" /> : <Play className="w-4 h-4 text-white" />}
        </button>
        <span className="font-mono text-xs text-text-secondary min-w-[4.5rem]">
          {points[playhead] ? format(parseISO(points[playhead].ts), 'hh:mm:ss a') : '--:--:--'}
        </span>
        <input type="range" min={0} max={points.length - 1} value={playhead}
          onChange={e => { setPlaying(false); setPlayhead(Number(e.target.value)) }}
          className="w-32 accent-primary" />
        <div className="flex items-center gap-1 border-l border-border-soft pl-3">
          {SPEEDS.map(s => (
            <button key={s} onClick={() => setSpeed(s)}
              className={cn(
                'px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold transition-colors',
                speed === s ? 'bg-primary text-white' : 'text-text-muted hover:text-text-secondary hover:bg-surface-raised'
              )}>
              {s}x
            </button>
          ))}
        </div>
      </div>
    </>
  )
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a = Math.sin(dLat / 2) ** 2 +
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

export function AdminHistory() {
  const [technicians, setTechnicians] = useState<any[]>([])
  const [selectedTech, setSelectedTech] = useState<string>('')
  const [dateFilter, setDateFilter]     = useState<DateFilter>('today')
  const [customDate, setCustomDate]     = useState<string>('')
  const [trips, setTrips]               = useState<Trip[]>([])
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null)
  const [routePoints, setRoutePoints]   = useState<RoutePoint[]>([])
  const [elevData, setElevData]         = useState<any[]>([])
  const [loading, setLoading]           = useState(false)
  const [deletingId, setDeletingId]     = useState<string | null>(null)

  const todayStr = format(new Date(), 'yyyy-MM-dd')

  const liveRouteStats = useMemo(() => {
    if (!routePoints.length) return null
    const totalKm = routePoints.reduce((sum, p, i) => {
      if (i === 0) return 0
      return sum + haversineKm(routePoints[i - 1].lat, routePoints[i - 1].lng, p.lat, p.lng)
    }, 0)
    return {
      totalKm,
      maxSpeed: Math.max(...routePoints.map(p => p.speed_kmh)),
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

  const deleteTrip = async (trip: Trip) => {
    const label = format(parseISO(trip.started_at), "d MMM, h:mm a", { locale: es })
    if (!window.confirm(`¿Eliminar el viaje del ${label}? Esta acción no se puede deshacer.`)) return
    setDeletingId(trip.id)
    try {
      await supabase.from('trips').delete().eq('id', trip.id)
      setTrips(prev => prev.filter(t => t.id !== trip.id))
      if (selectedTrip?.id === trip.id) {
        setSelectedTrip(null)
        setRoutePoints([])
        setElevData([])
      }
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="flex rounded-2xl overflow-hidden border border-border-soft bg-surface" style={{ height: 'calc(100vh - 180px)' }}>
      {/* Panel izquierdo */}
      <div className="w-72 flex-shrink-0 flex flex-col border-r border-border-soft">
        <div className="p-4 space-y-3 border-b border-border-soft">
          <div>
            <label className="block text-xs text-text-muted mb-1">Técnico</label>
            <select value={selectedTech} onChange={e => setSelectedTech(e.target.value)}
              className="w-full bg-surface-raised border border-border rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary">
              <option value="">Seleccionar técnico...</option>
              {technicians.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          <div className="flex gap-1.5">
            <button onClick={() => { setDateFilter('today'); setCustomDate('') }}
              className={cn(
                'flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors',
                dateFilter === 'today'
                  ? 'bg-primary/15 text-primary border border-primary/30'
                  : 'text-text-muted hover:text-text-secondary hover:bg-surface-raised border border-transparent'
              )}>
              <Clock className="w-3 h-3" /> Hoy
            </button>
            <button onClick={() => { setDateFilter('expired'); setCustomDate('') }}
              className={cn(
                'flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors',
                dateFilter === 'expired'
                  ? 'bg-warning/15 text-warning border border-warning/30'
                  : 'text-text-muted hover:text-text-secondary hover:bg-surface-raised border border-transparent'
              )}>
              <CalendarX className="w-3 h-3" /> Anteriores
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <CalendarDays className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
            <input type="date" value={customDate} max={todayStr}
              onChange={e => {
                setCustomDate(e.target.value)
                if (e.target.value) setDateFilter('custom')
                else setDateFilter('today')
              }}
              className={cn(
                'flex-1 bg-surface-raised border rounded-lg px-2 py-1 text-xs text-text-primary',
                'focus:outline-none focus:ring-1 focus:ring-primary/50 transition-colors',
                dateFilter === 'custom' ? 'border-primary/40 bg-primary/5' : 'border-border'
              )} />
            {dateFilter === 'custom' && customDate && (
              <button onClick={() => { setCustomDate(''); setDateFilter('today') }}
                className="text-text-muted hover:text-text-primary transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="text-xs text-text-muted flex items-center gap-1">
            <span>Mostrando:</span>
            <span className={cn(
              'font-medium',
              dateFilter === 'today'   && 'text-primary',
              dateFilter === 'expired' && 'text-warning',
              dateFilter === 'custom'  && 'text-text-secondary',
            )}>
              {dateFilter === 'today'   && `hoy (${format(new Date(), "d MMM", { locale: es })})`}
              {dateFilter === 'expired' && 'últimos 30 días'}
              {dateFilter === 'custom'  && customDate && format(new Date(customDate + 'T00:00:00'), "d 'de' MMMM yyyy", { locale: es })}
            </span>
            {trips.length > 0 && <span className="ml-auto">{trips.length} viajes</span>}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {trips.map(trip => {
            const inProgress = trip.status !== 'completed'
            const durationLabel = trip.duration_min != null
              ? `${trip.duration_min} min`
              : inProgress
                ? `${Math.round((Date.now() - new Date(trip.started_at).getTime()) / 60_000)} min`
                : '—'
            return (
              <motion.div key={trip.id}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  'p-3 rounded-xl border transition-all group relative',
                  selectedTrip?.id === trip.id
                    ? 'bg-primary/10 border-primary/30'
                    : inProgress
                      ? 'bg-success/5 border-success/20 hover:border-success/40'
                      : 'bg-surface-raised border-border-soft hover:border-border'
                )}>
                <div className="flex items-start gap-2">
                  <button onClick={() => loadTripDetail(trip)} className="flex-1 min-w-0 text-left">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-medium text-text-primary">
                        {format(parseISO(trip.started_at), "d MMM, h:mm a", { locale: es })}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {inProgress && (
                          <span className="flex items-center gap-1 text-xs text-success font-medium">
                            <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" /> En curso
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
                  </button>
                  <button
                    onClick={() => deleteTrip(trip)}
                    disabled={deletingId === trip.id}
                    title="Eliminar viaje"
                    className="p-1 rounded-lg text-text-muted hover:text-danger hover:bg-danger/10 transition-colors disabled:opacity-40 flex-shrink-0 opacity-0 group-hover:opacity-100"
                  >
                    {deletingId === trip.id
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Trash2 className="w-3.5 h-3.5" />
                    }
                  </button>
                </div>
              </motion.div>
            )
          })}
          {trips.length === 0 && !loading && selectedTech && (
            <div className="text-center text-text-muted text-sm py-8">
              No se encontraron viajes en este rango
            </div>
          )}
          {!selectedTech && (
            <div className="text-center text-text-muted text-sm py-8">
              Selecciona un técnico para ver sus viajes
            </div>
          )}
        </div>
      </div>

      {/* Panel derecho */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {selectedTrip && (
          <>
            <div className="p-4 border-b border-border-soft bg-surface">
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                  {selectedTrip.status !== 'completed' ? 'Viaje en curso' : 'Análisis del Viaje'} — {format(parseISO(selectedTrip.started_at), "d MMMM yyyy, h:mm a", { locale: es })}
                </h2>
                {selectedTrip.status !== 'completed' && (
                  <span className="flex items-center gap-1 text-xs text-success font-medium">
                    <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" /> En curso
                  </span>
                )}
              </div>
              {(() => {
                const inProgress = selectedTrip.status !== 'completed'
                const distKm  = inProgress && liveRouteStats ? liveRouteStats.totalKm.toFixed(2) : (selectedTrip.distance_km?.toFixed(2) ?? '—')
                const maxSpd  = inProgress && liveRouteStats ? liveRouteStats.maxSpeed.toFixed(0) : (selectedTrip.max_speed_kmh?.toFixed(0) ?? '—')
                const avgSpd  = inProgress && liveRouteStats ? liveRouteStats.avgSpeed.toFixed(0) : (selectedTrip.avg_speed_kmh?.toFixed(0) ?? '—')
                const durLabel = selectedTrip.duration_min != null
                  ? `${selectedTrip.duration_min} min`
                  : `${Math.round((Date.now() - new Date(selectedTrip.started_at).getTime()) / 60_000)} min`
                return (
                  <div className="grid grid-cols-4 lg:grid-cols-8 gap-2">
                    <StatBadge icon={Route}          value={distKm + ' km'}   label="Distancia"     color="text-primary" />
                    <StatBadge icon={Clock}          value={durLabel}          label="Duración"      color="text-text-secondary" />
                    <StatBadge icon={TrendingUp}     value={maxSpd + ' km/h'} label="Vel. máx"      color="text-danger" />
                    <StatBadge icon={Gauge}          value={avgSpd + ' km/h'} label="Vel. prom"     color="text-warning" />
                    <StatBadge icon={AlertTriangle}  value={selectedTrip.accidents}    label="Accidentes"    color={selectedTrip.accidents > 0 ? 'text-danger' : 'text-text-muted'} />
                    <StatBadge icon={CornerDownLeft} value={selectedTrip.hard_brakes}  label="Frenadas"      color={selectedTrip.hard_brakes > 0 ? 'text-warning' : 'text-text-muted'} />
                    <StatBadge icon={TrendingUp}     value={selectedTrip.rapid_accels} label="Aceleraciones" color={selectedTrip.rapid_accels > 0 ? 'text-warning' : 'text-text-muted'} />
                    <StatBadge icon={RotateCcw}      value={selectedTrip.harsh_turns}  label="Giros bruscos" color="text-text-muted" />
                  </div>
                )
              })()}
            </div>
            <div className="flex-1 flex overflow-hidden">
              <div className="flex-1 relative">
                <MapContainer center={[14.0723, -87.2061]} zoom={12}
                  style={{ height: '100%', width: '100%' }}
                  zoomControl={false} attributionControl={false}>
                  <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
                  {routePoints.length > 0 && <RoutePlayback points={routePoints} />}
                </MapContainer>
              </div>
              <div className="w-64 flex-shrink-0 flex flex-col border-l border-border-soft bg-surface overflow-y-auto p-4 space-y-4">
                <div>
                  <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Elevación</h4>
                  <ElevationChart data={elevData} />
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Velocidad</h4>
                  <SpeedChart data={routePoints.map(p => ({ ts: p.ts, speed_kmh: p.speed_kmh, speed_band: p.speed_band }))} />
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Leyenda</h4>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-center gap-2"><div className="w-6 h-2 rounded bg-success" /><span className="text-text-muted">Baja (&lt;30 km/h)</span></div>
                    <div className="flex items-center gap-2"><div className="w-6 h-2 rounded bg-warning" /><span className="text-text-muted">Media (30-60 km/h)</span></div>
                    <div className="flex items-center gap-2"><div className="w-6 h-2 rounded bg-danger" /><span className="text-text-muted">Alta (&gt;60 km/h)</span></div>
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
              <p className="text-lg font-medium">Selecciona un viaje</p>
              <p className="text-sm mt-1">para ver el análisis completo</p>
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
