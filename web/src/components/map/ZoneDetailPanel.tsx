import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  X, MapPin, Calendar, Users, ArrowUpRight, ArrowDownLeft,
  Ruler, Clock, Smartphone,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTrackingStore } from '@/store/trackingStore'
import { pointInPolygon } from '@/lib/geoUtils'
import { reverseGeocode } from '@/lib/geocoding'
import { cn } from '@/lib/utils'
import type { Zone } from '@/types/zones'
import { ZONE_TYPE_LABEL_KEYS } from '@/types/zones'
import { format, parseISO, formatDistanceToNow } from 'date-fns'
import { useI18n, getDateLocale } from '@/lib/i18n/i18n'

interface ZoneEvent {
  id:             string
  technicianName: string
  eventType:      'enter' | 'exit'
  ts:             string
}

function centroid(coords: [number, number][]): [number, number] {
  if (!coords.length) return [0, 0]
  return [
    coords.reduce((s, c) => s + c[0], 0) / coords.length,
    coords.reduce((s, c) => s + c[1], 0) / coords.length,
  ]
}

function areaKm2(coords: [number, number][]): number {
  if (coords.length < 3) return 0
  const R = 6371
  let area = 0
  const n = coords.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const lat1 = (coords[i][0] * Math.PI) / 180
    const lat2 = (coords[j][0] * Math.PI) / 180
    const lng1 = (coords[i][1] * Math.PI) / 180
    const lng2 = (coords[j][1] * Math.PI) / 180
    area += (lng2 - lng1) * (2 + Math.sin(lat1) + Math.sin(lat2))
  }
  return Math.abs((area * R * R) / 2)
}

const STATUS_DOT: Record<string, string> = {
  moving:   'bg-success animate-pulse',
  idle:     'bg-success',
  stopped:  'bg-text-muted',
  offline:  'bg-danger',
  accident: 'bg-danger animate-pulse',
}
const STATUS_LABEL_KEY: Record<string, string> = {
  moving:   'status.moving',
  idle:     'status.idle',
  stopped:  'zone.statusStopped',
  offline:  'status.offline',
  accident: 'zone.statusAccident',
}

interface Props {
  zone:       Zone
  onClose:    () => void
  className?: string
  actions?:   React.ReactNode
}

export function ZoneDetailPanel({ zone, onClose, className, actions }: Props) {
  const { t, lang } = useI18n()
  const technicians    = useTrackingStore(s => Object.values(s.technicians))
  const [address, setAddress]             = useState<string | null>(null)
  const [addressLoading, setAddressLoading] = useState(true)
  const [events, setEvents]               = useState<ZoneEvent[]>([])
  const [eventsLoading, setEventsLoading] = useState(true)

  const techsInside = technicians.filter(
    tech => tech.lat != null && tech.lng != null && tech.status !== 'offline' &&
    pointInPolygon(tech.lat!, tech.lng!, zone.coordinates)
  )

  const [cLat, cLng] = centroid(zone.coordinates)
  const area = areaKm2(zone.coordinates)

  // Reverse geocode the zone centroid
  useEffect(() => {
    let cancelled = false
    setAddressLoading(true)
    setAddress(null)
    async function load() {
      try {
        const result = await reverseGeocode(cLat, cLng)
        if (cancelled) return
        if (result) {
          const parts = [result.city, result.country].filter(Boolean)
          setAddress(parts.join(', ') || result.displayName.split(',').slice(0, 2).join(','))
        }
      } catch { /* silent */ }
      finally { if (!cancelled) setAddressLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [zone.id])

  // Load recent zone events
  useEffect(() => {
    let cancelled = false
    setEventsLoading(true)
    async function load() {
      try {
        const { data } = await supabase
          .from('zone_events')
          .select('id, event_type, ts, technicians(name)')
          .eq('zone_id', zone.id)
          .order('ts', { ascending: false })
          .limit(5)
        if (cancelled) return
        setEvents(
          (data ?? []).map((row: any) => ({
            id:             row.id,
            technicianName: row.technicians?.name ?? t('common.technician'),
            eventType:      row.event_type as 'enter' | 'exit',
            ts:             row.ts,
          }))
        )
      } catch { /* silent */ }
      finally { if (!cancelled) setEventsLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [zone.id])

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.97 }}
      transition={{ duration: 0.18 }}
      className={cn(
        'bg-surface/96 backdrop-blur-md border border-border-soft rounded-2xl shadow-2xl overflow-hidden w-72',
        className,
      )}
    >
      {/* ── Header ── */}
      <div className="flex items-start gap-2.5 px-4 pt-3.5 pb-3 border-b border-border-soft">
        <div
          className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1.5"
          style={{ background: zone.color, boxShadow: `0 0 8px ${zone.color}70` }}
        />
        <div className="flex-1 min-w-0">
          <p className="font-bold text-text-primary text-sm leading-snug truncate pr-1">{zone.name}</p>
          <span
            className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md mt-0.5 inline-block"
            style={{ background: zone.color + '22', color: zone.color }}
          >
            {t(ZONE_TYPE_LABEL_KEYS[zone.type])}
          </span>
          {zone.description && (
            <p className="text-xs text-text-muted mt-1 leading-relaxed line-clamp-2">{zone.description}</p>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-text-muted hover:text-text-primary transition-colors p-1 rounded-lg hover:bg-surface-raised flex-shrink-0 -mt-0.5 -mr-1"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ── Dirección ── */}
      <div className="px-4 py-2.5 border-b border-border-soft flex items-center gap-2 min-h-[36px]">
        <MapPin className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
        {addressLoading ? (
          <div className="h-3 bg-surface-raised rounded w-36 animate-pulse" />
        ) : address ? (
          <p className="text-xs text-text-secondary leading-relaxed flex-1">{address}</p>
        ) : (
          <p className="text-xs text-text-muted/50 flex-1">{t('zone.addressUnavailable')}</p>
        )}
        {area > 0.0001 && (
          <span className="text-[10px] text-text-muted flex items-center gap-1 flex-shrink-0 ml-1">
            <Ruler className="w-2.5 h-2.5" />
            {area < 1
              ? `${(area * 1_000_000).toFixed(0)} m²`
              : `${area.toFixed(2)} km²`}
          </span>
        )}
      </div>

      {/* ── Técnicos en la zona ── */}
      <div className="px-4 py-2.5 border-b border-border-soft">
        <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <Users className="w-3 h-3" />
          {t('zone.techsInZone')}
          <span
            className={cn(
              'ml-1 text-xs font-bold px-1.5 py-0.5 rounded-full',
              techsInside.length > 0
                ? 'bg-success/15 text-success'
                : 'bg-surface-raised text-text-muted',
            )}
          >
            {techsInside.length}
          </span>
        </p>
        {techsInside.length === 0 ? (
          <p className="text-xs text-text-muted/60">{t('zone.noTechsInZone')}</p>
        ) : (
          <div className="space-y-1.5">
            {techsInside.map(tech => (
              <div key={tech.id} className="flex items-center gap-2 bg-base/50 rounded-lg px-2.5 py-1.5">
                <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', STATUS_DOT[tech.status] ?? 'bg-text-muted')} />
                <span className="text-xs text-text-primary font-medium truncate flex-1">{tech.name}</span>
                <span className={cn(
                  'text-[10px] flex-shrink-0',
                  tech.status === 'moving' || tech.status === 'idle' ? 'text-success' : 'text-text-muted',
                )}>
                  {t(STATUS_LABEL_KEY[tech.status] ?? 'status.offline')}
                </span>
                {tech.lastSpeed != null && tech.lastSpeed > 0.5 && (
                  <span className="text-[10px] text-warning font-mono flex-shrink-0 ml-1">
                    {(tech.lastSpeed * 3.6).toFixed(0)} km/h
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Actividad reciente ── */}
      <div className="px-4 py-2.5 border-b border-border-soft">
        <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <Clock className="w-3 h-3" />
          {t('zone.recentActivity')}
        </p>
        {eventsLoading ? (
          <div className="space-y-1.5">
            {[1, 2].map(i => <div key={i} className="h-3 bg-surface-raised rounded animate-pulse" />)}
          </div>
        ) : events.length === 0 ? (
          <p className="text-xs text-text-muted/60">{t('zone.noEvents')}</p>
        ) : (
          <div className="space-y-1.5">
            {events.map(ev => (
              <div key={ev.id} className="flex items-center gap-2">
                {ev.eventType === 'enter'
                  ? <ArrowUpRight className="w-3.5 h-3.5 text-success flex-shrink-0" />
                  : <ArrowDownLeft className="w-3.5 h-3.5 text-warning flex-shrink-0" />}
                <span className="text-xs text-text-secondary flex-1 truncate">{ev.technicianName}</span>
                <span className={cn(
                  'text-[10px] flex-shrink-0 font-medium',
                  ev.eventType === 'enter' ? 'text-success' : 'text-warning',
                )}>
                  {ev.eventType === 'enter' ? t('zone.entered') : t('zone.exited')}
                </span>
                <span className="text-[10px] text-text-muted/60 flex-shrink-0 ml-0.5">
                  {formatDistanceToNow(parseISO(ev.ts), { addSuffix: true, locale: getDateLocale(lang) })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="px-4 py-2 flex items-center gap-2 bg-base/20">
        <Calendar className="w-3 h-3 text-text-muted flex-shrink-0" />
        <p className="text-[10px] text-text-muted">
          {t('zone.createdOn', { date: format(parseISO(zone.createdAt), "d 'de' MMMM yyyy", { locale: getDateLocale(lang) }) })}
        </p>
        {zone.companyId && (
          <span className="ml-auto flex items-center gap-1 text-[10px] text-text-muted/60">
            <Smartphone className="w-2.5 h-2.5" />
            {t('zone.company')}
          </span>
        )}
      </div>

      {/* ── Acciones opcionales (edit/delete para Zonas page) ── */}
      {actions && (
        <div className="px-3 pb-3 pt-1 flex items-center gap-2 border-t border-border-soft">
          {actions}
        </div>
      )}
    </motion.div>
  )
}
