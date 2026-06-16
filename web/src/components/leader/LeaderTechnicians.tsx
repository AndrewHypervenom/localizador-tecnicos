import { useEffect, useState } from 'react'
import {
  RefreshCw, Search, X, Smartphone, WifiOff,
  Phone, Building2, FolderOpen, UserX, UserCheck, MapPin, Plus, Edit2, Home, QrCode,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { format, parseISO } from 'date-fns'
import { toast } from 'sonner'
import { TechnicianRegistrationModal } from '@/components/modals/TechnicianRegistrationModal'
import { TechnicianEditModal, type TechnicianEditable } from '@/components/modals/TechnicianEditModal'
import { QrCodeModal } from '@/components/modals/QrCodeModal'
import { getLeaderScope } from '@/lib/leaderContext'
import { useI18n, getDateLocale } from '@/lib/i18n/i18n'

type Tech = TechnicianEditable & {
  status?: string
  last_seen?: string | null
}

const STATUS_CFG: Record<string, { dot: string; labelKey: string; text: string }> = {
  moving:    { dot: 'bg-success animate-pulse', labelKey: 'status.moving',            text: 'text-success' },
  idle:      { dot: 'bg-warning',               labelKey: 'detail.inactive',         text: 'text-warning' },
  stopped:   { dot: 'bg-text-muted',            labelKey: 'zone.statusStopped',      text: 'text-text-muted' },
  // 'no_signal' = la app sigue viva (heartbeat fresco) pero sin punto GPS reciente:
  // típico al quedarse quieto (GPS a 30s + Doze en segundo plano). NO es desconexión.
  // Sin este caso caía al fallback 'offline' y se veía rojo "Sin conexión" en falso.
  no_signal: { dot: 'bg-amber-500',             labelKey: 'status.no_signal',        text: 'text-amber-500' },
  offline:   { dot: 'bg-danger',                labelKey: 'leaderStats.statusOffline', text: 'text-danger' },
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase()
}

export function LeaderTechnicians({ onViewOnMap }: { onViewOnMap?: (techId: string) => void } = {}) {
  const { t: tr, lang } = useI18n()
  const [techs, setTechs]       = useState<Tech[]>([])
  const [loading, setLoading]   = useState(true)
  const [query, setQuery]       = useState('')
  const [toggling, setToggling] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [editTech, setEditTech] = useState<Tech | null>(null)
  const [qrTech, setQrTech] = useState<{ id: string; name: string } | null>(null)

  async function load() {
    setLoading(true)
    try {
      const { companyIds } = await getLeaderScope()
      if (companyIds.length === 0) {
        setTechs([])
        setLoading(false)
        return
      }

      const { data: techData, error } = await supabase
        .from('technicians')
        .select('id, name, phone, email, client, project, country, city, shift, notes, device_id, company_id, active, created_at, home_address, home_lat, home_lng, home_radius')
        .in('company_id', companyIds)
        .order('name')
      if (error) throw error

      const ids = (techData ?? []).filter(t => t.active).map(t => t.id)
      let statusMap = new Map<string, { status: string; last_seen: string | null }>()
      if (ids.length > 0) {
        const { data: st } = await supabase
          .from('technician_current_status')
          .select('id, status, last_seen')
          .in('id', ids)
        statusMap = new Map(st?.map(s => [s.id, { status: s.status, last_seen: s.last_seen }]) ?? [])
      }

      setTechs((techData ?? []).map(t => ({
        ...t,
        status:    statusMap.get(t.id)?.status ?? 'offline',
        last_seen: statusMap.get(t.id)?.last_seen ?? null,
      })))
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function toggleActive(t: Tech) {
    setToggling(t.id)
    try {
      const { error } = await supabase
        .from('technicians')
        .update({ active: !t.active })
        .eq('id', t.id)
      if (error) throw error
      setTechs(prev => prev.map(x => x.id === t.id ? { ...x, active: !x.active } : x))
      toast.success(t.active ? tr('leaderTech.deactivated', { name: t.name }) : tr('leaderTech.activated', { name: t.name }))
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setToggling(null)
    }
  }

  async function handleSaveEdit(id: string, data: Partial<TechnicianEditable>) {
    const { error } = await supabase.from('technicians').update(data).eq('id', id)
    if (error) throw new Error(error.message)
    setTechs(prev => prev.map(t => t.id === id ? { ...t, ...data } : t))
    setEditTech(null)
    toast.success(tr('leaderTech.updated'))
  }

  const filtered = techs.filter(t =>
    !query || t.name.toLowerCase().includes(query.toLowerCase()) ||
    t.phone?.includes(query) || t.client?.toLowerCase().includes(query.toLowerCase())
  )

  const active   = filtered.filter(t => t.active)
  const inactive = filtered.filter(t => !t.active)
  const onField  = active.filter(t => t.status !== 'offline').length

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div>
          <h2 className="text-text-primary font-semibold text-sm">
            {tr('dashboard.technicians')}
            {!loading && <span className="text-text-muted font-normal ml-2">{tr('leaderTech.activeCount', { n: techs.filter(t => t.active).length })}</span>}
          </h2>
          {!loading && onField > 0 && (
            <p className="text-success text-xs mt-0.5">{tr('leaderTech.onFieldNow', { n: onField })}</p>
          )}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <button onClick={load} title={tr('common.refresh')} className="text-text-muted hover:text-text-primary transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 bg-primary hover:bg-primary-hover text-base text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> {tr('regTech.newTech')}
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
        <input
          type="text" value={query} onChange={e => setQuery(e.target.value)}
          placeholder={tr('leaderTech.searchPlaceholder')}
          className="w-full bg-surface border border-border-soft rounded-xl pl-8 pr-8 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors"
        />
        {query && (
          <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-surface border border-border-soft rounded-2xl space-y-3">
          <p className="text-text-muted text-sm">{query ? tr('leaderTech.noResults') : tr('leaderTech.noneRegistered')}</p>
          {!query && (
            <button
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-2 bg-primary hover:bg-primary-hover text-base text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
            >
              <Plus className="w-4 h-4" /> {tr('regTech.newTech')}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {/* Active technicians */}
          {active.length > 0 && (
            <div className="bg-surface border border-border-soft rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border-soft">
                <h3 className="text-text-primary text-xs font-semibold uppercase tracking-wider">{tr('leaderTech.activeGroup', { n: active.length })}</h3>
              </div>
              <div className="divide-y divide-border-soft">
                {active.map(t => {
                  const cfg = STATUS_CFG[t.status ?? 'offline'] ?? STATUS_CFG.offline
                  const isToggling = toggling === t.id
                  return (
                    <div key={t.id} className="flex items-center gap-3 px-4 py-3.5 hover:bg-surface-raised transition-colors">
                      {/* Avatar */}
                      <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 text-primary text-xs font-bold">
                        {initials(t.name)}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-text-primary text-sm font-semibold truncate">{t.name}</p>
                          <div className={cn('w-2 h-2 rounded-full flex-shrink-0', cfg.dot)} title={tr(cfg.labelKey)} />
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                          {t.phone && (
                            <span className="text-text-muted text-xs flex items-center gap-1">
                              <Phone className="w-3 h-3" />{t.phone}
                            </span>
                          )}
                          {t.client && (
                            <span className="text-text-muted text-xs flex items-center gap-1 truncate max-w-[120px]">
                              <Building2 className="w-3 h-3 flex-shrink-0" />{t.client}
                            </span>
                          )}
                          {t.project && (
                            <span className="text-text-muted text-xs flex items-center gap-1 truncate max-w-[100px]">
                              <FolderOpen className="w-3 h-3 flex-shrink-0" />{t.project}
                            </span>
                          )}
                        </div>
                        {t.last_seen && (
                          <p className="text-text-muted/50 text-xs mt-0.5">
                            {tr('leaderTech.last', { date: format(parseISO(t.last_seen), "d MMM HH:mm", { locale: getDateLocale(lang) }) })}
                          </p>
                        )}
                      </div>

                      {/* Device badge + acciones */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {t.device_id ? (
                          <span className="text-xs text-success flex items-center gap-1 bg-success/10 px-2 py-0.5 rounded-lg border border-success/20">
                            <Smartphone className="w-3 h-3" /> App
                          </span>
                        ) : (
                          <button
                            onClick={() => setQrTech({ id: t.id, name: t.name })}
                            title={tr('tech.generateQr')}
                            className="text-xs text-text-muted flex items-center gap-1 bg-surface-raised px-2 py-0.5 rounded-lg border border-border hover:border-primary hover:text-primary hover:bg-primary/10 transition-colors"
                          >
                            <QrCode className="w-3 h-3" /> {tr('leaderTech.noApp')}
                          </button>
                        )}
                        {t.device_id && (
                          <button
                            onClick={() => setQrTech({ id: t.id, name: t.name })}
                            title={tr('leaderTech.regenQrTitle')}
                            className="p-1.5 text-text-muted hover:text-primary transition-colors rounded-lg hover:bg-primary/10"
                          >
                            <QrCode className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {t.device_id && t.status !== 'offline' && onViewOnMap && (
                          <button
                            onClick={() => onViewOnMap(t.id)}
                            title={tr('leaderTech.viewOnMapLive')}
                            className="p-1.5 text-text-muted hover:text-primary transition-colors rounded-lg hover:bg-primary/10"
                          >
                            <MapPin className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {onViewOnMap && t.home_lat && t.home_lng && (
                          <button
                            onClick={() => onViewOnMap(t.id)}
                            title={tr('leaderTech.viewHomeOnMap')}
                            className="p-1.5 text-text-muted hover:text-success transition-colors rounded-lg hover:bg-success/10"
                          >
                            <Home className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => setEditTech(t)}
                          title={tr('detail.editTech')}
                          className="p-1.5 text-text-muted hover:text-primary transition-colors rounded-lg hover:bg-primary/10"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => toggleActive(t)}
                          disabled={isToggling}
                          title={tr('leaderTech.deactivate')}
                          className="p-1.5 text-text-muted hover:text-warning transition-colors rounded-lg hover:bg-warning/10 disabled:opacity-40"
                        >
                          <UserX className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Inactive technicians */}
          {inactive.length > 0 && (
            <div className="bg-surface border border-border-soft rounded-2xl overflow-hidden opacity-70">
              <div className="px-4 py-3 border-b border-border-soft">
                <h3 className="text-text-muted text-xs font-semibold uppercase tracking-wider">{tr('leaderTech.inactiveGroup', { n: inactive.length })}</h3>
              </div>
              <div className="divide-y divide-border-soft">
                {inactive.map(t => (
                  <div key={t.id} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-raised transition-colors">
                    <div className="w-9 h-9 rounded-xl bg-surface-raised flex items-center justify-center flex-shrink-0 text-text-muted text-xs font-bold">
                      {initials(t.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-text-muted text-sm truncate line-through">{t.name}</p>
                      {t.client && <p className="text-text-muted/50 text-xs">{t.client}</p>}
                    </div>
                    <div className="flex items-center gap-1">
                      {onViewOnMap && t.home_lat && t.home_lng && (
                        <button
                          onClick={() => onViewOnMap(t.id)}
                          title={tr('leaderTech.viewHomeOnMap')}
                          className="p-1.5 text-text-muted hover:text-success transition-colors rounded-lg hover:bg-success/10"
                        >
                          <Home className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => setEditTech(t)}
                        title="Editar técnico"
                        className="p-1.5 text-text-muted hover:text-primary transition-colors rounded-lg hover:bg-primary/10"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => toggleActive(t)}
                        disabled={toggling === t.id}
                        title={tr('leaderTech.reactivate')}
                        className="p-1.5 text-text-muted hover:text-success transition-colors rounded-lg hover:bg-success/10 disabled:opacity-40"
                      >
                        <UserCheck className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <TechnicianRegistrationModal
        open={createOpen}
        onOpenChange={open => { setCreateOpen(open); if (!open) load() }}
      />
      {editTech && (
        <TechnicianEditModal
          tech={editTech}
          onSave={handleSaveEdit}
          onClose={() => setEditTech(null)}
        />
      )}
      {qrTech && (
        <QrCodeModal
          tech={qrTech}
          onClose={() => { setQrTech(null); load() }}
        />
      )}
    </div>
  )
}
