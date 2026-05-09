import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTrackingStore, TechnicianState, TechnicianStatus } from '@/store/trackingStore'
import { useZonesStore } from '@/store/zonesStore'
import { getZonesForPoint } from '@/lib/geoUtils'
import { Battery, MapPin, Wifi, WifiOff, AlertTriangle, ChevronRight, UserPlus, QrCode } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { TechnicianRegistrationModal } from '@/components/modals/TechnicianRegistrationModal'

const STATUS_LABELS: Record<TechnicianStatus, string> = {
  moving:   'En movimiento',
  idle:     'Activo',
  stopped:  'Sin rastreo',
  offline:  'Desconectado',
  accident: 'ACCIDENTE',
}

const STATUS_COLORS: Record<TechnicianStatus, string> = {
  moving:   'text-success',
  idle:     'text-warning',
  stopped:  'text-warning/60',
  offline:  'text-text-muted',
  accident: 'text-danger animate-pulse',
}

const STATUS_DOT: Record<TechnicianStatus, string> = {
  moving:   'bg-success',
  idle:     'bg-warning',
  stopped:  'bg-warning/50',
  offline:  'bg-surface-raised',
  accident: 'bg-danger animate-pulse',
}

function BatteryIndicator({ level }: { level?: number }) {
  if (level == null) return <span className="text-text-muted text-xs">--</span>
  const color = level > 50 ? 'text-success' : level > 20 ? 'text-warning' : 'text-danger'
  return (
    <span className={cn('flex items-center gap-1 text-xs font-mono', color)}>
      <Battery className="w-3 h-3" />
      {level}%
    </span>
  )
}

interface TechnicianRowProps {
  tech: TechnicianState
  onQrClick: (tech: TechnicianState) => void
}

function TechnicianRow({ tech, onQrClick }: TechnicianRowProps) {
  const { selectTechnician, selectedTechnicianId } = useTrackingStore()
  const { zones } = useZonesStore()
  const isSelected  = selectedTechnicianId === tech.id
  const speedKmh    = tech.lastSpeed ? Math.round(tech.lastSpeed * 3.6) : 0
  const lastSeen    = tech.lastSeen
    ? formatDistanceToNow(new Date(tech.lastSeen), { addSuffix: true, locale: es })
    : 'Sin datos'
  const noDevice    = !tech.deviceId

  const currentZones = tech.lat && tech.lng
    ? getZonesForPoint(tech.lat, tech.lng, zones)
    : []

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -10 }}
      className={cn(
        'flex items-center gap-3 p-3 rounded-xl border transition-all',
        'hover:bg-surface-raised',
        isSelected
          ? 'bg-primary/10 border-primary/30'
          : 'bg-surface border-border-soft'
      )}
    >
      {/* Clickable area */}
      <div
        className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
        onClick={() => selectTechnician(isSelected ? null : tech.id)}
      >
        {/* Avatar + status dot */}
        <div className="relative flex-shrink-0">
          <div className="w-10 h-10 rounded-full flex items-center justify-center bg-surface-raised">
            <span className="text-sm font-bold text-text-primary">
              {tech.name.charAt(0).toUpperCase()}
            </span>
          </div>
          <span className={cn(
            'absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-base',
            STATUS_DOT[tech.status]
          )} />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span className="font-semibold text-text-primary text-sm truncate">{tech.name}</span>
            <BatteryIndicator level={tech.battery} />
          </div>
          <div className="flex items-center justify-between mt-0.5">
            <span className={cn('text-xs font-medium', STATUS_COLORS[tech.status])}>
              {noDevice
                ? <span className="text-warning">Sin dispositivo</span>
                : <>{STATUS_LABELS[tech.status]}{tech.status === 'moving' && speedKmh > 0 && ` • ${speedKmh} km/h`}</>
              }
            </span>
            <span className="text-xs text-text-muted">{noDevice ? '' : lastSeen}</span>
          </div>
          {currentZones.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {currentZones.map((z) => (
                <span
                  key={z.id}
                  className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-md font-medium"
                  style={{ background: z.color + '20', color: z.color }}
                >
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: z.color }} />
                  {z.name}
                </span>
              ))}
            </div>
          )}
        </div>

        <ChevronRight className={cn(
          'w-4 h-4 flex-shrink-0 transition-colors',
          isSelected ? 'text-primary' : 'text-text-muted'
        )} />
      </div>

      {/* Botón QR para técnicos sin dispositivo */}
      {noDevice && (
        <button
          onClick={(e) => { e.stopPropagation(); onQrClick(tech) }}
          title="Generar QR de registro"
          className="flex-shrink-0 p-2 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
        >
          <QrCode className="w-4 h-4" />
        </button>
      )}
    </motion.div>
  )
}

interface TechnicianListProps {
  className?: string
}

export function TechnicianList({ className }: TechnicianListProps) {
  const { technicians } = useTrackingStore()
  const techList = Object.values(technicians)

  const [modalOpen, setModalOpen]           = useState(false)
  const [selectedForQr, setSelectedForQr]   = useState<{ id: string; name: string } | undefined>()

  function openNewTechModal() {
    setSelectedForQr(undefined)
    setModalOpen(true)
  }

  function openQrForTech(tech: TechnicianState) {
    setSelectedForQr({ id: tech.id, name: tech.name })
    setModalOpen(true)
  }

  const sortedTechs = [...techList].sort((a, b) => {
    const order: Record<TechnicianStatus, number> = {
      accident: 0, moving: 1, idle: 2, stopped: 3, offline: 4,
    }
    return (order[a.status] ?? 5) - (order[b.status] ?? 5)
  })

  const counts = {
    active:   techList.filter((t) => t.status === 'moving' || t.status === 'idle').length,
    inactive: techList.filter((t) => t.status === 'stopped' || t.status === 'offline').length,
    alert:    techList.filter((t) => t.status === 'accident').length,
  }

  return (
    <>
      <div className={cn('flex flex-col h-full', className)}>
        {/* Header */}
        <div className="px-4 py-3 border-b border-border-soft">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-bold text-text-primary text-sm">Técnicos</h2>
            <button
              onClick={openNewTechModal}
              title="Agregar técnico"
              className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 bg-primary/10 hover:bg-primary/20 rounded-lg px-2 py-1 transition-colors"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Nuevo
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-success/10 rounded-lg px-2 py-1.5 text-center">
              <div className="text-success font-mono font-bold text-lg">{counts.active}</div>
              <div className="text-success/70 text-xs">Activos</div>
            </div>
            <div className="bg-text-muted/10 rounded-lg px-2 py-1.5 text-center">
              <div className={cn('font-mono font-bold text-lg', counts.inactive > 0 ? 'text-warning/70' : 'text-text-muted')}>{counts.inactive}</div>
              <div className="text-text-muted/70 text-xs">Sin rastreo</div>
            </div>
            <div className="bg-danger/10 rounded-lg px-2 py-1.5 text-center">
              <div className={cn('font-mono font-bold text-lg', counts.alert > 0 ? 'text-danger animate-pulse' : 'text-text-muted')}>
                {counts.alert}
              </div>
              <div className="text-xs text-text-muted">Alertas</div>
            </div>
          </div>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {sortedTechs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-text-muted gap-2">
              <MapPin className="w-8 h-8 opacity-30" />
              <span className="text-sm">Sin técnicos registrados</span>
              <button
                onClick={openNewTechModal}
                className="text-xs text-primary hover:underline"
              >
                Agregar el primero
              </button>
            </div>
          ) : (
            <AnimatePresence>
              {sortedTechs.map((tech) => (
                <TechnicianRow key={tech.id} tech={tech} onQrClick={openQrForTech} />
              ))}
            </AnimatePresence>
          )}
        </div>
      </div>

      <TechnicianRegistrationModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        existingTechnician={selectedForQr}
      />
    </>
  )
}
