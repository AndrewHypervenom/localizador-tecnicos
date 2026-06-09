import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MapContainer, useMap, Polyline } from 'react-leaflet'
import L from 'leaflet'
import api from '@/lib/api'
import { format } from 'date-fns'
import { Play, Pause, SkipBack } from 'lucide-react'
import { useTrackingStore, TechnicianState } from '@/store/trackingStore'
import { SpeedHeatmap } from './SpeedHeatmap'
import { ZonesLayer } from './ZonesLayer'
import { AssignmentRouteLayer } from './AssignmentRouteLayer'
import { MapBaseLayer } from './MapBaseLayer'

interface RoutePoint {
  ts: string
  lat: number
  lng: number
  speed_kmh: number
  speed_band: 'low' | 'medium' | 'high'
}

const BAND_COLORS: Record<string, string> = {
  low: '#10B981', medium: '#F59E0B', high: '#EF4444',
}

// Fix default icons de Leaflet con Vite
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const STATUS_COLORS: Record<string, string> = {
  moving:    '#10B981',
  idle:      '#F59E0B',
  stopped:   '#64748B',
  no_signal: '#F97316',
  offline:   '#1E1E30',
  accident:  '#EF4444',
}

function createTechMarkerIcon(tech: TechnicianState): L.DivIcon {
  const speedKmh = tech.lastSpeed ? Math.round(tech.lastSpeed * 3.6) : 0
  const speedText = tech.status === 'moving' ? ` • ${speedKmh} km/h` : ''
  const color = STATUS_COLORS[tech.status] ?? '#64748B'

  const html = `
    <div class="tech-marker">
      <div class="tech-marker-dot ${tech.status}" style="background:${color}; transform: rotate(${tech.bearing ?? 0}deg)">
        ${tech.status === 'moving' ? `<div style="
          position:absolute; top:-4px; left:50%; transform:translateX(-50%);
          width:0; height:0; border-left:4px solid transparent;
          border-right:4px solid transparent; border-bottom:6px solid ${color};
        "></div>` : ''}
      </div>
      <div class="tech-marker-label">${tech.name.split(' ')[0]}${speedText}</div>
    </div>
  `

  return L.divIcon({
    html,
    className: 'tech-marker-icon',
    iconSize:  [70, 40],
    iconAnchor:[35, 12],
  })
}

// Invalida el tamaño del mapa cuando el contenedor cambia de dimensiones (e.g. sidebar animado)
function MapSizeInvalidator() {
  const map = useMap()
  useEffect(() => {
    const container = map.getContainer()
    // Coalescer ráfagas de resize (e.g. sidebar animado) en un solo invalidateSize por frame
    let raf = 0
    const observer = new ResizeObserver(() => {
      if (raf) return
      raf = requestAnimationFrame(() => { raf = 0; map.invalidateSize() })
    })
    observer.observe(container)
    map.invalidateSize()
    return () => { if (raf) cancelAnimationFrame(raf); observer.disconnect() }
  }, [map])
  return null
}

// Componente interno que gestiona los marcadores imperativamente
function MarkersLayer() {
  const { technicians, selectedTechnicianId, selectTechnician } = useTrackingStore()
  const map = useMap()
  const markersRef  = useRef<Record<string, L.Marker>>({})
  const prevTechRef = useRef<Record<string, TechnicianState>>({})

  // useLayoutEffect: aplica cambios en Leaflet antes del paint del navegador
  useLayoutEffect(() => {
    const techList = Object.values(technicians)
    const prev = prevTechRef.current

    techList.forEach((tech) => {
      if (!tech.lat || !tech.lng) return

      const latlng: L.LatLngExpression = [tech.lat, tech.lng]
      const existing = markersRef.current[tech.id]
      const prevTech = prev[tech.id]

      if (existing) {
        // Solo actualizar si la posición o estado cambiaron
        const posChanged = prevTech?.lat !== tech.lat || prevTech?.lng !== tech.lng
        const stateChanged = prevTech?.status !== tech.status || prevTech?.bearing !== tech.bearing || prevTech?.lastSpeed !== tech.lastSpeed
        if (posChanged) existing.setLatLng(latlng)
        if (posChanged || stateChanged) existing.setIcon(createTechMarkerIcon(tech))
      } else {
        const icon = createTechMarkerIcon(tech)
        const marker = L.marker(latlng, { icon })
        marker.on('click', () => selectTechnician(tech.id))
        marker.addTo(map)
        markersRef.current[tech.id] = marker
      }
    })

    // Eliminar marcadores de técnicos que ya no existen
    Object.keys(markersRef.current).forEach((id) => {
      if (!technicians[id]) {
        markersRef.current[id].remove()
        delete markersRef.current[id]
      }
    })

    prevTechRef.current = technicians
  }, [technicians, map, selectTechnician])

  // Ref para acceder a technicians sin disparar el efecto en cada actualización de posición
  const techniciansRef = useRef(technicians)
  techniciansRef.current = technicians

  // Fly cuando se selecciona un técnico — o cuando su posición llega por primera vez
  const hasFlownRef = useRef<string | null>(null)

  useEffect(() => {
    if (!selectedTechnicianId) { hasFlownRef.current = null; return }
    const tech = techniciansRef.current[selectedTechnicianId]
    if (tech?.lat && tech?.lng) {
      hasFlownRef.current = selectedTechnicianId
      map.flyTo([tech.lat, tech.lng], 16, { duration: 1.2 })
    }
  }, [selectedTechnicianId, map])

  // Segundo disparo: si el técnico seleccionado aún no tenía posición al seleccionarse
  useLayoutEffect(() => {
    if (!selectedTechnicianId) return
    if (hasFlownRef.current === selectedTechnicianId) return
    const tech = technicians[selectedTechnicianId]
    if (tech?.lat && tech?.lng) {
      hasFlownRef.current = selectedTechnicianId
      map.flyTo([tech.lat, tech.lng], 16, { duration: 1.2 })
    }
  }, [technicians, selectedTechnicianId, map])

  return null
}


// Devuelve solo los puntos de la sesión activa más reciente.
// Si hay un hueco > 5 min entre puntos consecutivos, descarta todo lo anterior.
const SESSION_GAP_S = 300
// ── Descarte de "saltos" GPS ──────────────────────────────────────────────────
// Un fix basura puede caer lejísimos y la polilínea lo une con una recta larga
// (efecto de teletransporte). Descartamos el punto cuando implica una velocidad
// imposible respecto al anterior válido. Umbral alto (150 km/h) para no tocar
// movimiento real, ya sea a pie o en vehículo.
const MAX_PLAUSIBLE_KMH = 150
const MIN_SPIKE_JUMP_M  = 150  // ignora micro-ruido; solo evalúa saltos grandes

function distM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLng = ((bLng - aLng) * Math.PI) / 180
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

function dropSpikes(pts: RoutePoint[]): RoutePoint[] {
  if (pts.length < 2) return pts
  const out: RoutePoint[] = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    const prev = out[out.length - 1]
    const p    = pts[i]
    const dM   = distM(prev.lat, prev.lng, p.lat, p.lng)
    const dt   = (new Date(p.ts).getTime() - new Date(prev.ts).getTime()) / 1000
    if (dt > 0 && dM > MIN_SPIKE_JUMP_M) {
      const kmh = (dM / 1000) / (dt / 3600)
      if (kmh > MAX_PLAUSIBLE_KMH) continue   // punto imposible → descartar
    }
    out.push(p)
  }
  return out
}

function filterCurrentSession(pts: RoutePoint[]): RoutePoint[] {
  if (pts.length < 2) return pts
  let start = 0
  for (let i = pts.length - 1; i > 0; i--) {
    const gap = (new Date(pts[i].ts).getTime() - new Date(pts[i - 1].ts).getTime()) / 1000
    if (gap > SESSION_GAP_S) { start = i; break }
  }
  return pts.slice(start)
}

// Reproductor del recorrido completo del día para el técnico seleccionado
function LiveTrackPlayer({ date }: { date: string }) {
  const { selectedTechnicianId, technicians } = useTrackingStore()
  const map = useMap()
  // Posición en vivo (realtime) del técnico seleccionado: se mueve en cada
  // punto que llega (~3 s), sin esperar al re-fetch del recorrido.
  const liveTech = selectedTechnicianId ? technicians[selectedTechnicianId] : null
  const [points, setPoints] = useState<RoutePoint[]>([])
  const [playhead, setPlayhead] = useState(0)
  const [playing, setPlaying] = useState(false)
  const markerRef = useRef<L.CircleMarker | null>(null)
  const intervalRef = useRef<number>()
  const atEndRef = useRef(true)
  const TODAY = format(new Date(), 'yyyy-MM-dd')
  const isToday = date === TODAY

  useEffect(() => {
    if (!selectedTechnicianId) {
      setPoints([])
      setPlayhead(0)
      setPlaying(false)
      return
    }

    let cancelled = false
    atEndRef.current = true

    async function loadTrack(silent = false) {
      try {
        const res = await api.get<RoutePoint[]>(
          `/api/analytics/technicians/${selectedTechnicianId}/track`,
          { params: { date } }
        )
        if (cancelled) return
        // Solo filtrar sesión activa cuando es hoy (datos en vivo); en todos los
        // casos descartamos saltos GPS antes de dibujar el recorrido.
        const pts = dropSpikes(isToday ? filterCurrentSession(res.data) : res.data)
        setPoints(pts)
        if (!silent || atEndRef.current) {
          const end = Math.max(pts.length - 1, 0)
          setPlayhead(end)
          atEndRef.current = true
          if (!silent && pts.length > 1) {
            map.fitBounds(
              L.latLngBounds(pts.map((p) => [p.lat, p.lng] as [number, number])),
              { padding: [40, 40] }
            )
          }
        }
      } catch (e) {
        console.error(e)
      }
    }

    loadTrack()
    // Solo hacer polling en tiempo real cuando es el día actual
    if (!isToday) return () => { cancelled = true }
    const interval = setInterval(() => loadTrack(true), 10_000)
    return () => { cancelled = true; clearInterval(interval) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTechnicianId, date])

  useEffect(() => {
    if (!playing) return
    intervalRef.current = window.setInterval(() => {
      setPlayhead((prev) => {
        if (prev >= points.length - 1) { setPlaying(false); return prev }
        const next = prev + 1
        atEndRef.current = next >= points.length - 1
        return next
      })
    }, 100)
    return () => clearInterval(intervalRef.current)
  }, [playing, points.length])

  useEffect(() => {
    // En vivo (hoy y sin arrastrar la barra) seguimos la posición de realtime,
    // que llega cada ~3 s; así el punto deja de "saltar" cada 30 s. Al revisar
    // historial o arrastrar el scrubber usamos el punto del recorrido.
    const live = isToday && atEndRef.current && liveTech?.lat != null && liveTech?.lng != null
    const pos: [number, number] | null = live
      ? [liveTech!.lat as number, liveTech!.lng as number]
      : points[playhead]
        ? [points[playhead].lat, points[playhead].lng]
        : null
    if (!pos) return
    if (markerRef.current) map.removeLayer(markerRef.current)
    markerRef.current = L.circleMarker(pos, {
      radius: 8, fillColor: '#00D632', color: '#fff', fillOpacity: 1, weight: 2,
    }).addTo(map)
  }, [playhead, points, map, isToday, liveTech?.lat, liveTech?.lng])

  if (!selectedTechnicianId || points.length === 0) return null

  const segs: { pts: [number, number][]; color: string }[] = []
  for (let i = 0; i < Math.min(playhead + 1, points.length - 1); i++) {
    segs.push({
      pts: [[points[i].lat, points[i].lng], [points[i + 1].lat, points[i + 1].lng]],
      color: BAND_COLORS[points[i].speed_band] ?? '#64748B',
    })
  }

  const cur = points[playhead]
  const timeLabel = cur ? format(new Date(cur.ts), 'hh:mm:ss a') : '--:--:--'

  return (
    <>
      <Polyline
        positions={points.map((p) => [p.lat, p.lng] as [number, number])}
        pathOptions={{ color: '#252540', weight: 2, opacity: 0.5 }}
      />
      {segs.map((s, i) => (
        <Polyline key={i} positions={s.pts} pathOptions={{ color: s.color, weight: 4, opacity: 0.9 }} />
      ))}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1000] bg-surface/95 backdrop-blur-sm border border-border-soft rounded-2xl px-4 py-3 shadow-xl flex items-center gap-3 pointer-events-auto">
        <button
          onClick={() => { setPlayhead(0); atEndRef.current = false; setPlaying(false) }}
          className="p-1.5 rounded-lg hover:bg-surface-raised text-text-secondary hover:text-text-primary transition-colors"
        >
          <SkipBack className="w-4 h-4" />
        </button>
        <button
          onClick={() => setPlaying((p) => !p)}
          className="p-2 bg-primary rounded-lg hover:bg-primary-hover transition-colors shadow-lg shadow-primary/30"
        >
          {playing ? <Pause className="w-4 h-4 text-white" /> : <Play className="w-4 h-4 text-white" />}
        </button>
        <span className="font-mono text-xs text-text-secondary min-w-[4.5rem]">{timeLabel}</span>
        <input
          type="range"
          min={0}
          max={Math.max(points.length - 1, 1)}
          value={playhead}
          onChange={(e) => {
            setPlaying(false)
            const v = Number(e.target.value)
            atEndRef.current = v >= points.length - 1
            setPlayhead(v)
          }}
          className="w-36 accent-primary"
        />
        <span className="text-[10px] text-text-muted whitespace-nowrap">{points.length} pts</span>
      </div>
    </>
  )
}

interface TrackingMapProps {
  className?: string
  date?: string
}

export function TrackingMap({ className, date }: TrackingMapProps) {
  const { showHeatmap } = useTrackingStore()
  const today = format(new Date(), 'yyyy-MM-dd')
  const activeDate = date ?? today

  const defaultCenter: L.LatLngExpression = [4.7110, -74.0721] // Bogotá, Colombia
  const defaultZoom = 12

  return (
    <div className={`relative ${className ?? ''}`}>
      <MapContainer
        center={defaultCenter}
        zoom={defaultZoom}
        style={{ height: '100%', width: '100%' }}
        zoomControl={false}
        attributionControl={false}
      >
        <MapBaseLayer />

        <MapSizeInvalidator />
        <ZonesLayer />
        <AssignmentRouteLayer />
        <MarkersLayer />
        <LiveTrackPlayer date={activeDate} />

        {showHeatmap && <SpeedHeatmap />}
      </MapContainer>
    </div>
  )
}
