import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Plus, Trash2, RefreshCw, Building2, FolderOpen,
  ChevronRight, ChevronDown, Loader2, Check, X, Pencil,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'

interface Campaign {
  id: string; name: string; description: string | null
  start_date: string | null; end_date: string | null
  is_active: boolean; created_at: string
}

interface Company {
  id: string; name: string; created_at: string
  campaigns: Campaign[]
}

const inp = cn(
  'w-full bg-base border border-border-soft rounded-xl px-3 py-2.5 text-sm text-text-primary',
  'placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors'
)

// ── Inline edit field ─────────────────────────────────────────────────────────
function InlineEdit({ value, onSave, onCancel }: {
  value: string
  onSave: (v: string) => void
  onCancel: () => void
}) {
  const [v, setV] = useState(value)
  return (
    <div className="flex items-center gap-2 flex-1">
      <input
        autoFocus type="text" value={v} onChange={e => setV(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') onSave(v); if (e.key === 'Escape') onCancel() }}
        className="flex-1 bg-base border border-primary/40 rounded-lg px-2.5 py-1 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
      />
      <button type="button" onClick={() => onSave(v)}
        className="p-1 text-success hover:bg-success/10 rounded-lg transition-colors">
        <Check className="w-3.5 h-3.5" />
      </button>
      <button type="button" onClick={onCancel}
        className="p-1 text-text-muted hover:bg-surface-raised rounded-lg transition-colors">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// ── Company Modal ─────────────────────────────────────────────────────────────
function CompanyModal({ onClose, onCreated }: {
  onClose: () => void
  onCreated: (co: Company) => void
}) {
  const [name, setName]     = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('El nombre es requerido'); return }
    setSaving(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const { data, error: err } = await supabase.from('companies')
        .insert({ name: name.trim(), created_by: session?.user?.id })
        .select('id, name, created_at').single()
      if (err) throw err
      onCreated({ ...data, campaigns: [] })
      toast.success('Empresa creada')
    } catch (err: any) {
      setError(err.message ?? 'Error al crear empresa')
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
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border-soft sticky top-0 bg-surface rounded-t-2xl z-10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Building2 className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="font-bold text-text-primary text-sm leading-none">Nueva empresa</p>
              <p className="text-xs text-text-muted mt-0.5">Empresa o cliente contratante</p>
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
            <div>
              <label className="block text-xs text-text-muted font-medium mb-1.5">
                Nombre <span className="text-danger">*</span>
              </label>
              <input
                type="text" value={name} onChange={e => setName(e.target.value)}
                required autoFocus placeholder="Empresa ABC"
                className={inp}
              />
            </div>
          </div>
          {error && <div className="bg-danger/10 border border-danger/30 text-danger text-xs rounded-xl px-3 py-2.5">{error}</div>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 border border-border-soft text-text-secondary hover:text-text-primary text-sm font-medium rounded-xl py-2.5 transition-colors hover:bg-surface-raised">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 bg-primary hover:bg-primary-hover text-base font-semibold text-sm rounded-xl py-2.5 transition-colors flex items-center justify-center gap-2 disabled:opacity-60">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Crear empresa
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}

// ── Campaign Modal ────────────────────────────────────────────────────────────
function CampaignModal({ companyId, companyName, onClose, onCreated }: {
  companyId: string
  companyName: string
  onClose: () => void
  onCreated: (cp: Campaign) => void
}) {
  const [name, setName]       = useState('')
  const [startDate, setStart] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [endDate, setEnd]     = useState('')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('El nombre es requerido'); return }
    setSaving(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const { data, error: err } = await supabase.from('campaigns').insert({
        name: name.trim(), company_id: companyId, is_active: true,
        start_date: startDate || null, end_date: endDate || null,
        created_by: session?.user?.id,
      }).select('id, name, description, start_date, end_date, is_active, created_at').single()
      if (err) throw err
      onCreated(data as Campaign)
      toast.success('Campaña creada')
    } catch (err: any) {
      setError(err.message ?? 'Error al crear campaña')
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
        style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: '460px', margin: '0 16px', maxHeight: '90vh', overflowY: 'auto' }}
        className="bg-surface border border-border-soft rounded-2xl shadow-2xl"
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border-soft sticky top-0 bg-surface rounded-t-2xl z-10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
              <FolderOpen className="w-4 h-4 text-accent" />
            </div>
            <div>
              <p className="font-bold text-text-primary text-sm leading-none">Nueva campaña</p>
              <p className="text-xs text-text-muted mt-0.5">{companyName}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors rounded-lg p-1.5 hover:bg-surface-raised">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-4 bg-accent rounded-full" />
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Datos de la campaña</p>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-text-muted font-medium mb-1.5">
                  Nombre <span className="text-danger">*</span>
                </label>
                <input
                  type="text" value={name} onChange={e => setName(e.target.value)}
                  required autoFocus placeholder="Instalación Zona Norte"
                  className={inp}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-text-muted font-medium mb-1.5">Fecha inicio</label>
                  <input type="date" value={startDate} onChange={e => setStart(e.target.value)} className={inp} />
                </div>
                <div>
                  <label className="block text-xs text-text-muted font-medium mb-1.5">
                    Fecha fin <span className="text-text-muted/60 font-normal">(opcional)</span>
                  </label>
                  <input type="date" value={endDate} onChange={e => setEnd(e.target.value)} className={inp} />
                </div>
              </div>
            </div>
          </div>
          {error && <div className="bg-danger/10 border border-danger/30 text-danger text-xs rounded-xl px-3 py-2.5">{error}</div>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 border border-border-soft text-text-secondary hover:text-text-primary text-sm font-medium rounded-xl py-2.5 transition-colors hover:bg-surface-raised">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 bg-primary hover:bg-primary-hover text-base font-semibold text-sm rounded-xl py-2.5 transition-colors flex items-center justify-center gap-2 disabled:opacity-60">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Crear campaña
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export function LeaderCampaigns() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading]     = useState(true)
  const [expanded, setExpanded]   = useState<Set<string>>(new Set())

  const [editingCompany, setEditingCompany]   = useState<string | null>(null)
  const [editingCampaign, setEditingCampaign] = useState<string | null>(null)

  const [companyModalOpen, setCompanyModalOpen] = useState(false)
  const [campaignModalFor, setCampaignModalFor] = useState<{ id: string; name: string } | null>(null)

  const [confirmDeleteCo, setConfirmDeleteCo] = useState<string | null>(null)
  const [confirmDeleteCp, setConfirmDeleteCp] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const [{ data: cos }, { data: cps }] = await Promise.all([
        supabase.from('companies').select('id, name, created_at').order('created_at'),
        supabase.from('campaigns').select('id, name, description, start_date, end_date, is_active, created_at, company_id').order('created_at'),
      ])
      setCompanies((cos ?? []).map(c => ({
        ...c,
        campaigns: (cps ?? []).filter(cp => cp.company_id === c.id),
      })))
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function toggleExpand(id: string) {
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  async function renameCompany(id: string, name: string) {
    if (!name.trim()) { setEditingCompany(null); return }
    const { error } = await supabase.from('companies').update({ name: name.trim() }).eq('id', id)
    if (error) { toast.error(error.message); return }
    setCompanies(prev => prev.map(c => c.id === id ? { ...c, name: name.trim() } : c))
    setEditingCompany(null)
    toast.success('Empresa actualizada')
  }

  async function deleteCompany(id: string) {
    const { error } = await supabase.from('companies').delete().eq('id', id)
    if (error) { toast.error(error.message); return }
    setCompanies(prev => prev.filter(c => c.id !== id))
    setConfirmDeleteCo(null)
    toast.success('Empresa eliminada')
  }

  async function renameCampaign(companyId: string, id: string, name: string) {
    if (!name.trim()) { setEditingCampaign(null); return }
    const { error } = await supabase.from('campaigns').update({ name: name.trim() }).eq('id', id)
    if (error) { toast.error(error.message); return }
    setCompanies(prev => prev.map(c => c.id !== companyId ? c : {
      ...c, campaigns: c.campaigns.map(cp => cp.id === id ? { ...cp, name: name.trim() } : cp),
    }))
    setEditingCampaign(null)
    toast.success('Campaña actualizada')
  }

  async function deleteCampaign(companyId: string, id: string) {
    const { error } = await supabase.from('campaigns').delete().eq('id', id)
    if (error) { toast.error(error.message); return }
    setCompanies(prev => prev.map(c => c.id !== companyId ? c : {
      ...c, campaigns: c.campaigns.filter(cp => cp.id !== id),
    }))
    setConfirmDeleteCp(null)
    toast.success('Campaña eliminada')
  }

  const totalCampaigns  = companies.reduce((s, c) => s + c.campaigns.length, 0)
  const activeCampaigns = companies.reduce((s, c) => s + c.campaigns.filter(cp => cp.is_active).length, 0)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div>
          <h2 className="text-text-primary font-semibold text-sm">
            Empresas y Campañas
            {!loading && <span className="text-text-muted font-normal ml-2">({companies.length} empresas)</span>}
          </h2>
          {!loading && totalCampaigns > 0 && (
            <p className="text-text-muted text-xs mt-0.5">{activeCampaigns} campañas activas de {totalCampaigns}</p>
          )}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <button onClick={load} title="Actualizar" className="text-text-muted hover:text-text-primary transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setCompanyModalOpen(true)}
            className="flex items-center gap-1.5 bg-primary hover:bg-primary-hover text-base text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Nueva empresa
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : companies.length === 0 ? (
        <div className="text-center py-16 bg-surface border border-border-soft rounded-2xl">
          <Building2 className="w-10 h-10 text-text-muted/30 mx-auto mb-3" />
          <p className="text-text-primary font-medium text-sm">Sin empresas aún</p>
          <p className="text-text-muted text-xs mt-1">Crea tu primera empresa para organizar las campañas.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {companies.map(co => {
            const isExpanded = expanded.has(co.id)
            return (
              <div key={co.id} className="bg-surface border border-border-soft rounded-2xl overflow-hidden">
                {/* Company header */}
                <div className="flex items-center gap-3 px-4 py-3.5">
                  <button type="button" onClick={() => toggleExpand(co.id)}
                    className="text-text-muted hover:text-text-primary transition-colors flex-shrink-0">
                    {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>

                  <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-4 h-4 text-primary" />
                  </div>

                  {editingCompany === co.id ? (
                    <InlineEdit
                      value={co.name}
                      onSave={v => renameCompany(co.id, v)}
                      onCancel={() => setEditingCompany(null)}
                    />
                  ) : (
                    <>
                      <div className="flex-1 min-w-0">
                        <p className="text-text-primary font-semibold text-sm truncate">{co.name}</p>
                        <p className="text-text-muted text-xs mt-0.5">
                          {co.campaigns.length} campaña{co.campaigns.length !== 1 ? 's' : ''}
                          {co.campaigns.filter(c => c.is_active).length > 0 && (
                            <span className="text-success ml-1">
                              · {co.campaigns.filter(c => c.is_active).length} activa{co.campaigns.filter(c => c.is_active).length !== 1 ? 's' : ''}
                            </span>
                          )}
                        </p>
                      </div>

                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button type="button" onClick={() => setEditingCompany(co.id)}
                          className="p-1.5 text-text-muted hover:text-primary transition-colors rounded-lg hover:bg-primary/10" title="Renombrar">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {confirmDeleteCo === co.id ? (
                          <>
                            <button type="button" onClick={() => deleteCompany(co.id)}
                              className="text-xs px-2 py-1 bg-danger text-white rounded-lg font-medium">Confirmar</button>
                            <button type="button" onClick={() => setConfirmDeleteCo(null)}
                              className="text-xs px-2 py-1 border border-border-soft text-text-muted rounded-lg hover:bg-surface-raised">Cancelar</button>
                          </>
                        ) : (
                          <button type="button" onClick={() => setConfirmDeleteCo(co.id)}
                            className="p-1.5 text-text-muted hover:text-danger transition-colors rounded-lg hover:bg-danger/10" title="Eliminar empresa">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* Campaigns */}
                {isExpanded && (
                  <div className="border-t border-border-soft">
                    {co.campaigns.length === 0 ? (
                      <div className="px-14 py-3 text-text-muted text-xs">Sin campañas. Crea una abajo.</div>
                    ) : (
                      <div className="divide-y divide-border-soft">
                        {co.campaigns.map(cp => (
                          <div key={cp.id} className="flex items-center gap-3 px-4 py-3 pl-14">
                            <div className={cn('w-2 h-2 rounded-full flex-shrink-0',
                              cp.is_active ? 'bg-success' : 'bg-border'
                            )} />

                            {editingCampaign === cp.id ? (
                              <InlineEdit
                                value={cp.name}
                                onSave={v => renameCampaign(co.id, cp.id, v)}
                                onCancel={() => setEditingCampaign(null)}
                              />
                            ) : (
                              <>
                                <div className="flex-1 min-w-0">
                                  <p className="text-text-primary text-sm truncate">{cp.name}</p>
                                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                    {cp.start_date && (
                                      <span className="text-text-muted/60 text-xs">
                                        {format(parseISO(cp.start_date), 'd MMM yyyy', { locale: es })}
                                        {cp.end_date && ` → ${format(parseISO(cp.end_date), 'd MMM yyyy', { locale: es })}`}
                                      </span>
                                    )}
                                  </div>
                                </div>

                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                  <span className={cn('text-xs px-2 py-0.5 rounded-full border',
                                    cp.is_active
                                      ? 'bg-success/10 text-success border-success/20'
                                      : 'bg-surface-raised text-text-muted border-border'
                                  )}>
                                    {cp.is_active ? 'Activa' : 'Inactiva'}
                                  </span>
                                  <button type="button" onClick={() => setEditingCampaign(cp.id)}
                                    className="p-1 text-text-muted hover:text-primary transition-colors rounded" title="Renombrar">
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                  {confirmDeleteCp === cp.id ? (
                                    <>
                                      <button type="button" onClick={() => deleteCampaign(co.id, cp.id)}
                                        className="text-xs px-2 py-0.5 bg-danger text-white rounded font-medium">Eliminar</button>
                                      <button type="button" onClick={() => setConfirmDeleteCp(null)}
                                        className="text-xs px-2 py-0.5 border border-border-soft text-text-muted rounded hover:bg-surface-raised">Cancelar</button>
                                    </>
                                  ) : (
                                    <button type="button" onClick={() => setConfirmDeleteCp(cp.id)}
                                      className="p-1 text-text-muted hover:text-danger transition-colors rounded" title="Eliminar campaña">
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Add campaign button */}
                    <div className="px-4 py-2.5 border-t border-border-soft">
                      <button type="button"
                        onClick={() => { setCampaignModalFor({ id: co.id, name: co.name }); setExpanded(prev => new Set([...prev, co.id])) }}
                        className="flex items-center gap-1.5 text-xs text-text-muted hover:text-primary transition-colors px-2 py-1.5 rounded-lg hover:bg-primary/5">
                        <FolderOpen className="w-3.5 h-3.5" />
                        <Plus className="w-3 h-3" />
                        Nueva campaña
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {companyModalOpen && (
        <CompanyModal
          onClose={() => setCompanyModalOpen(false)}
          onCreated={co => {
            setCompanies(prev => [...prev, co])
            setExpanded(prev => new Set([...prev, co.id]))
            setCompanyModalOpen(false)
          }}
        />
      )}

      {campaignModalFor && (
        <CampaignModal
          companyId={campaignModalFor.id}
          companyName={campaignModalFor.name}
          onClose={() => setCampaignModalFor(null)}
          onCreated={cp => {
            setCompanies(prev => prev.map(c => c.id !== campaignModalFor.id ? c : { ...c, campaigns: [...c.campaigns, cp] }))
            setCampaignModalFor(null)
          }}
        />
      )}
    </div>
  )
}
