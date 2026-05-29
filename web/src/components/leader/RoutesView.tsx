import { useState, useEffect, useCallback } from 'react'
import {
  ChevronDown, ChevronUp, Trash2, RefreshCw, X,
  Building2, FolderOpen, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { format, addDays, parseISO, isToday, isTomorrow, isYesterday } from 'date-fns'
import { es } from 'date-fns/locale'
import { toast } from 'sonner'
import { DateScroller, getWeekStart } from './DateScroller'
import { getLeaderScope } from '@/lib/leaderContext'

interface RouteItem {
  id: string
  franja: string | null; ciudad: string | null; cliente: string | null
  direccion: string | null; producto: string | null; hora_inicial: string | null
  ot_mer: string | null; estado_ot: string | null; order_index: number; status: string
}

interface TechRoute {
  id: string
  technician_name: string; technician_cedula: string | null; technician_id: string | null
  campaign_id: string | null; items: RouteItem[]; expanded: boolean; techStatus: string
}

interface Company  { id: string; name: string }
interface Campaign { id: string; name: string; company_id: string }

const ITEM_STATUSES = [
  { value: 'pending',     label: 'Pendiente',   cls: 'bg-surface-raised text-text-muted border-border'    },
  { value: 'in_progress', label: 'En progreso', cls: 'bg-warning/10 text-warning border-warning/20'       },
  { value: 'completed',   label: 'Completado',  cls: 'bg-success/10 text-success border-success/20'       },
  { value: 'failed',      label: 'No exitoso',  cls: 'bg-danger/10 text-danger border-danger/20'          },
]

function dayLabel(dateStr: string): string {
  const d = parseISO(dateStr)
  if (isToday(d))     return 'Hoy'
  if (isTomorrow(d))  return 'Mañana'
  if (isYesterday(d)) return 'Ayer'
  return format(d, "EEEE d 'de' MMMM", { locale: es })
}

export function RoutesView() {
  const today       = format(new Date(), 'yyyy-MM-dd')
  const [selectedDate, setSelectedDate] = useState(today)
  const [weekStart, setWeekStart]       = useState(getWeekStart(today))
  const [routes, setRoutes]             = useState<TechRoute[]>([])
  const [markedDates, setMarkedDates]   = useState<string[]>([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState<string | null>(null)
  const [editingItem, setEditingItem]   = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [companies, setCompanies]       = useState<Company[]>([])
  const [campaigns, setCampaigns]       = useState<Campaign[]>([])
  const [filterCampaign, setFilterCampaign] = useState('')

  // Load companies/campaigns once (scoped to the leader's companies)
  useEffect(() => {
    getLeaderScope().then(({ companyIds }) => {
      if (companyIds.length === 0) { setCompanies([]); setCampaigns([]); return }
      Promise.all([
        supabase.from('companies').select('id, name').in('id', companyIds).order('name'),
        supabase.from('campaigns').select('id, name, company_id').in('company_id', companyIds).order('name'),
      ]).then(([{ data: cos }, { data: cps }]) => {
        setCompanies(cos ?? [])
        setCampaigns(cps ?? [])
      })
    })
  }, [])

  // Load marked dates for the visible week (only the leader's technicians)
  useEffect(() => {
    const monday = parseISO(weekStart)
    const weekDates = Array.from({ length: 7 }, (_, i) => format(addDays(monday, i), 'yyyy-MM-dd'))
    getLeaderScope().then(({ allTechnicianIds }) => {
      if (allTechnicianIds.length === 0) { setMarkedDates([]); return }
      supabase
        .from('technician_routes')
        .select('route_date')
        .in('route_date', weekDates)
        .in('technician_id', allTechnicianIds)
        .then(({ data }) => {
          const unique = [...new Set(data?.map(r => r.route_date) ?? [])]
          setMarkedDates(unique)
        })
    })
  }, [weekStart])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const { allTechnicianIds } = await getLeaderScope()
      if (allTechnicianIds.length === 0) { setRoutes([]); setLoading(false); return }

      let q = supabase
        .from('technician_routes')
        .select(`id, technician_name, technician_cedula, technician_id, campaign_id,
          route_items(id, franja, ciudad, cliente, direccion, producto, hora_inicial, ot_mer, estado_ot, order_index, status)`)
        .eq('route_date', selectedDate)
        .in('technician_id', allTechnicianIds)
        .order('technician_name')

      if (filterCampaign) q = q.eq('campaign_id', filterCampaign)

      const { data, error } = await q
      if (error) throw error

      const techIds = (data ?? []).map(r => r.technician_id).filter(Boolean) as string[]
      let statusMap = new Map<string, string>()
      if (techIds.length > 0) {
        const { data: st } = await supabase.from('technician_current_status').select('id, status').in('id', techIds)
        statusMap = new Map(st?.map(s => [s.id, s.status]) ?? [])
      }

      setRoutes((data ?? []).map(r => ({
        id: r.id, technician_name: r.technician_name,
        technician_cedula: r.technician_cedula, technician_id: r.technician_id,
        campaign_id: r.campaign_id,
        items: [...(r.route_items as RouteItem[])].sort((a, b) => {
          if (a.franja === 'AM' && b.franja !== 'AM') return -1
          if (a.franja !== 'AM' && b.franja === 'AM') return 1
          return a.order_index - b.order_index
        }),
        expanded: false,
        techStatus: r.technician_id ? (statusMap.get(r.technician_id) ?? 'offline') : 'offline',
      })))
    } catch (err: any) { setError(err.message) }
    finally { setLoading(false) }
  }, [selectedDate, filterCampaign])

  useEffect(() => { load() }, [load])

  function handleDateChange(d: string) {
    setSelectedDate(d)
    setWeekStart(getWeekStart(d))
  }

  const toggleExpand = (id: string) =>
    setRoutes(prev => prev.map(r => r.id === id ? { ...r, expanded: !r.expanded } : r))

  async function updateStatus(itemId: string, newStatus: string) {
    const { error } = await supabase.from('route_items').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', itemId)
    if (error) { toast.error('Error al actualizar'); return }
    setRoutes(prev => prev.map(r => ({ ...r, items: r.items.map(i => i.id === itemId ? { ...i, status: newStatus } : i) })))
    setEditingItem(null)
  }

  async function deleteRoute(routeId: string) {
    const { error } = await supabase.from('technician_routes').delete().eq('id', routeId)
    if (error) { toast.error('Error al eliminar ruta'); return }
    setRoutes(prev => prev.filter(r => r.id !== routeId))
    setConfirmDelete(null); toast.success('Ruta eliminada')
  }

  async function deleteItem(routeId: string, itemId: string) {
    const { error } = await supabase.from('route_items').delete().eq('id', itemId)
    if (error) { toast.error('Error al eliminar instalación'); return }
    setRoutes(prev => prev.map(r => r.id !== routeId ? r : { ...r, items: r.items.filter(i => i.id !== itemId) }))
  }

  const totalItems = routes.reduce((s, r) => s + r.items.length, 0)
  const totalAM    = routes.reduce((s, r) => s + r.items.filter(i => i.franja === 'AM').length, 0)
  const totalPM    = routes.reduce((s, r) => s + r.items.filter(i => i.franja === 'PM').length, 0)
  const completed  = routes.reduce((s, r) => s + r.items.filter(i => i.status === 'completed').length, 0)

  // Grouped campaigns for filter
  const groupedCampaigns = companies.map(c => ({
    company: c,
    items: campaigns.filter(cp => cp.company_id === c.id),
  })).filter(g => g.items.length > 0)

  return (
    <div className="space-y-5">
      {/* DateScroller */}
      <DateScroller
        selected={selectedDate}
        onChange={handleDateChange}
        weekStart={weekStart}
        onWeekChange={setWeekStart}
        markedDates={markedDates}
      />

      {/* Quick nav + campaign filter */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => handleDateChange(format(new Date(), 'yyyy-MM-dd'))}
          className={cn('px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
            selectedDate === today ? 'bg-primary text-white border-primary' : 'border-border-soft text-text-secondary hover:text-text-primary hover:bg-surface'
          )}>Hoy</button>
        <button onClick={() => handleDateChange(format(addDays(new Date(), 1), 'yyyy-MM-dd'))}
          className={cn('px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
            selectedDate === format(addDays(new Date(), 1), 'yyyy-MM-dd') ? 'bg-primary text-white border-primary' : 'border-border-soft text-text-secondary hover:text-text-primary hover:bg-surface'
          )}>Mañana</button>

        {/* Campaign filter */}
        {groupedCampaigns.length > 0 && (
          <div className="relative ml-auto">
            <FolderOpen className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
            <select
              value={filterCampaign}
              onChange={e => setFilterCampaign(e.target.value)}
              className="pl-7 pr-7 py-1.5 bg-surface border border-border-soft rounded-lg text-xs text-text-primary focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 appearance-none"
            >
              <option value="">Todas las campañas</option>
              {groupedCampaigns.map(g => (
                <optgroup key={g.company.id} label={g.company.name}>
                  {g.items.map(cp => <option key={cp.id} value={cp.id}>{cp.name}</option>)}
                </optgroup>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted pointer-events-none" />
          </div>
        )}

        <button onClick={load} className={cn('p-1.5 text-text-muted hover:text-text-primary transition-colors', groupedCampaigns.length === 0 && 'ml-auto')} title="Actualizar">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Day header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-text-primary font-semibold capitalize">{dayLabel(selectedDate)}</p>
          {routes.length > 0 && (
            <p className="text-text-muted text-xs mt-0.5">{routes.length} técnicos · {totalItems} instalaciones</p>
          )}
        </div>
        {routes.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs px-2 py-0.5 rounded-full bg-warning/10 text-warning border border-warning/20">{totalAM} AM</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">{totalPM} PM</span>
            {completed > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-success/10 text-success border border-success/20">{completed} ✓</span>}
          </div>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 py-16">
          <p className="text-danger text-sm">{error}</p>
          <button onClick={load} className="text-xs text-text-muted hover:text-text-primary flex items-center gap-1.5 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> Reintentar
          </button>
        </div>
      ) : routes.length === 0 ? (
        <div className="bg-surface border border-border-soft rounded-2xl p-14 text-center">
          <div className="w-12 h-12 rounded-xl bg-surface-raised flex items-center justify-center mx-auto mb-4">
            <FolderOpen className="w-6 h-6 text-text-muted" />
          </div>
          <p className="text-text-primary font-medium">Sin rutas para este día</p>
          <p className="text-text-muted text-xs mt-1">
            {filterCampaign ? 'No hay rutas para esta campaña en esta fecha.' : 'Ve a "Cargar Rutas" para subir el Excel de asignaciones.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3 overflow-y-auto max-h-[60vh] pr-1">
          {routes.map(route => {
            const routeCampaign = campaigns.find(c => c.id === route.campaign_id)
            const routeCompany  = routeCampaign ? companies.find(c => c.id === routeCampaign.company_id) : null
            return (
              <div key={route.id} className="bg-surface border border-border-soft rounded-2xl overflow-hidden">
                {/* Route header */}
                <div
                  className="flex items-center gap-3 px-4 py-3.5 cursor-pointer select-none hover:bg-surface-raised transition-colors"
                  onClick={() => toggleExpand(route.id)}
                >
                  <div className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0',
                    route.techStatus === 'moving'  ? 'bg-success animate-pulse' :
                    route.techStatus === 'idle'    ? 'bg-warning' :
                    route.techStatus === 'stopped' ? 'bg-text-muted' : 'bg-border'
                  )} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-text-primary text-sm font-semibold truncate">{route.technician_name}</p>
                      {!route.technician_id && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-warning/10 text-warning border border-warning/20 flex-shrink-0">Sin vincular</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap mt-0.5">
                      {route.technician_cedula && <span className="text-text-muted text-xs">Cédula {route.technician_cedula}</span>}
                      {routeCompany && <span className="text-text-muted/60 text-xs">· {routeCompany.name}</span>}
                      {routeCampaign && <span className="text-primary/70 text-xs">· {routeCampaign.name}</span>}
                    </div>
                  </div>

                  <div className="hidden sm:flex items-center gap-1.5 flex-shrink-0">
                    {route.items.filter(i => i.franja === 'AM').length > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-warning/10 text-warning border border-warning/20">
                        {route.items.filter(i => i.franja === 'AM').length} AM
                      </span>
                    )}
                    {route.items.filter(i => i.franja === 'PM').length > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                        {route.items.filter(i => i.franja === 'PM').length} PM
                      </span>
                    )}
                    {route.items.filter(i => i.status === 'completed').length > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-success/10 text-success border border-success/20">
                        {route.items.filter(i => i.status === 'completed').length} ✓
                      </span>
                    )}
                  </div>

                  <span className={cn('text-xs px-2 py-0.5 rounded-full border flex-shrink-0 hidden md:inline-flex',
                    route.techStatus === 'moving'  ? 'bg-success/10 text-success border-success/20' :
                    route.techStatus === 'idle'    ? 'bg-warning/10 text-warning border-warning/20' :
                    route.techStatus === 'stopped' ? 'bg-text-muted/10 text-text-muted border-border' :
                    'bg-surface-raised text-text-muted border-border'
                  )}>
                    {route.techStatus === 'moving' ? 'En campo' : route.techStatus === 'idle' ? 'Inactivo' : route.techStatus === 'stopped' ? 'Detenido' : 'Sin conexión'}
                  </span>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    {confirmDelete === route.id ? (
                      <>
                        <button type="button" onClick={e => { e.stopPropagation(); deleteRoute(route.id) }}
                          className="text-xs px-2 py-1 bg-danger text-white rounded-lg font-medium">Eliminar</button>
                        <button type="button" onClick={e => { e.stopPropagation(); setConfirmDelete(null) }}
                          className="text-xs px-2 py-1 border border-border-soft text-text-muted rounded-lg hover:bg-surface">Cancelar</button>
                      </>
                    ) : (
                      <button type="button" onClick={e => { e.stopPropagation(); setConfirmDelete(route.id) }}
                        className="p-1.5 text-text-muted hover:text-danger transition-colors rounded-lg hover:bg-danger/10" title="Eliminar ruta">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {route.expanded ? <ChevronUp className="w-4 h-4 text-text-muted" /> : <ChevronDown className="w-4 h-4 text-text-muted" />}
                  </div>
                </div>

                {/* Items */}
                {route.expanded && (
                  <div className="border-t border-border-soft divide-y divide-border-soft">
                    {route.items.map(item => {
                      const statusCfg = ITEM_STATUSES.find(s => s.value === item.status) ?? ITEM_STATUSES[0]
                      return (
                        <div key={item.id} className="flex items-start gap-3 px-4 py-3 text-xs">
                          <span className={cn('mt-0.5 px-2 py-0.5 rounded-md font-semibold flex-shrink-0',
                            item.franja === 'AM' ? 'bg-warning/10 text-warning' : 'bg-primary/10 text-primary'
                          )}>{item.franja ?? '—'}</span>

                          <div className="flex-1 min-w-0">
                            <p className="text-text-primary font-medium truncate">{item.cliente ?? '—'}</p>
                            <p className="text-text-muted truncate">{item.direccion ?? '—'}</p>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              {item.ciudad    && <span className="text-text-muted/60">{item.ciudad}</span>}
                              {item.hora_inicial && <span className="text-text-muted/60">· {item.hora_inicial}</span>}
                              {item.ot_mer    && <span className="text-text-muted/60 font-mono">· {item.ot_mer}</span>}
                              {item.producto  && <span className="text-text-muted/60">· {item.producto}</span>}
                            </div>
                          </div>

                          <div className="flex-shrink-0">
                            {editingItem === item.id ? (
                              <div className="flex flex-col gap-1">
                                {ITEM_STATUSES.map(opt => (
                                  <button key={opt.value} type="button" onClick={() => updateStatus(item.id, opt.value)}
                                    className={cn('px-2 py-0.5 rounded border text-xs text-left hover:opacity-80 transition-opacity', opt.cls)}>
                                    {opt.label}
                                  </button>
                                ))}
                                <button type="button" onClick={() => setEditingItem(null)}
                                  className="px-2 py-0.5 rounded border border-border text-text-muted text-xs">
                                  Cancelar
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1">
                                <button type="button" onClick={() => setEditingItem(item.id)}
                                  className={cn('px-2 py-0.5 rounded-md border text-xs cursor-pointer hover:opacity-80 transition-opacity', statusCfg.cls)}
                                  title="Cambiar estado">
                                  {statusCfg.label}
                                </button>
                                <button type="button" onClick={() => deleteItem(route.id, item.id)}
                                  className="p-1 text-text-muted hover:text-danger transition-colors rounded" title="Eliminar">
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
