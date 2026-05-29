import { useEffect, useState } from 'react'
import { Users, Sun, RefreshCw, Sunset, Wifi, CheckCircle2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { getLeaderScope } from '@/lib/leaderContext'

interface TechRouteRow {
  id: string
  technician_name: string
  technician_cedula: string | null
  technician_id: string | null
  am_count: number
  pm_count: number
  total: number
  done: number
  techStatus: string
}

function StatCard({ icon: Icon, label, value, color, sub }: {
  icon: React.ElementType
  label: string
  value: number | string
  color: string
  sub?: string
}) {
  return (
    <div className="bg-surface border border-border-soft rounded-2xl p-5 flex items-start gap-4">
      <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', color)}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-text-muted text-xs">{label}</p>
        <p className="text-text-primary text-2xl font-bold mt-0.5">{value}</p>
        {sub && <p className="text-text-muted text-xs mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

export function LeaderStats() {
  const [routes, setRoutes] = useState<TechRouteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const today = format(new Date(), 'yyyy-MM-dd')
  const todayLabel = format(new Date(), "EEEE d 'de' MMMM yyyy", { locale: es })

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const { allTechnicianIds } = await getLeaderScope()
      if (allTechnicianIds.length === 0) { setRoutes([]); setLoading(false); return }

      const { data: routesData, error: routesError } = await supabase
        .from('technician_routes')
        .select(`id, technician_name, technician_cedula, technician_id, route_items(franja, status)`)
        .eq('route_date', today)
        .in('technician_id', allTechnicianIds)
        .order('technician_name')

      if (routesError) throw routesError

      const techIds = (routesData ?? []).map(r => r.technician_id).filter(Boolean) as string[]
      let statusMap = new Map<string, string>()
      if (techIds.length > 0) {
        const { data: statuses } = await supabase
          .from('technician_current_status')
          .select('id, status')
          .in('id', techIds)
        statusMap = new Map(statuses?.map(s => [s.id, s.status]) ?? [])
      }

      setRoutes((routesData ?? []).map(r => {
        const items = r.route_items as Array<{ franja: string; status: string }>
        return {
          id: r.id,
          technician_name: r.technician_name,
          technician_cedula: r.technician_cedula,
          technician_id: r.technician_id,
          am_count: items.filter(i => i.franja === 'AM').length,
          pm_count: items.filter(i => i.franja === 'PM').length,
          total: items.length,
          done: items.filter(i => i.status === 'completed').length,
          techStatus: r.technician_id ? (statusMap.get(r.technician_id) ?? 'offline') : 'offline',
        }
      }))
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const totalAM        = routes.reduce((s, r) => s + r.am_count, 0)
  const totalPM        = routes.reduce((s, r) => s + r.pm_count, 0)
  const totalAssigned  = routes.reduce((s, r) => s + r.total, 0)
  const totalDone      = routes.reduce((s, r) => s + r.done, 0)
  const completionPct  = totalAssigned > 0 ? Math.round((totalDone / totalAssigned) * 100) : null
  const onlineTechs    = routes.filter(r => r.techStatus !== 'offline').length

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-20">
        <p className="text-danger text-sm">{error}</p>
        <button onClick={load} className="text-xs text-text-muted hover:text-text-primary flex items-center gap-1.5 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> Reintentar
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-text-primary font-semibold text-base">Resumen del día</h2>
          <p className="text-text-muted text-xs capitalize mt-0.5">{todayLabel}</p>
        </div>
        <button onClick={load} className="text-text-muted hover:text-text-primary transition-colors" title="Actualizar">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <StatCard icon={Users} label="Técnicos con ruta hoy" value={routes.length} color="bg-primary/10 text-primary" />
        <StatCard icon={Wifi} label="Técnicos en campo" value={onlineTechs} color="bg-success/10 text-success" sub={`de ${routes.length} programados`} />
        <StatCard icon={Sun} label="Instalaciones AM" value={totalAM} color="bg-warning/10 text-warning" />
        <StatCard icon={Sunset} label="Instalaciones PM" value={totalPM} color="bg-primary/10 text-primary" />
        <StatCard
          icon={CheckCircle2}
          label="Completadas hoy"
          value={completionPct !== null ? `${completionPct}%` : '—'}
          color="bg-success/10 text-success"
          sub={totalAssigned > 0 ? `${totalDone} de ${totalAssigned}` : undefined}
        />
      </div>

      {routes.length === 0 ? (
        <div className="bg-surface border border-border-soft rounded-2xl p-12 text-center">
          <div className="w-12 h-12 rounded-xl bg-surface-raised flex items-center justify-center mx-auto mb-4">
            <Users className="w-6 h-6 text-text-muted" />
          </div>
          <p className="text-text-primary font-medium">No hay rutas cargadas para hoy</p>
          <p className="text-text-muted text-xs mt-1">Ve a "Cargar Rutas" para subir el Excel de asignaciones.</p>
        </div>
      ) : (
        <div className="bg-surface border border-border-soft rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border-soft flex items-center justify-between">
            <h3 className="text-text-primary text-sm font-semibold">Técnicos de hoy</h3>
            <span className="text-text-muted text-xs">{routes.length} técnicos · {totalAM + totalPM} instalaciones</span>
            {completionPct !== null && (
              <span className="text-xs text-success font-medium">{completionPct}% completo</span>
            )}
          </div>
          <div className="divide-y divide-border-soft">
            {routes.map(route => (
              <div key={route.id} className="px-4 py-3.5 flex items-center gap-3">
                <div className={cn(
                  'w-2 h-2 rounded-full flex-shrink-0',
                  route.techStatus === 'moving'  ? 'bg-success animate-pulse' :
                  route.techStatus === 'idle'    ? 'bg-warning' :
                  route.techStatus === 'stopped' ? 'bg-text-muted' :
                  'bg-border'
                )} />
                <div className="flex-1 min-w-0">
                  <p className="text-text-primary text-sm font-medium truncate">{route.technician_name}</p>
                  {route.technician_cedula && (
                    <p className="text-text-muted text-xs">Cédula: {route.technician_cedula}</p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {route.am_count > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-warning/10 text-warning border border-warning/20">
                      {route.am_count} AM
                    </span>
                  )}
                  {route.pm_count > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                      {route.pm_count} PM
                    </span>
                  )}
                  {route.total > 0 && (
                    <span className={cn(
                      'text-xs px-2 py-0.5 rounded-full border',
                      route.done === route.total
                        ? 'bg-success/10 text-success border-success/20'
                        : 'bg-surface-raised text-text-muted border-border'
                    )}>
                      {Math.round((route.done / route.total) * 100)}%
                    </span>
                  )}
                </div>
                <span className={cn(
                  'text-xs px-2 py-0.5 rounded-full border flex-shrink-0',
                  route.techStatus === 'moving'  ? 'bg-success/10 text-success border-success/20' :
                  route.techStatus === 'idle'    ? 'bg-warning/10 text-warning border-warning/20' :
                  route.techStatus === 'stopped' ? 'bg-text-muted/10 text-text-muted border-border' :
                  'bg-surface-raised text-text-muted border-border'
                )}>
                  {route.techStatus === 'moving'  ? 'En campo' :
                   route.techStatus === 'idle'    ? 'Inactivo' :
                   route.techStatus === 'stopped' ? 'Detenido' : 'Sin conexión'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
