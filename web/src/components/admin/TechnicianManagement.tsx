import { useEffect, useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  Plus, RefreshCw, Trash2, Edit2, QrCode,
  Loader2, Smartphone, WifiOff, Search, X,
  MapPin, Building2, FolderOpen, FileText, Save,
  Filter, ChevronDown, Navigation, Clock,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { TechnicianRegistrationModal } from '@/components/modals/TechnicianRegistrationModal'
import { COUNTRIES, CITIES_BY_COUNTRY, parseShift, buildShift } from '@/lib/geo'
import { TimeSelect, to12h } from '@/components/ui/TimeSelect'

interface Technician {
  id: string
  name: string
  phone: string | null
  client: string | null
  project: string | null
  country: string | null
  city: string | null
  shift: string | null
  notes: string | null
  device_id: string | null
  active: boolean
  created_at: string
}

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

const inputCls = cn(
  'w-full bg-base border border-border-soft rounded-xl px-3 py-2 text-sm text-text-primary',
  'placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors'
)

// ── Edit Modal ─────────────────────────────────────────────────────────────────

function EditModal({ tech, onSave, onClose }: {
  tech: Technician
  onSave: (id: string, data: Partial<Technician>) => Promise<void>
  onClose: () => void
}) {
  const [name, setName]       = useState(tech.name)
  const [phone, setPhone]     = useState(tech.phone ?? '')
  const [client, setClient]   = useState(tech.client ?? '')
  const [project, setProject] = useState(tech.project ?? '')
  const [country, setCountry]       = useState(tech.country ?? '')
  const [city, setCity]             = useState(tech.city ?? '')
  const { start: s0, end: e0 }      = parseShift(tech.shift)
  const [shiftStart, setShiftStart] = useState(s0)
  const [shiftEnd, setShiftEnd]     = useState(e0)
  const [notes, setNotes]           = useState(tech.notes ?? '')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const cityOptions = country ? (CITIES_BY_COUNTRY[country] ?? []) : []

  function handleCountryChange(newCountry: string) {
    setCountry(newCountry)
    const valid = CITIES_BY_COUNTRY[newCountry] ?? []
    if (city && !valid.includes(city)) setCity('')
  }

  async function handleSave() {
    if (!name.trim()) { setError('El nombre es obligatorio'); return }
    setSaving(true)
    setError(null)
    try {
      await onSave(tech.id, {
        name:    name.trim(),
        phone:   phone.trim()   || null,
        client:  client.trim()  || null,
        project: project.trim() || null,
        country: country                          || null,
        city:    city                             || null,
        shift:   buildShift(shiftStart, shiftEnd) ?? null,
        notes:   notes.trim()   || null,
      })
      onClose()
    } catch (err: any) {
      setError(err.message ?? 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }} />
      <div
        style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: '520px', margin: '0 16px', maxHeight: '90vh', overflowY: 'auto' }}
        className="bg-surface border border-border-soft rounded-2xl shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border-soft sticky top-0 bg-surface rounded-t-2xl z-10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Edit2 className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="font-bold text-text-primary text-sm leading-none">Editar técnico</p>
              <p className="text-xs text-text-muted mt-0.5">{tech.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors rounded-lg p-1.5 hover:bg-surface-raised">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Datos básicos */}
          <div>
            <SectionLabel color="bg-primary" label="Datos del técnico" />
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <FieldLabel label="Nombre completo" required />
                <input type="text" value={name} onChange={e => setName(e.target.value)}
                  placeholder="Carlos Ramírez" className={inputCls} />
              </div>
              <div>
                <FieldLabel label="Teléfono" />
                <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                  placeholder="+504 9999-0001" className={inputCls} />
              </div>
              <div>
                <FieldLabel label="País" />
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
                  <select value={country} onChange={e => handleCountryChange(e.target.value)}
                    className={cn(inputCls, 'pl-8 appearance-none cursor-pointer')}>
                    <option value="">Sin especificar</option>
                    {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              {/* Ciudad — aparece solo cuando hay país seleccionado */}
              {country && (
                <div className="col-span-2">
                  <FieldLabel label="Ciudad" />
                  <div className="relative">
                    <Navigation className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
                    <select value={city} onChange={e => setCity(e.target.value)}
                      className={cn(inputCls, 'pl-8 appearance-none cursor-pointer')}>
                      <option value="">Seleccionar ciudad</option>
                      {cityOptions.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
              )}
              {/* Jornada */}
              <div className="col-span-2">
                <FieldLabel label="Horario de trabajo" />
                <div className="flex items-center gap-2">
                  <TimeSelect value={shiftStart} onChange={setShiftStart} placeholder="Inicio" className="flex-1" />
                  <span className="text-text-muted text-xs font-medium flex-shrink-0">hasta</span>
                  <TimeSelect value={shiftEnd} onChange={setShiftEnd} placeholder="Fin" className="flex-1" />
                </div>
              </div>
            </div>
          </div>

          {/* Organización */}
          <div>
            <SectionLabel color="bg-accent" label="Organización" />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel label="Cliente / Empresa" />
                <div className="relative">
                  <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
                  <input type="text" value={client} onChange={e => setClient(e.target.value)}
                    placeholder="Empresa ABC" className={cn(inputCls, 'pl-8')} />
                </div>
              </div>
              <div>
                <FieldLabel label="Proyecto" />
                <div className="relative">
                  <FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
                  <input type="text" value={project} onChange={e => setProject(e.target.value)}
                    placeholder="Instalación Zona Norte" className={cn(inputCls, 'pl-8')} />
                </div>
              </div>
            </div>
          </div>

          {/* Notas */}
          <div>
            <SectionLabel color="bg-warning" label="Notas" optional />
            <div className="relative">
              <FileText className="absolute left-3 top-3 w-3.5 h-3.5 text-text-muted pointer-events-none" />
              <textarea value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Información adicional…"
                rows={2} className={cn(inputCls, 'pl-8 resize-none leading-relaxed')} />
            </div>
          </div>

          {error && (
            <div className="bg-danger/10 border border-danger/30 text-danger text-xs rounded-xl px-3 py-2.5">{error}</div>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={onClose}
              className="flex-1 border border-border-soft text-text-secondary hover:text-text-primary text-sm font-medium rounded-xl py-2.5 transition-colors hover:bg-surface-raised">
              Cancelar
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex-1 bg-primary hover:bg-primary-hover text-base font-semibold text-sm rounded-xl py-2.5 transition-colors flex items-center justify-center gap-2 disabled:opacity-60">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function TechnicianManagement() {
  const [techs, setTechs]           = useState<Technician[]>([])
  const [statuses, setStatuses]     = useState<Record<string, TechStatus>>({})
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [editTech, setEditTech]     = useState<Technician | null>(null)
  const [qrTech, setQrTech]         = useState<{ id: string; name: string } | null>(null)

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
          .select('id, name, phone, client, project, country, city, shift, notes, device_id, active, created_at')
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

  const activeFilters = [filterCountry, filterClient, filterProject].filter(Boolean).length

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
        <div className="text-center py-16 text-text-muted text-sm">
          {techs.length === 0 ? 'No hay técnicos registrados' : 'Sin resultados para los filtros aplicados'}
        </div>
      ) : (
        <div className="bg-surface border border-border-soft rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-soft bg-base/50">
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

                  return (
                    <tr key={tech.id} className={cn(
                      'border-b border-border-soft/60 last:border-0 transition-colors hover:bg-surface-raised/50',
                      !tech.active && 'opacity-50',
                    )}>
                      {/* Name / Phone */}
                      <td className="px-4 py-3">
                        <p className="text-text-primary text-xs font-semibold">{tech.name}</p>
                        {tech.phone && <p className="text-text-muted text-xs">{tech.phone}</p>}
                        {!tech.active && <span className="text-xs text-warning font-medium">Desactivado</span>}
                      </td>

                      {/* Country / City / Shift / Client / Project */}
                      <td className="px-4 py-3 max-w-[200px]">
                        {(tech.country || tech.city) && (
                          <div className="flex items-center gap-1 text-xs text-text-secondary mb-0.5">
                            <MapPin className="w-3 h-3 text-text-muted flex-shrink-0" />
                            <span className="truncate">
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
                          <div className="flex items-center gap-1 text-xs text-text-muted">
                            <Building2 className="w-3 h-3 flex-shrink-0" />
                            <span className="truncate">{tech.client}</span>
                          </div>
                        )}
                        {tech.project && (
                          <div className="flex items-center gap-1 text-xs text-text-muted">
                            <FolderOpen className="w-3 h-3 flex-shrink-0" />
                            <span className="truncate">{tech.project}</span>
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
        <TechnicianRegistrationModal
          open={!!qrTech}
          onOpenChange={open => { if (!open) setQrTech(null) }}
          existingTechnician={qrTech}
        />
      )}

      {editTech && (
        <EditModal
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
