import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTrackingStore, TechnicianState } from '@/store/trackingStore'
import { useZonesStore } from '@/store/zonesStore'
import { getZonesForPoint } from '@/lib/geoUtils'
import { Battery, MapPin, ChevronRight, UserPlus, QrCode } from 'lucide-react'
import { cn } from '@/lib/utils'
import { QrCodeModal } from '@/components/modals/QrCodeModal'
import { OnboardingWizard } from '@/components/admin/OnboardingWizard'
import { TechnicianRegistrationModal } from '@/components/modals/TechnicianRegistrationModal'
import { StatusLegend } from '@/components/ui/StatusLegend'
import { describeStatus, type StatusDescriptor } from '@/lib/technicianStatus'
import { useI18n, getDateLocale } from '@/lib/i18n/i18n'

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
  /** Color + etiqueta + motivo, ya resueltos por la lista (mismo criterio que el contador). */
  st: StatusDescriptor
  onQrClick: (tech: TechnicianState) => void
}

function TechnicianRow({ tech, st, onQrClick }: TechnicianRowProps) {
  const { t } = useI18n()
  const { selectTechnician, selectedTechnicianId } = useTrackingStore()
  const { zones } = useZonesStore()
  const isSelected  = selectedTechnicianId === tech.id
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
            st.dot, st.pulse && 'animate-pulse'
          )} />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span className="font-semibold text-text-primary text-sm truncate">{tech.name}</span>
            <BatteryIndicator level={tech.battery} />
          </div>
          <span className={cn('text-xs font-medium', st.text)}>{st.label}</span>
          {/* El motivo SIEMPRE visible: sin esto el color es una adivinanza. */}
          <p className="text-xs text-text-muted leading-tight mt-0.5">{st.reason}</p>
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
          title={t('tech.generateQr')}
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
  // 'admin'  → asistente clientes/proyectos (OnboardingWizard, ve todo)
  // 'leader' → alta de técnico acotada a las empresas del líder
  variant?: 'admin' | 'leader'
}

export function TechnicianList({ className, variant = 'admin' }: TechnicianListProps) {
  const { t, lang } = useI18n()
  const { technicians } = useTrackingStore()
  const techList = Object.values(technicians)

  const [wizardOpen, setWizardOpen]         = useState(false)
  const [qrModalOpen, setQrModalOpen]       = useState(false)
  const [selectedForQr, setSelectedForQr]   = useState<{ id: string; name: string } | undefined>()

  function openQrForTech(tech: TechnicianState) {
    setSelectedForQr({ id: tech.id, name: tech.name })
    setQrModalOpen(true)
  }

  // Descriptor por técnico, calculado una vez: ordena y cuenta con el MISMO
  // criterio con el que se pinta cada fila, así el contador nunca contradice a
  // los puntos de color que el líder tiene debajo.
  const described = techList.map((tech) => ({
    tech,
    st: describeStatus(t, { ...tech, hasDevice: !!tech.deviceId }, getDateLocale(lang)),
  }))

  // Lo que exige acción va primero: accidente → sin conexión → sin señal → ok.
  const sortedTechs = [...described].sort((a, b) => a.st.order - b.st.order)

  // Los contadores son los mismos 3 tonos del semáforo, no categorías inventadas.
  const counts = {
    ok:   described.filter((d) => d.st.tone === 'ok').length,
    warn: described.filter((d) => d.st.tone === 'warn').length,
    down: described.filter((d) => d.st.tone === 'down').length,
  }

  return (
    <>
      <div className={cn('flex flex-col h-full', className)}>
        {/* Header */}
        <div className="px-4 py-3 border-b border-border-soft">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-bold text-text-primary text-sm">{t('dashboard.technicians')}</h2>
            <button
              onClick={() => setWizardOpen(true)}
              title={t('tech.addTechnician')}
              className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 bg-primary/10 hover:bg-primary/20 rounded-lg px-2 py-1 transition-colors"
            >
              <UserPlus className="w-3.5 h-3.5" />
              {t('common.new')}
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-success/10 rounded-lg px-2 py-1.5 text-center">
              <div className="text-success font-mono font-bold text-lg">{counts.ok}</div>
              <div className="text-success/70 text-xs">{t('techStatus.count.ok')}</div>
            </div>
            <div className="bg-warning/10 rounded-lg px-2 py-1.5 text-center">
              <div className={cn('font-mono font-bold text-lg', counts.warn > 0 ? 'text-warning' : 'text-text-muted')}>{counts.warn}</div>
              <div className="text-warning/70 text-xs">{t('techStatus.count.warn')}</div>
            </div>
            <div className="bg-danger/10 rounded-lg px-2 py-1.5 text-center">
              <div className={cn('font-mono font-bold text-lg', counts.down > 0 ? 'text-danger' : 'text-text-muted')}>
                {counts.down}
              </div>
              <div className="text-danger/70 text-xs">{t('techStatus.count.down')}</div>
            </div>
          </div>
        </div>

        {/* Leyenda: la referencia de qué significa cada color, siempre a mano. */}
        <div className="px-3 pt-3">
          <StatusLegend />
        </div>

        {/* Lista — `min-h-0` para que scrollee dentro del panel flex. */}
        <div className="flex-1 min-h-0 scroll-y p-3 space-y-2">
          {sortedTechs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-text-muted gap-2">
              <MapPin className="w-8 h-8 opacity-30" />
              <span className="text-sm">{t('tech.noneRegistered')}</span>
              <button
                onClick={() => setWizardOpen(true)}
                className="text-xs text-primary hover:underline"
              >
                {t('tech.addFirst')}
              </button>
            </div>
          ) : (
            <AnimatePresence>
              {sortedTechs.map(({ tech, st }) => (
                <TechnicianRow key={tech.id} tech={tech} st={st} onQrClick={openQrForTech} />
              ))}
            </AnimatePresence>
          )}
        </div>
      </div>

      {variant === 'leader' ? (
        <TechnicianRegistrationModal
          open={wizardOpen}
          onOpenChange={setWizardOpen}
        />
      ) : (
        <OnboardingWizard
          open={wizardOpen}
          onOpenChange={setWizardOpen}
          onComplete={() => {}}
        />
      )}
      {qrModalOpen && selectedForQr && (
        <QrCodeModal tech={selectedForQr} onClose={() => setQrModalOpen(false)} />
      )}
    </>
  )
}
