import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  Plus, RefreshCw, Trash2, Edit2, QrCode,
  Loader2, Smartphone, WifiOff, Search, X,
  MapPin, Building2, FolderOpen,
  Filter, ChevronDown, Clock, Sparkles,
  AlertCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { QrCodeModal } from '@/components/modals/QrCodeModal'
import { TechnicianEditModal, type TechnicianEditable } from '@/components/modals/TechnicianEditModal'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { TechnicianRegistrationModal } from '@/components/modals/TechnicianRegistrationModal'
import { to12h } from '@/components/ui/TimeSelect'
import { parseShift } from '@/lib/geo'

type Technician = TechnicianEditable

interface TechStatus {
  id: string
  status: string
  last_seen: string | null
  battery: number | null
}

const STATUS_CFG: Record<string, { label: string; dot: string; text: string }> = {
  moving:   { label: 'En movimiento', dot: 'bg-success animate-pulse', text: 'text-success' },
  idle:     { label: 'Inactivo',      dot: 'bg-warning',               text: 'text-warning' },
  stopped:  { label: 'Detenido',      dot: 'bg-text-muted',            text: 'text-text-muted' },
  offline:  { label: 'Sin conexión',  dot: 'bg-danger',                text: 'text-danger' },
  accident: { label: '¡Accidente!',   dot: 'bg-danger animate-pulse',  text: 'text-danger font-bold' },
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function TechnicianManagement({ onOpenWizard }: { onOpenWizard?: () => void }) {
  const [techs, setTechs]           = useState<Technician[]>([])
  const [statuses, setStatuses]     = useState<Record<string, TechStatus>>({})
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [editTech, setEditTech]     = useState<Technician | null>(null)
  const [qrTech, setQrTech]         = useState<{ id: string; name: string } | null>(null)
  const [showUnlinked, setShowUnlinked]     = useState(true)
  const [showIncomplete, setShowIncomplete] = useState(false)
  const [selectedIds, setSelectedIds]       = useState<Set<string>>(new Set())
  const [deletingAll, setDeletingAll]       = useState(false)

  // Filters
  const [search, setSearch]           = useState('')
  const [filterCountry, setFilterCountry] = useState('')
  const [filterClient, setFilterClient]   = useState('')
  const [filterProject, setFilterProject] = useState('')

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [techsRes, statusRes] = await Promise.all([
        supabase
          .from('technicians')
          .select('id, name, phone, email, client, project, country, city, shift, notes, device_id, company_id, active, created_at, home_address, home_lat, home_lng')
          .order('created_at', { ascending: false }),
        supabase
          .from('technician_current_status')
          .select('id, status, last_seen, battery'),
      ])
      if (techsRes.error) throw new Error(techsRes.error.message)
      setTechs(techsRes.data ?? [])
      const statusMap: Record<string, TechStatus> = {}
      for (const s of statusRes.data ?? []) statusMap[s.id] = s
      setStatuses(statusMap)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])
  useEffect(() => { setSelectedIds(new Set()) }, [search, filterCountry, filterClient, filterProject])

  // Derived filter options
  const uniqueCountries = useMemo(() =>
    [...new Set(techs.map(t => t.country).filter(Boolean) as string[])].sort(), [techs])
  const uniqueClients = useMemo(() =>
    [...new Set(techs.map(t => t.client).filter(Boolean) as string[])].sort(), [techs])
  const uniqueProjects = useMemo(() =>
    [...new Set(techs.map(t => t.project).filter(Boolean) as string[])].sort(), [techs])

  // Filtered list
  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return techs.filter(t => {
      if (q && !t.name.toLowerCase().includes(q) &&
          !(t.phone ?? '').includes(q) &&
          !(t.client ?? '').toLowerCase().includes(q) &&
          !(t.project ?? '').toLowerCase().includes(q)) return false
      if (filterCountry && t.country !== filterCountry) return false
      if (filterClient  && t.client  !== filterClient)  return false
      if (filterProject && t.project !== filterProject) return false
      return true
    })
  }, [techs, search, filterCountry, filterClient, filterProject])

  const activeFilters   = [filterCountry, filterClient, filterProject].filter(Boolean).length
  const allFilteredSelected = filtered.length > 0 && filtered.every(t => selectedIds.has(t.id))
  const someFilteredSelected = filtered.some(t => selectedIds.has(t.id))
  const unlinkedTechs   = useMemo(() => techs.filter(t => t.active && !t.device_id), [techs])
  const incompleteTechs = useMemo(
    () => techs.filter(t => t.active && t.device_id && (!t.city || !t.phone)),
    [techs],
  )

  async function handleSaveEdit(id: string, data: Partial<Technician>) {
    const { error } = await supabase.from('technicians').update(data).eq('id', id)
    if (error) throw new Error(error.message)
    setTechs(prev => prev.map(t => t.id === id ? { ...t, ...data } : t))
  }

  async function toggleActive(tech: Technician) {
    setTogglingId(tech.id)
    try {
      const { error } = await supabase.from('technicians').update({ active: !tech.active }).eq('id', tech.id)
      if (error) throw error
      setTechs(prev => prev.map(t => t.id === tech.id ? { ...t, active: !t.active } : t))
    } catch (err: any) {
      alert(err.message)
    } finally {
      setTogglingId(null)
    }
  }

  async function deleteTech(tech: Technician) {
    if (!window.confirm(`¿Eliminar al técnico "${tech.name}"?\nSe borrarán también sus tokens de registro. Esta acción no se puede deshacer.`)) return
    setDeletingId(tech.id)
    try {
      await supabase.from('registration_tokens').delete().eq('technician_id', tech.id)
      const { error } = await supabase.from('technicians').delete().eq('id', tech.id)
      if (error) throw error
      setTechs(prev => prev.filter(t => t.id !== tech.id))
    } catch (err: any) {
      alert(err.message)
    } finally {
      setDeletingId(null)
    }
  }

  async function deleteSelected() {
    const ids = [...selectedIds]
    if (ids.length === 0) return
    if (!window.confirm(`¿Eliminar ${ids.length} técnico${ids.length !== 1 ? 's' : ''}?\nEsta acción no se puede deshacer.`)) return
    setDeletingAll(true)
    try {
      await supabase.from('registration_tokens').delete().in('technician_id', ids)
      const { error } = await supabase.from('technicians').delete().in('id', ids)
      if (error) throw error
      setTechs(prev => prev.filter(t => !ids.includes(t.id)))
      setSelectedIds(new Set())
      toast.success(`${ids.length} técnico${ids.length !== 1 ? 's' : ''} eliminado${ids.length !== 1 ? 's' : ''}`)
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setDeletingAll(false)
    }
  }

  function downloadCSV() {
    const header = 'ID,Nombre,Teléfono,País,Ciudad,Jornada,Cliente,Proyecto,Notas,Device ID,Activo,Estado,Batería,Último acceso,Registrado'
    const rows = techs.map(t => {
      const s = statuses[t.id]
      return [
        t.id,
        `"${t.name}"`,
        t.phone ?? '',
        t.country ?? '',
        t.city ?? '',
        t.shift ?? '',
        `"${t.client ?? ''}"`,
        `"${t.project ?? ''}"`,
        `"${(t.notes ?? '').replace(/"/g, '""')}"`,
        t.device_id ?? '',
        t.active ? 'Sí' : 'No',
        s?.status ?? 'offline',
        s?.battery != null ? `${s.battery}%` : '',
        s?.last_seen ? format(parseISO(s.last_seen), 'dd/MM/yyyy HH:mm') : '',
        format(parseISO(t.created_at), 'dd/MM/yyyy'),
      ].join(',')
    })
    const csv = [header, ...rows].join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tecnicos_${format(new Date(), 'yyyyMMdd')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <p className="text-text-primary font-semibold text-sm">Técnicos de Campo</p>
          {!loading && (
            <p className="text-xs text-text-muted">
              {filtered.length !== techs.length
                ? `${filtered.length} de ${techs.length} técnicos`
                : `${techs.length} técnicos`}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 ml-auto flex-wrap">
          {selectedIds.size > 0 && (
            <button
              onClick={deleteSelected}
              disabled={deletingAll}
              className="flex items-center gap-1.5 text-xs bg-danger/10 text-danger hover:bg-danger/20 border border-danger/30 font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60"
            >
              {deletingAll
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Trash2 className="w-3.5 h-3.5" />}
              Borrar {selectedIds.size} seleccionado{selectedIds.size !== 1 ? 's' : ''}
            </button>
          )}
          <button onClick={downloadCSV} title="Exportar CSV"
            className="text-xs text-text-muted hover:text-text-primary transition-colors border border-border rounded-lg px-2.5 py-1.5">
            Exportar CSV
          </button>
          <button onClick={load} title="Actualizar"
            className="text-text-muted hover:text-text-primary transition-colors p-1.5 rounded-lg hover:bg-surface-raised">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 bg-primary hover:bg-primary-hover text-base text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors">
            <Plus className="w-3.5 h-3.5" /> Nuevo técnico
          </button>
        </div>
      </div>

      {/* ── Sección: Dispositivos sin vincular ── */}
      {unlinkedTechs.length > 0 && (
        <div className="bg-amber-500/5 border border-amber-500/25 rounded-2xl overflow-hidden">
          <button
            onClick={() => setShowUnlinked(v => !v)}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-amber-500/5 transition-colors text-left"
          >
            <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center flex-shrink-0">
              <Smartphone className="w-4 h-4 text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-400">
                {unlinkedTechs.length} técnico{unlinkedTechs.length !== 1 ? 's' : ''} sin app vinculada
              </p>
              <p className="text-xs text-text-muted">
                Generá el QR y enviáselo para que empiecen a rastrear
              </p>
            </div>
            <ChevronDown className={cn('w-4 h-4 text-text-muted transition-transform flex-shrink-0', showUnlinked && 'rotate-180')} />
          </button>
          {showUnlinked && (
            <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {unlinkedTechs.map(tech => (
                <div key={tech.id} className="flex items-center justify-between bg-base/70 border border-border-soft rounded-xl px-3 py-2.5 gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-text-primary truncate">{tech.name}</p>
                    <p className="text-xs text-text-muted truncate">
                      {[tech.city, tech.country].filter(Boolean).join(', ') || 'Sin ubicación asignada'}
                    </p>
                  </div>
                  <button
                    onClick={() => setQrTech({ id: tech.id, name: tech.name })}
                    className="flex items-center gap-1.5 text-xs bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 rounded-lg px-2.5 py-1.5 transition-colors flex-shrink-0 font-medium"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    Ver QR
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Sección: Datos incompletos ── */}
      {incompleteTechs.length > 0 && (
        <div className="bg-primary/5 border border-primary/20 rounded-2xl overflow-hidden">
          <button
            onClick={() => setShowIncomplete(v => !v)}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-primary/5 transition-colors text-left"
          >
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <AlertCircle className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-primary">
                {incompleteTechs.length} técnico{incompleteTechs.length !== 1 ? 's' : ''} con perfil incompleto
              </p>
              <p className="text-xs text-text-muted">
                Faltan teléfono o ciudad — se puede detectar la ciudad por GPS automáticamente
              </p>
            </div>
            <ChevronDown className={cn('w-4 h-4 text-text-muted transition-transform flex-shrink-0', showIncomplete && 'rotate-180')} />
          </button>
          {showIncomplete && (
            <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {incompleteTechs.map(tech => (
                <div key={tech.id} className="flex items-center justify-between bg-base/70 border border-border-soft rounded-xl px-3 py-2.5 gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-text-primary truncate">{tech.name}</p>
                    <div className="flex flex-wrap items-center gap-1 mt-0.5">
                      {!tech.phone && (
                        <span className="text-[10px] bg-warning/10 text-warning border border-warning/20 rounded px-1.5 py-0.5">Sin teléfono</span>
                      )}
                      {!tech.city && (
                        <span className="text-[10px] bg-warning/10 text-warning border border-warning/20 rounded px-1.5 py-0.5">Sin ciudad</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => setEditTech(tech)}
                    className="flex items-center gap-1.5 text-xs bg-primary/10 text-primary hover:bg-primary/20 rounded-lg px-2.5 py-1.5 transition-colors flex-shrink-0 font-medium"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    Completar
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Filter bar */}
      <div className="bg-surface border border-border-soft rounded-xl p-3 flex flex-wrap gap-2">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nombre, cliente…"
            className="w-full bg-base border border-border-soft rounded-lg pl-8 pr-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Country filter */}
        <FilterSelect
          icon={<MapPin className="w-3 h-3" />}
          value={filterCountry}
          onChange={setFilterCountry}
          placeholder="País"
          options={uniqueCountries}
        />

        {/* Client filter */}
        <FilterSelect
          icon={<Building2 className="w-3 h-3" />}
          value={filterClient}
          onChange={setFilterClient}
          placeholder="Cliente"
          options={uniqueClients}
        />

        {/* Project filter */}
        <FilterSelect
          icon={<FolderOpen className="w-3 h-3" />}
          value={filterProject}
          onChange={setFilterProject}
          placeholder="Proyecto"
          options={uniqueProjects}
        />

        {/* Clear filters */}
        {activeFilters > 0 && (
          <button
            onClick={() => { setFilterCountry(''); setFilterClient(''); setFilterProject('') }}
            className="flex items-center gap-1 text-xs text-danger hover:text-danger/80 transition-colors px-2 py-1.5 rounded-lg hover:bg-danger/10"
          >
            <X className="w-3 h-3" />
            Limpiar ({activeFilters})
          </button>
        )}

        {activeFilters === 0 && uniqueCountries.length === 0 && (
          <span className="flex items-center gap-1 text-xs text-text-muted px-2">
            <Filter className="w-3 h-3" />
            Los filtros aparecerán cuando haya datos
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="bg-danger/10 border border-danger/30 text-danger text-sm rounded-xl px-4 py-3">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          {techs.length === 0 ? (
            <>
              <p className="text-text-muted text-sm">No hay técnicos registrados aún.</p>
              {onOpenWizard && (
                <button
                  onClick={onOpenWizard}
                  className="inline-flex items-center gap-2 bg-primary hover:bg-primary-hover text-base text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
                >
                  <Sparkles className="w-4 h-4" />
                  Crear primer proyecto
                </button>
              )}
            </>
          ) : (
            <p className="text-text-muted text-sm">Sin resultados para los filtros aplicados</p>
          )}
        </div>
      ) : (
        <div className="bg-surface border border-border-soft rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-soft bg-base/50">
                  <th className="px-4 py-3 w-8">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      ref={el => { if (el) el.indeterminate = someFilteredSelected && !allFilteredSelected }}
                      onChange={() => {
                        if (allFilteredSelected) {
                          setSelectedIds(prev => { const s = new Set(prev); filtered.forEach(t => s.delete(t.id)); return s })
                        } else {
                          setSelectedIds(prev => { const s = new Set(prev); filtered.forEach(t => s.add(t.id)); return s })
                        }
                      }}
                      className="w-3.5 h-3.5 accent-primary cursor-pointer"
                    />
                  </th>
                  {['Técnico', 'País / Organización', 'Estado', 'Dispositivo', 'Registrado', ''].map((h, i) => (
                    <th key={i} className={cn(
                      'text-xs text-text-muted font-medium px-4 py-3',
                      i === 5 ? 'text-right' : 'text-left'
                    )}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(tech => {
                  const st = statuses[tech.id]
                  const cfg = STATUS_CFG[st?.status ?? 'offline'] ?? STATUS_CFG['offline']
                  const isToggling = togglingId === tech.id
                  const isDeleting = deletingId === tech.id

                  const isSelected = selectedIds.has(tech.id)

                  return (
                    <tr key={tech.id} className={cn(
                      'border-b border-border-soft/60 last:border-0 transition-colors hover:bg-surface-raised/50',
                      !tech.active && 'opacity-50',
                      isSelected && 'bg-danger/5',
                    )}>
                      <td className="px-4 py-3 w-8">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => setSelectedIds(prev => {
                            const s = new Set(prev)
                            if (s.has(tech.id)) s.delete(tech.id); else s.add(tech.id)
                            return s
                          })}
                          className="w-3.5 h-3.5 accent-primary cursor-pointer"
                        />
                      </td>
                      {/* Name / Phone */}
                      <td className="px-4 py-3">
                        <p className="text-text-primary text-xs font-semibold">{tech.name}</p>
                        {tech.phone && <p className="text-text-muted text-xs">{tech.phone}</p>}
                        {!tech.active && <span className="text-xs text-warning font-medium">Desactivado</span>}
                      </td>

                      {/* Country / City / Shift / Client / Project */}
                      <td className="px-4 py-3 max-w-[260px]">
                        {(tech.country || tech.city) && (
                          <div className="flex items-center gap-1 text-xs text-text-secondary mb-0.5">
                            <MapPin className="w-3 h-3 text-text-muted flex-shrink-0" />
                            <span className="break-words">
                              {[tech.city, tech.country].filter(Boolean).join(', ')}
                            </span>
                          </div>
                        )}
                        {tech.shift && (
                          <div className="mb-1">
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md border bg-base text-text-muted border-border">
                              <Clock className="w-2.5 h-2.5 flex-shrink-0" />
                              {(() => {
                                const { start, end } = parseShift(tech.shift)
                                return start && end ? `${to12h(start)} – ${to12h(end)}` : tech.shift
                              })()}
                            </span>
                          </div>
                        )}
                        {tech.client && (
                          <div className="flex items-start gap-1 text-xs text-text-muted">
                            <Building2 className="w-3 h-3 flex-shrink-0 mt-0.5" />
                            <span className="break-words">{tech.client}</span>
                          </div>
                        )}
                        {tech.project && (
                          <div className="flex items-start gap-1 text-xs text-text-muted">
                            <FolderOpen className="w-3 h-3 flex-shrink-0 mt-0.5" />
                            <span className="break-words">{tech.project}</span>
                          </div>
                        )}
                        {!tech.country && !tech.city && !tech.shift && !tech.client && !tech.project && (
                          <span className="text-xs text-text-muted/50">—</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        {tech.device_id ? (
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', cfg.dot)} />
                              <span className={cn('text-xs', cfg.text)}>{cfg.label}</span>
                            </div>
                            {st?.battery != null && (
                              <p className="text-text-muted text-xs mt-0.5 ml-3">{st.battery}% bat.</p>
                            )}
                          </div>
                        ) : (
                          <span className="text-text-muted text-xs flex items-center gap-1">
                            <WifiOff className="w-3 h-3" /> Sin app
                          </span>
                        )}
                      </td>

                      {/* Device */}
                      <td className="px-4 py-3">
                        {tech.device_id ? (
                          <span className="text-text-muted text-xs flex items-center gap-1">
                            <Smartphone className="w-3 h-3 flex-shrink-0" />
                            <span className="font-mono truncate max-w-[100px]" title={tech.device_id}>
                              {tech.device_id.slice(0, 10)}…
                            </span>
                          </span>
                        ) : (
                          <span className="text-text-muted text-xs">No registrado</span>
                        )}
                      </td>

                      {/* Date */}
                      <td className="px-4 py-3 text-text-muted text-xs whitespace-nowrap">
                        {format(parseISO(tech.created_at), 'dd MMM yyyy', { locale: es })}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {tech.device_id && (
                            <Link
                              to={`/map?tech=${tech.id}`}
                              title="Ver en mapa"
                              className="text-text-muted hover:text-success p-1.5 rounded-lg hover:bg-success/10 transition-colors"
                            >
                              <MapPin className="w-3.5 h-3.5" />
                            </Link>
                          )}
                          <button
                            onClick={() => setQrTech({ id: tech.id, name: tech.name })}
                            title="Generar QR"
                            className="text-text-muted hover:text-primary p-1.5 rounded-lg hover:bg-primary/10 transition-colors"
                          >
                            <QrCode className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setEditTech(tech)}
                            title="Editar"
                            className="text-text-muted hover:text-text-primary p-1.5 rounded-lg hover:bg-surface-raised transition-colors"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => toggleActive(tech)}
                            disabled={isToggling || isDeleting}
                            title={tech.active ? 'Desactivar' : 'Activar'}
                            className={cn(
                              'text-xs px-2 py-1 rounded-lg transition-colors disabled:opacity-40',
                              tech.active
                                ? 'text-warning hover:text-warning/80 hover:bg-warning/10'
                                : 'text-success hover:text-success/80 hover:bg-success/10',
                            )}
                          >
                            {isToggling
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              : tech.active ? 'Desactivar' : 'Activar'}
                          </button>
                          <button
                            onClick={() => deleteTech(tech)}
                            disabled={isDeleting || isToggling}
                            title="Eliminar"
                            className="text-text-muted hover:text-danger p-1.5 rounded-lg hover:bg-danger/10 transition-colors disabled:opacity-40"
                          >
                            {isDeleting
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              : <Trash2 className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modals */}
      <TechnicianRegistrationModal
        open={createOpen}
        onOpenChange={open => { setCreateOpen(open); if (!open) load() }}
      />

      {qrTech && (
        <QrCodeModal
          tech={qrTech}
          onClose={() => setQrTech(null)}
        />
      )}

      {editTech && (
        <TechnicianEditModal
          tech={editTech}
          onSave={handleSaveEdit}
          onClose={() => setEditTech(null)}
        />
      )}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SectionLabel({ color, label, optional }: { color: string; label: string; optional?: boolean }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className={cn('w-1 h-4 rounded-full', color)} />
      <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">{label}</p>
      {optional && <span className="text-xs text-text-muted">(opcional)</span>}
    </div>
  )
}

function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <label className="block text-xs text-text-muted font-medium mb-1.5">
      {label} {required && <span className="text-danger">*</span>}
    </label>
  )
}

function FilterSelect({ icon, value, onChange, placeholder, options }: {
  icon: React.ReactNode
  value: string
  onChange: (v: string) => void
  placeholder: string
  options: string[]
}) {
  if (options.length === 0) return null
  return (
    <div className="relative">
      <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none">{icon}</div>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={cn(
          'appearance-none bg-base border rounded-lg pl-7 pr-6 py-1.5 text-xs text-text-primary cursor-pointer',
          'focus:outline-none focus:border-primary transition-colors',
          value ? 'border-primary text-primary' : 'border-border-soft text-text-muted'
        )}
      >
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted pointer-events-none" />
    </div>
  )
}
