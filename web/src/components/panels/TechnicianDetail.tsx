import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTrackingStore, STATUS_THRESHOLDS } from '@/store/trackingStore'
import { useTechnicianAssignments } from '@/hooks/useTechnicianAssignments'
import { ElevationChart } from '@/components/charts/ElevationChart'
import { SpeedChart }     from '@/components/charts/SpeedChart'
import { supabase } from '@/lib/supabase'
import { geocodeAddress } from '@/lib/geocoding'
import api from '@/lib/api'
import { TechnicianEditModal, TechnicianEditable } from '@/components/modals/TechnicianEditModal'
import {
  X, Battery, Gauge, Mountain, Phone,
  RotateCcw, Navigation, Timer, Signal,
  CalendarDays, Plus, MapPin, Search,
  Loader2, Check, ChevronDown, ChevronUp,
  Home, Clock, Edit2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  formatDistanceToNow, format, isToday, isTomorrow,
  isSameDay, addDays,
} from 'date-fns'
import { es } from 'date-fns/locale'
import { toast } from 'sonner'
import { TechnicianAssignment, AssignmentStatus, ASSIGNMENT_STATUS_CFG } from '@/types/assignments'

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

function dayLabel(date: Date): string {
  if (isToday(date))    return 'Hoy'
  if (isTomorrow(date)) return 'Mañana'
  return format(date, "EEEE d 'de' MMMM", { locale: es })
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

// ── Agenda section ────────────────────────────────────────────────────────────

function AgendaSection({ technicianId }: { technicianId: string }) {
  const { assignments, loading, reload } = useTechnicianAssignments(technicianId)
  const [showForm, setShowForm] = useState(false)
  const [expanded, setExpanded] = useState(true)

  // Form state
  const [title,    setTitle]    = useState('')
  const [dateTime, setDateTime] = useState(() => {
    const d = new Date()
    d.setHours(d.getHours() + 1, 0, 0, 0)
    return format(d, "yyyy-MM-dd'T'HH:mm")
  })
  const [address,  setAddress]  = useState('')
  const [lat,      setLat]      = useState<number | null>(null)
  const [lng,      setLng]      = useState<number | null>(null)
  const [notes,    setNotes]    = useState('')
  const [duration, setDuration] = useState(30)
  const [geocoding, setGeocoding] = useState(false)
  const [saving,    setSaving]    = useState(false)
  function resetForm() {
    setTitle(''); setAddress(''); setLat(null); setLng(null)
    setNotes(''); setDuration(30)
    const d = new Date(); d.setHours(d.getHours() + 1, 0, 0, 0)
    setDateTime(format(d, "yyyy-MM-dd'T'HH:mm"))
  }

  async function handleGeocode() {
    if (!address.trim() || geocoding) return
    setGeocoding(true)
    try {
      const res = await geocodeAddress(address.trim())
      if (!res) { toast.error('No se encontró la dirección'); return }
      setLat(res.lat); setLng(res.lng)
      toast.success('Coordenadas obtenidas')
    } catch {
      toast.error('Error al geocodificar')
    } finally {
      setGeocoding(false)
    }
  }

  async function handleAddAssignment() {
    if (!title.trim()) { toast.error('El título es requerido'); return }
    if (!dateTime)     { toast.error('La fecha y hora son requeridas'); return }
    setSaving(true)
    try {
      const { error } = await supabase.from('technician_assignments').insert({
        technician_id:              technicianId,
        title:                      title.trim(),
        address:                    address.trim() || null,
        lat:                        lat,
        lng:                        lng,
        scheduled_at:               new Date(dateTime).toISOString(),
        estimated_duration_minutes: duration,
        status:                     'pending',
        notes:                      notes.trim() || null,
      })
      if (error) throw error
      toast.success('Parada agregada')
      resetForm()
      setShowForm(false)
      reload()
    } catch (err: any) {
      toast.error(err.message ?? 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  async function handleStatusChange(a: TechnicianAssignment, status: AssignmentStatus) {
    const { error } = await supabase
      .from('technician_assignments')
      .update({ status })
      .eq('id', a.id)
    if (error) { toast.error('Error al actualizar'); return }
    reload()
  }

  async function handleDelete(id: string) {
    const { error } = await supabase.from('technician_assignments').delete().eq('id', id)
    if (error) { toast.error('Error al eliminar'); return }
    reload()
  }

  // Group assignments by day
  const days: { date: Date; items: TechnicianAssignment[] }[] = []
  assignments.forEach(a => {
    const d = new Date(a.scheduled_at)
    const existing = days.find(day => isSameDay(day.date, d))
    if (existing) existing.items.push(a)
    else days.push({ date: d, items: [a] })
  })

  const pending = assignments.filter(a => a.status === 'pending' || a.status === 'in_progress').length

  return (
    <div className="border-t border-border-soft">
      {/* Header de la sección */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(v => !v)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setExpanded(v => !v) }}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-raised transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <CalendarDays className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-semibold text-text-primary uppercase tracking-wider">Agenda</span>
          {pending > 0 && (
            <span className="bg-warning/20 text-warning text-[10px] font-bold px-1.5 py-0.5 rounded-full">
              {pending}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={e => { e.stopPropagation(); setShowForm(v => !v); setExpanded(true) }}
            className={cn(
              'p-1 rounded-lg transition-colors',
              showForm ? 'bg-primary/10 text-primary' : 'text-text-muted hover:text-primary hover:bg-primary/10',
            )}
            title="Agregar parada"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          {expanded
            ? <ChevronUp className="w-3.5 h-3.5 text-text-muted" />
            : <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
          }
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-3">

              {/* Formulario para agregar parada */}
              <AnimatePresence>
                {showForm && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className="bg-base border border-border-soft rounded-xl p-3 space-y-2.5"
                  >
                    <p className="text-xs font-semibold text-text-primary">Nueva parada</p>

                    {/* Título */}
                    <input
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      placeholder="Título de la parada"
                      className="w-full bg-surface border border-border-soft rounded-lg px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary/40 transition-colors"
                    />

                    {/* Fecha y hora */}
                    <input
                      type="datetime-local"
                      value={dateTime}
                      onChange={e => setDateTime(e.target.value)}
                      className="w-full bg-surface border border-border-soft rounded-lg px-3 py-1.5 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-primary/40 transition-colors"
                    />

                    {/* Dirección libre */}
                    <div className="flex gap-1.5">
                      <input
                        value={address}
                        onChange={e => { setAddress(e.target.value); setLat(null); setLng(null) }}
                        onKeyDown={e => { if (e.key === 'Enter') handleGeocode() }}
                        placeholder="Dirección (opcional)"
                        className="flex-1 bg-surface border border-border-soft rounded-lg px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary/40 transition-colors"
                      />
                      <button
                        onClick={handleGeocode}
                        disabled={geocoding || !address.trim()}
                        className="px-2.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary transition-colors disabled:opacity-50"
                        title="Buscar coordenadas"
                      >
                        {geocoding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    {lat && lng && (
                      <p className="text-[10px] text-success flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        Ubicado: {lat.toFixed(4)}, {lng.toFixed(4)}
                      </p>
                    )}

                    {/* Duración estimada */}
                    <div className="flex items-center gap-2">
                      <Clock className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
                      <span className="text-xs text-text-muted flex-shrink-0">Duración est.</span>
                      <input
                        type="number"
                        min={5}
                        max={480}
                        step={5}
                        value={duration}
                        onChange={e => setDuration(Number(e.target.value))}
                        className="w-16 bg-surface border border-border-soft rounded-lg px-2 py-1 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-primary/40 text-right"
                      />
                      <span className="text-xs text-text-muted">min</span>
                    </div>

                    {/* Notas */}
                    <textarea
                      value={notes}
                      onChange={e => setNotes(e.target.value)}
                      placeholder="Notas (opcional)"
                      rows={1}
                      className="w-full bg-surface border border-border-soft rounded-lg px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary/40 transition-colors resize-none"
                    />

                    <div className="flex gap-2 pt-0.5">
                      <button
                        onClick={() => { setShowForm(false); resetForm() }}
                        className="flex-1 py-1.5 rounded-lg bg-surface-raised hover:bg-border-soft text-text-secondary text-xs font-medium transition-colors"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={handleAddAssignment}
                        disabled={saving || !title.trim()}
                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-primary hover:bg-primary-hover text-base text-xs font-semibold transition-colors disabled:opacity-50"
                      >
                        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Plus className="w-3.5 h-3.5" />Agregar</>}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Lista de asignaciones */}
              {loading ? (
                <div className="flex items-center gap-2 py-3 text-text-muted text-xs justify-center">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Cargando agenda…
                </div>
              ) : days.length === 0 ? (
                <div className="py-5 text-center">
                  <p className="text-text-muted text-xs">Sin paradas programadas en los próximos 7 días</p>
                  <button
                    onClick={() => setShowForm(true)}
                    className="mt-2 text-primary text-xs font-medium hover:underline flex items-center gap-1 mx-auto"
                  >
                    <Plus className="w-3 h-3" /> Agregar primera parada
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {days.map(({ date, items }) => (
                    <div key={date.toISOString()}>
                      <p className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                        <span className={cn(
                          'px-1.5 py-0.5 rounded-md',
                          isToday(date) ? 'bg-primary/15 text-primary' : 'bg-surface-raised text-text-muted',
                        )}>
                          {dayLabel(date)}
                        </span>
                        <span>· {items.length} parada{items.length !== 1 ? 's' : ''}</span>
                      </p>
                      <div className="space-y-1.5">
                        {items.map(a => (
                          <AssignmentRow
                            key={a.id}
                            assignment={a}
                            onStatusChange={handleStatusChange}
                            onDelete={handleDelete}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function AssignmentRow({ assignment: a, onStatusChange, onDelete }: {
  assignment: TechnicianAssignment
  onStatusChange: (a: TechnicianAssignment, status: AssignmentStatus) => void
  onDelete: (id: string) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const cfg  = ASSIGNMENT_STATUS_CFG[a.status]
  const time = format(new Date(a.scheduled_at), 'HH:mm')
  const faded = a.status === 'completed' || a.status === 'cancelled'

  return (
    <div className={cn(
      'flex items-start gap-2 px-2 py-2 rounded-lg hover:bg-surface-raised transition-colors group',
      faded && 'opacity-50',
    )}>
      {/* Status dot + time */}
      <div className="flex flex-col items-center gap-0.5 pt-0.5 flex-shrink-0">
        <div className="w-2 h-2 rounded-full" style={{ background: cfg.color }} />
        <span className="text-[10px] font-mono text-text-muted leading-none">{time}</span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className={cn(
          'text-xs font-semibold leading-tight',
          faded ? 'text-text-muted line-through' : 'text-text-primary',
        )}>{a.title}</p>
        {a.address && (
          <p className="text-[10px] text-text-muted mt-0.5 flex items-center gap-1 leading-tight">
            <MapPin className="w-2.5 h-2.5 flex-shrink-0" />
            <span className="truncate">{a.address}</span>
          </p>
        )}
        {a.estimated_duration_minutes > 0 && a.status !== 'completed' && (
          <p className="text-[10px] text-text-muted mt-0.5 flex items-center gap-1">
            <Clock className="w-2.5 h-2.5 flex-shrink-0" />
            {a.estimated_duration_minutes} min
          </p>
        )}
      </div>

      {/* Actions (visible on hover) */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        {a.status === 'pending' && (
          <button
            onClick={() => onStatusChange(a, 'completed')}
            title="Marcar completado"
            className="p-1 rounded-md hover:bg-success/20 text-text-muted hover:text-success transition-colors"
          >
            <Check className="w-3 h-3" />
          </button>
        )}
        {a.status === 'completed' && (
          <button
            onClick={() => onStatusChange(a, 'pending')}
            title="Reabrir"
            className="p-1 rounded-md hover:bg-warning/20 text-text-muted hover:text-warning transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        )}
        <button
          onClick={() => onDelete(a.id)}
          title="Eliminar"
          className="p-1 rounded-md hover:bg-danger/20 text-text-muted hover:text-danger transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
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
      .select('id, name, phone, client, project, country, city, shift, notes, device_id, active, created_at, home_address, home_lat, home_lng')
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

          {/* Agenda */}
          <AgendaSection technicianId={tech.id} />

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
