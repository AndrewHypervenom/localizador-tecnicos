import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Plus, Trash2, RefreshCw, X, Building2, FolderOpen,
  Loader2, ChevronDown, ChevronRight, Pencil, Check, Users, Clock,
} from 'lucide-react'
import api from '@/lib/api'
import { cn } from '@/lib/utils'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'

interface CampaignRow { id: string; name: string; is_active: boolean }
interface CompanyRow {
  id: string
  name: string
  createdAt: string
  leaderId: string | null
  leaderEmail: string | null
  campaignCount: number
  activeCampaignCount: number
  technicianCount: number
  workStartHour: number
  workEndHour: number
  workSkipWeekends: boolean
  workTz: string
  campaigns: CampaignRow[]
}
interface Leader { id: string; email: string; role: string }

const inp = cn(
  'w-full bg-base border border-border-soft rounded-xl px-3 py-2.5 text-sm text-text-primary',
  'placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors'
)

// Zonas horarias comunes en LatAm (ampliable).
const TZ_OPTIONS = [
  'America/Bogota', 'America/Lima', 'America/Mexico_City', 'America/Santiago',
  'America/Argentina/Buenos_Aires', 'America/Caracas', 'America/Guayaquil',
  'America/La_Paz', 'America/Panama', 'America/Costa_Rica',
]

// ── Create/Edit modal ─────────────────────────────────────────────────────────
function CompanyModal({
  mode,
  company,
  leaders,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit'
  company?: CompanyRow
  leaders: Leader[]
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName]       = useState(company?.name ?? '')
  const [leaderId, setLeader] = useState(company?.leaderId ?? (leaders[0]?.id ?? ''))
  const [workStartHour, setWorkStartHour]       = useState(company?.workStartHour ?? 8)
  const [workEndHour, setWorkEndHour]           = useState(company?.workEndHour ?? 17)
  const [workSkipWeekends, setWorkSkipWeekends] = useState(company?.workSkipWeekends ?? true)
  const [workTz, setWorkTz]   = useState(company?.workTz ?? 'America/Bogota')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('El nombre es requerido'); return }
    setSaving(true); setError(null)
    try {
      const payload = { name, leaderId, workStartHour, workEndHour, workSkipWeekends, workTz }
      if (mode === 'create') {
        await api.post('/api/admin/companies', payload)
      } else {
        await api.patch(`/api/admin/companies/${company!.id}`, payload)
      }
      onSaved(); onClose()
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Error al guardar')
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
        style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: '440px', margin: '0 16px', maxHeight: '90vh', overflowY: 'auto' }}
        className="bg-surface border border-border-soft rounded-2xl shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border-soft sticky top-0 bg-surface rounded-t-2xl z-10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Building2 className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="font-bold text-text-primary text-sm leading-none">
                {mode === 'create' ? 'Nueva empresa' : 'Editar empresa'}
              </p>
              <p className="text-xs text-text-muted mt-0.5">
                {mode === 'create' ? 'Completa los datos de la empresa' : company?.name}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors rounded-lg p-1.5 hover:bg-surface-raised">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-4 bg-primary rounded-full" />
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Datos de la empresa</p>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-text-muted font-medium mb-1.5">
                  Nombre <span className="text-danger">*</span>
                </label>
                <input
                  type="text" value={name} onChange={e => setName(e.target.value)}
                  required autoFocus placeholder="Nombre de la empresa"
                  className={inp}
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted font-medium mb-1.5">
                  Líder asignado <span className="text-danger">*</span>
                </label>
                <div className="relative">
                  <select
                    value={leaderId} onChange={e => setLeader(e.target.value)}
                    required
                    className={cn(inp, 'appearance-none pr-8')}
                  >
                    <option value="">— Seleccionar líder —</option>
                    {leaders.map(l => (
                      <option key={l.id} value={l.id}>{l.email} ({l.role})</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
                </div>
              </div>
            </div>
          </div>

          {/* Horario de alertas: cuándo se generan "sin señal" y "batería baja". */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-4 bg-primary rounded-full" />
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Horario de alertas</p>
            </div>
            <p className="text-text-muted text-xs mb-3">
              Las alertas de "sin señal" y batería baja solo se generan dentro de este horario.
              Accidente y SOS siempre alertan, 24/7.
            </p>
            <div className="space-y-3">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="block text-xs text-text-muted font-medium mb-1.5">Desde</label>
                  <select value={workStartHour} onChange={e => setWorkStartHour(Number(e.target.value))} className={inp}>
                    {Array.from({ length: 25 }, (_, h) => (
                      <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-text-muted font-medium mb-1.5">Hasta</label>
                  <select value={workEndHour} onChange={e => setWorkEndHour(Number(e.target.value))} className={inp}>
                    {Array.from({ length: 25 }, (_, h) => (
                      <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                    ))}
                  </select>
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={workSkipWeekends}
                  onChange={e => setWorkSkipWeekends(e.target.checked)}
                  className="rounded border-border-soft"
                />
                <span className="text-sm text-text-secondary">No alertar sábados ni domingos</span>
              </label>
              <div>
                <label className="block text-xs text-text-muted font-medium mb-1.5">Zona horaria</label>
                <select value={workTz} onChange={e => setWorkTz(e.target.value)} className={inp}>
                  {TZ_OPTIONS.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              </div>
            </div>
          </div>

          {error && (
            <div className="bg-danger/10 border border-danger/30 text-danger text-xs rounded-xl px-3 py-2.5">{error}</div>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 border border-border-soft text-text-secondary hover:text-text-primary text-sm font-medium rounded-xl py-2.5 transition-colors hover:bg-surface-raised">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 bg-primary hover:bg-primary-hover text-base font-semibold text-sm rounded-xl py-2.5 transition-colors flex items-center justify-center gap-2 disabled:opacity-60">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {mode === 'create' ? 'Crear empresa' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export function CompaniesManagement() {
  const [companies, setCompanies]   = useState<CompanyRow[]>([])
  const [leaders, setLeaders]       = useState<Leader[]>([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [expanded, setExpanded]     = useState<Set<string>>(new Set())
  const [modalMode, setModalMode]   = useState<'create' | 'edit' | null>(null)
  const [editing, setEditing]       = useState<CompanyRow | undefined>(undefined)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  async function load() {
    setLoading(true); setError(null)
    try {
      const [{ data: cos }, { data: ldrs }] = await Promise.all([
        api.get<CompanyRow[]>('/api/admin/companies'),
        api.get<Leader[]>('/api/admin/leaders'),
      ])
      setCompanies(cos)
      setLeaders(ldrs)
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Error al cargar empresas')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleDelete(co: CompanyRow) {
    setDeletingId(co.id)
    try {
      await api.delete(`/api/admin/companies/${co.id}`)
      setCompanies(prev => prev.filter(c => c.id !== co.id))
      setConfirmDelete(null)
    } catch (err: any) {
      alert(err?.response?.data?.error ?? 'Error al eliminar')
    } finally {
      setDeletingId(null)
    }
  }

  const totalCampaigns    = companies.reduce((s, c) => s + c.campaignCount, 0)
  const totalTechnicians  = companies.reduce((s, c) => s + c.technicianCount, 0)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div>
          <h2 className="text-text-primary font-semibold text-sm">
            Empresas
            {!loading && <span className="text-text-muted font-normal ml-2">({companies.length})</span>}
          </h2>
          {!loading && companies.length > 0 && (
            <p className="text-text-muted text-xs mt-0.5">{totalCampaigns} campañas · {totalTechnicians} técnicos</p>
          )}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <button onClick={load} title="Actualizar" className="text-text-muted hover:text-text-primary transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => { setEditing(undefined); setModalMode('create') }}
            className="flex items-center gap-1.5 bg-primary hover:bg-primary/90 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Nueva empresa
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="bg-danger/10 border border-danger/30 text-danger text-sm rounded-xl px-4 py-3">{error}</div>
      ) : companies.length === 0 ? (
        <div className="text-center py-16 bg-surface border border-border-soft rounded-2xl">
          <Building2 className="w-10 h-10 text-text-muted/30 mx-auto mb-3" />
          <p className="text-text-primary font-medium text-sm">Sin empresas registradas</p>
          <p className="text-text-muted text-xs mt-1">Crea la primera empresa y asígnala a un líder.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {companies.map(co => {
            const isExpanded = expanded.has(co.id)
            const isDeleting = deletingId === co.id

            return (
              <div key={co.id} className="bg-surface border border-border-soft rounded-2xl overflow-hidden">
                {/* Company row */}
                <div className="flex items-center gap-3 px-4 py-4">
                  {/* Expand */}
                  <button
                    type="button"
                    onClick={() => toggleExpand(co.id)}
                    className="text-text-muted hover:text-text-primary transition-colors flex-shrink-0"
                  >
                    {isExpanded
                      ? <ChevronDown className="w-4 h-4" />
                      : <ChevronRight className="w-4 h-4" />}
                  </button>

                  {/* Icon */}
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-5 h-5 text-primary" />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-text-primary font-semibold text-sm truncate">{co.name}</p>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      {co.leaderEmail && (
                        <span className="text-text-muted text-xs truncate">{co.leaderEmail}</span>
                      )}
                      <span className="text-text-muted/50 text-xs">·</span>
                      <span className="text-xs text-text-muted">{co.campaignCount} campaña{co.campaignCount !== 1 ? 's' : ''}</span>
                      {co.technicianCount > 0 && (
                        <>
                          <span className="text-text-muted/50 text-xs">·</span>
                          <span className="text-xs text-text-muted flex items-center gap-1">
                            <Users className="w-3 h-3" />{co.technicianCount}
                          </span>
                        </>
                      )}
                      <span className="text-text-muted/50 text-xs">·</span>
                      <span className="text-xs text-text-muted flex items-center gap-1" title="Horario de alertas">
                        <Clock className="w-3 h-3" />
                        {String(co.workStartHour ?? 8).padStart(2, '0')}–{String(co.workEndHour ?? 17).padStart(2, '0')}h
                        {(co.workSkipWeekends ?? true) ? ' L–V' : ''}
                      </span>
                    </div>
                  </div>

                  {/* Date */}
                  <span className="text-text-muted/60 text-xs flex-shrink-0 hidden sm:inline">
                    {format(parseISO(co.createdAt), 'dd MMM yyyy', { locale: es })}
                  </span>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => { setEditing(co); setModalMode('edit') }}
                      className="p-1.5 text-text-muted hover:text-primary transition-colors rounded-lg hover:bg-primary/10"
                      title="Editar"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    {confirmDelete === co.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleDelete(co)}
                          disabled={isDeleting}
                          className="text-xs px-2 py-1 bg-danger text-white rounded-lg font-medium flex items-center gap-1"
                        >
                          {isDeleting ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                          Confirmar
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(null)}
                          className="text-xs px-2 py-1 border border-border-soft text-text-muted rounded-lg hover:bg-surface-raised"
                        >
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(co.id)}
                        className="p-1.5 text-text-muted hover:text-danger transition-colors rounded-lg hover:bg-danger/10"
                        title="Eliminar empresa"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded: campaigns */}
                {isExpanded && (
                  <div className="border-t border-border-soft bg-base/40">
                    {co.campaigns.length === 0 ? (
                      <div className="px-14 py-4 text-text-muted text-xs">Sin campañas aún.</div>
                    ) : (
                      <div className="divide-y divide-border-soft">
                        {co.campaigns.map(cp => (
                          <div key={cp.id} className="flex items-center gap-3 px-14 py-3">
                            <FolderOpen className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
                            <span className="text-text-primary text-xs flex-1">{cp.name}</span>
                            <span className={cn(
                              'text-xs px-2 py-0.5 rounded-full border flex-shrink-0',
                              cp.is_active
                                ? 'bg-success/10 text-success border-success/20'
                                : 'bg-surface-raised text-text-muted border-border'
                            )}>
                              {cp.is_active ? 'Activa' : 'Inactiva'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {modalMode && (
        <CompanyModal
          mode={modalMode}
          company={editing}
          leaders={leaders}
          onClose={() => { setModalMode(null); setEditing(undefined) }}
          onSaved={load}
        />
      )}
    </div>
  )
}
