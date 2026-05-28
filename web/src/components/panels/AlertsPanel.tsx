import { useState, forwardRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTrackingStore, MotionAlert, ZoneAlert } from '@/store/trackingStore'
import {
  AlertTriangle, Zap, CornerDownLeft, RotateCcw, Siren, WifiOff, BatteryLow,
  CheckCheck, Eye, BellOff, LogIn, LogOut, Layers, CalendarDays, Clock, CalendarX, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { EnablePushButton } from '@/components/EnablePushButton'
import { formatDistanceToNow, startOfDay, isEqual, isBefore, format } from 'date-fns'
import { es } from 'date-fns/locale'
import { supabase } from '@/lib/supabase'
import { persistZoneAlertAck } from '@/hooks/useZoneEvents'

// ── Alertas de movimiento ──────────────────────────────────────────
const MOTION_CONFIG: Record<string, { icon: any; label: string; color: string; bg: string }> = {
  accident:    { icon: AlertTriangle,  label: 'Accidente',           color: 'text-danger',  bg: 'bg-danger/10 border-danger/30' },
  sos:         { icon: Siren,          label: 'SOS — Emergencia',    color: 'text-danger',  bg: 'bg-danger/10 border-danger/30' },
  hard_brake:  { icon: CornerDownLeft, label: 'Frenada brusca',      color: 'text-warning', bg: 'bg-warning/10 border-warning/30' },
  rapid_accel: { icon: Zap,            label: 'Aceleración rápida',  color: 'text-warning', bg: 'bg-warning/10 border-warning/30' },
  harsh_turn:  { icon: RotateCcw,      label: 'Giro brusco',         color: 'text-primary', bg: 'bg-primary/10 border-primary/30' },
  offline:     { icon: WifiOff,        label: 'Técnico sin señal',   color: 'text-warning', bg: 'bg-warning/10 border-warning/30' },
  battery_low: { icon: BatteryLow,     label: 'Batería baja',        color: 'text-warning', bg: 'bg-warning/10 border-warning/30' },
}

const MotionAlertItem = forwardRef<HTMLDivElement, { alert: MotionAlert }>(({ alert }, ref) => {
  const { acknowledgeAlert } = useTrackingStore()
  const cfg  = MOTION_CONFIG[alert.type] ?? MOTION_CONFIG['hard_brake']
  const Icon = cfg.icon

  const handleAck = async () => {
    acknowledgeAlert(alert.id)
    const { error } = await supabase.from('motion_events').update({ acknowledged: true }).eq('id', alert.id)
    if (error) console.error('[AlertsPanel] Error al marcar motion_event:', error)
  }

  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className={cn(
        'flex items-start gap-2.5 p-2.5 rounded-xl border text-xs',
        alert.acknowledged ? 'opacity-40 border-border-soft bg-surface' : cn(cfg.bg, 'border')
      )}
    >
      <Icon className={cn('w-3.5 h-3.5 mt-0.5 flex-shrink-0', cfg.color)} />
      <div className="flex-1 min-w-0">
        <div className={cn('font-semibold', cfg.color)}>{cfg.label}</div>
        <div className="text-text-secondary truncate">{alert.technicianName}</div>
        <div className="text-text-muted mt-0.5">
          {formatDistanceToNow(new Date(alert.ts), { addSuffix: true, locale: es })}
        </div>
      </div>
      <button
        onClick={handleAck}
        title={alert.acknowledged ? 'Vista' : 'Marcar como vista'}
        className={cn(
          'flex-shrink-0 transition-colors rounded-md p-0.5',
          alert.acknowledged
            ? 'text-text-muted cursor-default'
            : 'text-text-muted hover:text-success hover:bg-success/10'
        )}
        disabled={alert.acknowledged}
      >
        {alert.acknowledged
          ? <Eye className="w-3.5 h-3.5" />
          : <CheckCheck className="w-3.5 h-3.5" />
        }
      </button>
    </motion.div>
  )
})

// ── Alertas de zona ────────────────────────────────────────────────
const ZoneAlertItem = forwardRef<HTMLDivElement, { alert: ZoneAlert }>(({ alert }, ref) => {
  const { acknowledgeZoneAlert } = useTrackingStore()
  const isEnter = alert.eventType === 'enter'

  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className={cn(
        'flex items-start gap-2.5 p-2.5 rounded-xl border text-xs',
        alert.acknowledged
          ? 'opacity-40 border-border-soft bg-surface'
          : 'border'
      )}
      style={
        alert.acknowledged
          ? undefined
          : {
              borderColor: alert.zoneColor + '50',
              background:  alert.zoneColor + '12',
            }
      }
    >
      <div
        className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ background: alert.zoneColor + '25' }}
      >
        {isEnter
          ? <LogIn  className="w-3 h-3" style={{ color: alert.zoneColor }} />
          : <LogOut className="w-3 h-3" style={{ color: alert.zoneColor }} />
        }
      </div>

      <div className="flex-1 min-w-0">
        <div className="font-semibold flex items-center gap-1" style={{ color: alert.zoneColor }}>
          {isEnter ? 'Entró a zona' : 'Salió de zona'}
          <span
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-xs"
            style={{ background: alert.zoneColor + '20', color: alert.zoneColor }}
          >
            <Layers className="w-2.5 h-2.5" />
            {alert.zoneName}
          </span>
        </div>
        <div className="text-text-secondary truncate mt-0.5">{alert.technicianName}</div>
        <div className="text-text-muted mt-0.5">
          {formatDistanceToNow(new Date(alert.ts), { addSuffix: true, locale: es })}
        </div>
      </div>

      <button
        onClick={() => {
          acknowledgeZoneAlert(alert.id)
          persistZoneAlertAck(alert.id).catch((err) =>
            console.error('[AlertsPanel] Error al marcar zone_event:', err)
          )
        }}
        title={alert.acknowledged ? 'Vista' : 'Marcar como vista'}
        className={cn(
          'flex-shrink-0 transition-colors rounded-md p-0.5',
          alert.acknowledged
            ? 'text-text-muted cursor-default'
            : 'text-text-muted hover:text-success hover:bg-success/10'
        )}
        disabled={alert.acknowledged}
      >
        {alert.acknowledged
          ? <Eye className="w-3.5 h-3.5" />
          : <CheckCheck className="w-3.5 h-3.5" />
        }
      </button>
    </motion.div>
  )
})

// ── Panel principal ────────────────────────────────────────────────
type UnifiedAlert =
  | { kind: 'motion'; data: MotionAlert; ts: string }
  | { kind: 'zone';   data: ZoneAlert;   ts: string }

type DateFilter = 'today' | 'expired' | 'custom'

interface AlertsPanelProps {
  className?: string
}

export function AlertsPanel({ className }: AlertsPanelProps) {
  const { alerts, zoneAlerts, acknowledgeAllAlerts } = useTrackingStore()
  const [dateFilter, setDateFilter] = useState<DateFilter>('today')
  const [customDate, setCustomDate] = useState<string>('')

  const today = startOfDay(new Date())

  const matchesDateFilter = (ts: string): boolean => {
    const alertDay = startOfDay(new Date(ts))
    if (dateFilter === 'expired') return isBefore(alertDay, today)
    if (dateFilter === 'custom' && customDate)
      return isEqual(alertDay, startOfDay(new Date(customDate)))
    return isEqual(alertDay, today)
  }

  // Combinar, filtrar por fecha y ordenar por tiempo descendente
  const unified: UnifiedAlert[] = [
    ...alerts.map((a)     => ({ kind: 'motion' as const, data: a, ts: a.ts })),
    ...zoneAlerts.map((a) => ({ kind: 'zone'   as const, data: a, ts: a.ts })),
  ]
    .filter((item) => matchesDateFilter(item.ts))
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    .slice(0, 50)

  const unackedCount =
    alerts.filter((a) => !a.acknowledged).length +
    zoneAlerts.filter((a) => !a.acknowledged).length

  const zoneUnacked   = zoneAlerts.filter((a) => !a.acknowledged).length
  const motionUnacked = alerts.filter((a) => !a.acknowledged).length

  const todayLabel = format(today, "d MMM", { locale: es })

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-border-soft">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-bold text-text-primary text-sm flex items-center gap-2">
            Alertas
            {unackedCount > 0 && (
              <span className="bg-danger text-white text-xs font-bold px-1.5 py-0.5 rounded-full animate-pulse">
                {unackedCount}
              </span>
            )}
          </h2>
          <div className="flex items-center gap-1">
            <EnablePushButton />
            {unackedCount > 0 && (
              <button
                onClick={async () => {
                  const motionIds = alerts.filter((a) => !a.acknowledged).map((a) => a.id)
                  const zoneIds   = zoneAlerts.filter((a) => !a.acknowledged).map((a) => a.id)
                  acknowledgeAllAlerts()
                  if (motionIds.length) {
                    const { error } = await supabase.from('motion_events').update({ acknowledged: true }).in('id', motionIds)
                    if (error) console.error('[AlertsPanel] Error al marcar todas motion_events:', error)
                  }
                  if (zoneIds.length) {
                    const { error } = await supabase.from('zone_events').update({ acknowledged: true }).in('id', zoneIds)
                    if (error) console.error('[AlertsPanel] Error al marcar todas zone_events:', error)
                  }
                }}
                title="Marcar todas como vistas"
                className="flex items-center gap-1 text-xs text-text-muted hover:text-success transition-colors px-1.5 py-1 rounded-lg hover:bg-success/10"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Todas vistas
              </button>
            )}
          </div>
        </div>

        {/* Mini stats */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="bg-danger/10 rounded-lg px-2 py-1.5 text-center">
            <div className={cn('font-mono font-bold text-base', motionUnacked > 0 ? 'text-danger animate-pulse' : 'text-text-muted')}>
              {motionUnacked}
            </div>
            <div className="text-xs text-text-muted">Conducción</div>
          </div>
          <div className="bg-primary/10 rounded-lg px-2 py-1.5 text-center">
            <div className={cn('font-mono font-bold text-base', zoneUnacked > 0 ? 'text-primary' : 'text-text-muted')}>
              {zoneUnacked}
            </div>
            <div className="text-xs text-text-muted">Zonas</div>
          </div>
        </div>

        {/* Filtros rápidos por día */}
        <div className="flex gap-1.5 mb-2">
          <button
            onClick={() => { setDateFilter('today'); setCustomDate('') }}
            className={cn(
              'flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors',
              dateFilter === 'today'
                ? 'bg-primary/15 text-primary border border-primary/30'
                : 'text-text-muted hover:text-text-secondary hover:bg-surface'
            )}
          >
            <Clock className="w-3 h-3" />
            Hoy
          </button>
          <button
            onClick={() => { setDateFilter('expired'); setCustomDate('') }}
            className={cn(
              'flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors',
              dateFilter === 'expired'
                ? 'bg-warning/15 text-warning border border-warning/30'
                : 'text-text-muted hover:text-text-secondary hover:bg-surface'
            )}
          >
            <CalendarX className="w-3 h-3" />
            Vencidos
          </button>
        </div>

        {/* Selector de día específico */}
        <div className="flex items-center gap-1.5">
          <CalendarDays className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
          <input
            type="date"
            value={customDate}
            max={format(new Date(), 'yyyy-MM-dd')}
            onChange={(e) => {
              setCustomDate(e.target.value)
              if (e.target.value) setDateFilter('custom')
              else setDateFilter('today')
            }}
            className={cn(
              'flex-1 bg-surface border rounded-lg px-2 py-1 text-xs text-text-primary',
              'focus:outline-none focus:ring-1 focus:ring-primary/50 transition-colors',
              dateFilter === 'custom'
                ? 'border-primary/40 bg-primary/5'
                : 'border-border-soft'
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
        {true && (
          <div className="mt-1.5 text-xs text-text-muted flex items-center gap-1">
            <span>Mostrando:</span>
            <span className={cn(
              'font-medium',
              dateFilter === 'today'   && 'text-primary',
              dateFilter === 'expired' && 'text-warning',
              dateFilter === 'custom'  && 'text-text-secondary',
            )}>
              {dateFilter === 'today'   && `hoy (${todayLabel})`}
              {dateFilter === 'expired' && 'días anteriores'}
              {dateFilter === 'custom'  && customDate && format(new Date(customDate + 'T00:00:00'), "d 'de' MMMM yyyy", { locale: es })}
            </span>
            <span className="ml-auto text-text-muted">{unified.length} alertas</span>
          </div>
        )}
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {unified.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-text-muted">
            <BellOff className="w-8 h-8 mb-2 opacity-30" />
            <span className="text-sm">
              {dateFilter === 'today'   && 'Sin alertas hoy'}
              {dateFilter === 'expired' && 'Sin alertas vencidas'}
              {dateFilter === 'custom'  && 'Sin alertas en este día'}
            </span>
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            {unified.map((item) =>
              item.kind === 'motion'
                ? <MotionAlertItem key={`m-${item.data.id}`} alert={item.data as MotionAlert} />
                : <ZoneAlertItem   key={`z-${item.data.id}`} alert={item.data as ZoneAlert} />
            )}
          </AnimatePresence>
        )}
      </div>
    </div>
  )
}
