import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTrackingStore, STATUS_THRESHOLDS } from '@/store/trackingStore'
import { ElevationChart } from '@/components/charts/ElevationChart'
import { SpeedChart }     from '@/components/charts/SpeedChart'
import { supabase } from '@/lib/supabase'
import api from '@/lib/api'
import { TechnicianEditModal, TechnicianEditable } from '@/components/modals/TechnicianEditModal'
import {
  X, Battery, Gauge, Mountain, Phone,
  Navigation, Timer, Signal,
  Loader2, Edit2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const totalSecs = Math.floor(ms / 1000)
  const h = Math.floor(totalSecs / 3600)
  const m = Math.floor((totalSecs % 3600) / 60)
  const s = totalSecs % 60
  if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m`
  if (m > 0) return `${m}m ${s.toString().padStart(2, '0')}s`
  return `${s}s`
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, unit, color = 'text-primary' }: {
  icon: any; label: string; value: string | number; unit?: string; color?: string
}) {
  return (
    <div className="bg-surface-raised rounded-xl p-3 flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-text-muted">
        <Icon className="w-3.5 h-3.5" />
        <span className="text-xs">{label}</span>
      </div>
      <div className={cn('font-mono font-bold text-xl leading-none', color)}>
        {value}
        {unit && <span className="text-sm font-normal text-text-muted ml-1">{unit}</span>}
      </div>
    </div>
  )
}

function ActiveStatusCard({ isActive, isAccident }: { isActive: boolean; isAccident: boolean }) {
  const dotColor  = isAccident ? 'bg-danger animate-pulse' : isActive ? 'bg-success animate-pulse' : 'bg-text-muted'
  const textColor = isAccident ? 'text-danger' : isActive ? 'text-success' : 'text-text-muted'
  const label     = isAccident ? 'Alerta' : isActive ? 'Activo' : 'Inactivo'
  return (
    <div className="bg-surface-raised rounded-xl p-3 flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-text-muted">
        <Signal className="w-3.5 h-3.5" />
        <span className="text-xs">Conexión</span>
      </div>
      <div className={cn('font-bold text-xl leading-none flex items-center gap-2', textColor)}>
        <span className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0', dotColor)} />
        {label}
      </div>
    </div>
  )
}

function TripDurationCard({ secs, isActive, hasData }: {
  secs: number; isActive: boolean; hasData: boolean
}) {
  return (
    <div className="bg-surface-raised rounded-xl p-3 flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-text-muted">
        <Timer className="w-3.5 h-3.5" />
        <span className="text-xs">Tiempo activo</span>
      </div>
      <div className={cn(
        'font-mono font-bold text-xl leading-none',
        !hasData ? 'text-text-muted' : isActive ? 'text-primary' : 'text-text-secondary',
      )}>
        {hasData ? formatDuration(secs * 1000) : '--'}
      </div>
      {hasData && (
        <div className="flex items-center gap-1.5">
          <span className={cn(
            'w-1.5 h-1.5 rounded-full flex-shrink-0',
            isActive ? 'bg-success animate-pulse' : 'bg-text-muted',
          )} />
          <span className={cn('text-[11px]', isActive ? 'text-success' : 'text-text-muted')}>
            {isActive ? 'En curso' : 'Sesión finalizada'}
          </span>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function TechnicianDetail() {
  const { selectedTechnicianId, technicians, selectTechnician, toggleHeatmap, showHeatmap, updateTechnicianMeta } = useTrackingStore()
  const [elevData,  setElevData]  = useState<any[]>([])
  const [speedData, setSpeedData] = useState<any[]>([])
  const [loading,   setLoading]   = useState(false)

  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editData,      setEditData]      = useState<TechnicianEditable | null>(null)
  const [loadingEdit,   setLoadingEdit]   = useState(false)

  const tech = selectedTechnicianId ? technicians[selectedTechnicianId] : null

  async function openEditModal() {
    if (!tech) return
    setLoadingEdit(true)
    const { data } = await supabase
      .from('technicians')
      .select('id, name, phone, client, project, country, city, shift, notes, device_id, active, created_at, home_address, home_lat, home_lng, home_radius')
      .eq('id', tech.id)
      .single()
    setEditData(data as TechnicianEditable)
    setLoadingEdit(false)
    setEditModalOpen(true)
  }

  async function handleEditSave(id: string, patch: Partial<TechnicianEditable>) {
    const { error } = await supabase.from('technicians').update(patch).eq('id', id)
    if (error) throw error
    updateTechnicianMeta(id, {
      name:         patch.name,
      phone:        patch.phone ?? undefined,
      home_lat:     patch.home_lat,
      home_lng:     patch.home_lng,
      home_address: patch.home_address,
      home_radius:  patch.home_radius,
    })
  }

  const [tripInfo, setTripInfo]     = useState<{ start: Date; end: Date | null } | null>(null)
  const [activeSecs, setActiveSecs] = useState(0)
  const timerRef        = useRef<number>()
  const prevIsActiveRef = useRef<boolean | null>(null)
  const lastSeenRef     = useRef(tech?.lastSeen)
  useEffect(() => { lastSeenRef.current = tech?.lastSeen }, [tech?.lastSeen])

  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const secsSinceLastGps = tech?.lastSeen
    ? (Date.now() - new Date(tech.lastSeen).getTime()) / 1000
    : Infinity
  const isActive = secsSinceLastGps < STATUS_THRESHOLDS.IDLE_S

  const tripAge      = tripInfo ? Date.now() - tripInfo.start.getTime() : Infinity
  const effectiveTrip = !tripInfo ? null
    : (isActive && (tripInfo.end !== null || tripAge > 16 * 3600_000)) ? null
    : tripInfo

  function fetchTrip(techId: string, replace: boolean) {
    supabase
      .from('trips')
      .select('started_at, ended_at')
      .eq('technician_id', techId)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!data?.started_at) return
        const newStart = new Date(data.started_at)
        const newInfo  = { start: newStart, end: data.ended_at ? new Date(data.ended_at) : null }
        if (replace) {
          setTripInfo(newInfo)
        } else {
          setTripInfo(prev => (!prev || newStart > prev.start) ? newInfo : prev)
        }
      })
  }

  useEffect(() => {
    setTripInfo(null)
    setActiveSecs(0)
    prevIsActiveRef.current = null
    if (!tech) return
    fetchTrip(tech.id, true)
  }, [tech?.id])

  useEffect(() => {
    const becameActive = isActive === true && prevIsActiveRef.current === false
    prevIsActiveRef.current = isActive
    if (becameActive && tech) fetchTrip(tech.id, false)
  }, [isActive, tech?.id])

  useEffect(() => {
    if (!isActive || effectiveTrip || !tech) return
    const id = setInterval(() => fetchTrip(tech.id, false), 15_000)
    return () => clearInterval(id)
  }, [isActive, tripInfo, tech?.id])

  useEffect(() => {
    clearInterval(timerRef.current)
    if (!effectiveTrip) { setActiveSecs(0); return }
    if (isActive) {
      const step = () => setActiveSecs(Math.floor((Date.now() - effectiveTrip.start.getTime()) / 1000))
      step()
      timerRef.current = window.setInterval(step, 1000)
      return () => clearInterval(timerRef.current)
    } else {
      const endMs = (effectiveTrip.end ?? (lastSeenRef.current ? new Date(lastSeenRef.current) : effectiveTrip.start)).getTime()
      setActiveSecs(Math.max(0, Math.floor((endMs - effectiveTrip.start.getTime()) / 1000)))
    }
  }, [effectiveTrip, isActive])

  useEffect(() => {
    if (!tech) return
    async function fetchCharts() {
      const from = new Date(Date.now() - 8 * 3600_000).toISOString()
      try {
        const [elevRes, speedRes] = await Promise.all([
          api.get(`/api/analytics/technicians/${tech!.id}/elevation`, { params: { from } }),
          api.get(`/api/analytics/technicians/${tech!.id}/heatmap`,   { params: { from } }),
        ])
        setElevData(elevRes.data)
        setSpeedData(speedRes.data.map((p: any) => ({
          ts:         p.ts,
          speed_kmh:  p.speed_kmh,
          speed_band: p.speed_kmh < 30 ? 'low' : p.speed_kmh < 60 ? 'medium' : 'high',
        })))
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    setLoading(true)
    fetchCharts()
    const interval = setInterval(fetchCharts, 30_000)
    return () => clearInterval(interval)
  }, [tech?.id])

  return (
    <AnimatePresence>
      {tech && (
        <motion.div
          key={tech.id}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 20 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className="flex flex-col h-full overflow-y-auto"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-soft sticky top-0 bg-surface z-10">
            <div>
              <h3 className="font-bold text-text-primary">{tech.name}</h3>
              {tech.phone && (
                <div className="flex items-center gap-1 text-xs text-text-muted mt-0.5">
                  <Phone className="w-3 h-3" />
                  {tech.phone}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={openEditModal}
                disabled={loadingEdit}
                title="Editar técnico"
                className="p-1.5 rounded-lg hover:bg-surface-raised text-text-muted hover:text-primary transition-colors disabled:opacity-50"
              >
                {loadingEdit ? <Loader2 className="w-4 h-4 animate-spin" /> : <Edit2 className="w-4 h-4" />}
              </button>
              <button
                onClick={() => selectTechnician(null)}
                className="p-1.5 rounded-lg hover:bg-surface-raised text-text-muted hover:text-text-primary transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Stats */}
          <div className="p-4 grid grid-cols-2 gap-2">
            <StatCard
              icon={Gauge}
              label="Velocidad actual"
              value={tech.lastSpeed ? Math.round(tech.lastSpeed * 3.6) : 0}
              unit="km/h"
              color={tech.lastSpeed && tech.lastSpeed * 3.6 > 80 ? 'text-danger' : 'text-success'}
            />
            <StatCard
              icon={Battery}
              label="Batería"
              value={tech.battery ?? '--'}
              unit="%"
              color={
                tech.battery == null ? 'text-text-muted'
                : tech.battery > 50  ? 'text-success'
                : tech.battery > 20  ? 'text-warning'
                : 'text-danger'
              }
            />
            <StatCard
              icon={Mountain}
              label="Altitud"
              value={tech.altitude != null ? Math.round(tech.altitude) : '--'}
              unit="m"
              color="text-primary"
            />
            <StatCard
              icon={Navigation}
              label="Dirección"
              value={tech.bearing != null ? Math.round(tech.bearing) : '--'}
              unit="°"
              color="text-text-secondary"
            />
            <TripDurationCard secs={activeSecs} isActive={isActive} hasData={effectiveTrip !== null} />
            <ActiveStatusCard isActive={isActive} isAccident={tech.status === 'accident'} />
          </div>

          {/* Última actualización */}
          <div className="px-4 pb-3">
            <div className="flex items-center gap-1.5 text-xs text-text-muted">
              <div className={cn(
                'w-1.5 h-1.5 rounded-full',
                tech.status === 'moving'   ? 'bg-success animate-pulse'
                : tech.status === 'accident' ? 'bg-danger animate-pulse'
                : 'bg-text-muted',
              )} />
              {tech.lastSeen
                ? `Actualizado ${formatDistanceToNow(new Date(tech.lastSeen), { addSuffix: true, locale: es })}`
                : 'Sin datos recientes'}
            </div>
          </div>

          {/* Toggle heatmap */}
          <div className="px-4 pb-3">
            <button
              onClick={toggleHeatmap}
              className={cn(
                'w-full py-2 px-3 rounded-lg text-xs font-medium transition-all border',
                showHeatmap
                  ? 'bg-primary/10 border-primary/30 text-primary'
                  : 'bg-surface-raised border-border text-text-secondary hover:border-primary/30',
              )}
            >
              {showHeatmap ? '🔥 Ocultar heatmap de velocidad' : '🔥 Mostrar heatmap de velocidad'}
            </button>
          </div>

          {/* Gráfico de elevación */}
          <div className="px-4 pb-4">
            <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Mountain className="w-3.5 h-3.5" /> Perfil de Elevación (8h)
            </h4>
            {loading
              ? <div className="h-36 bg-surface-raised rounded-xl animate-pulse" />
              : <ElevationChart data={elevData} />
            }
          </div>

          {/* Gráfico de velocidad */}
          <div className="px-4 pb-4">
            <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Gauge className="w-3.5 h-3.5" /> Velocidad (8h)
            </h4>
            {loading
              ? <div className="h-36 bg-surface-raised rounded-xl animate-pulse" />
              : <SpeedChart data={speedData} />
            }
          </div>

          {/* Spacer bottom */}
          <div className="h-4" />

          {/* Modal de edición — usa createPortal, puede ir aquí sin afectar layout */}
          {editModalOpen && editData && (
            <TechnicianEditModal
              tech={editData}
              onSave={handleEditSave}
              onClose={() => { setEditModalOpen(false); setEditData(null) }}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
