import { useEffect, useState } from 'react'
import { Users, Sun, RefreshCw, Sunset, Wifi, CheckCircle2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'
import { getLeaderScope } from '@/lib/leaderContext'
import { describeStatus, type StatusSignals } from '@/lib/technicianStatus'
import { StatusLegend } from '@/components/ui/StatusLegend'
import { useI18n, getDateLocale } from '@/lib/i18n/i18n'

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
  /** Señales crudas para explicar el color; el descriptor se arma al renderizar
   *  para que el "hace X min" no se congele con el resultado de la consulta. */
  signals: StatusSignals
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
  const { t, lang } = useI18n()
  const [routes, setRoutes] = useState<TechRouteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const today = format(new Date(), 'yyyy-MM-dd')
  const todayLabel = format(new Date(), "EEEE d 'de' MMMM yyyy", { locale: getDateLocale(lang) })

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
      let statusMap = new Map<string, any>()
      let hbMap     = new Map<string, any>()
      if (techIds.length > 0) {
        // El latido es lo que permite decir POR QUÉ un técnico está en ámbar
        // (GPS apagado / sin datos / permiso incompleto) en vez de solo pintarlo.
        const [statusRes, hbRes] = await Promise.all([
          supabase
            .from('technician_current_status')
            .select('id, status, last_seen, last_speed, device_id')
            .in('id', techIds),
          supabase
            .from('technician_heartbeat')
            .select('technician_id, gps_on, net_on, perm, last_heartbeat')
            .in('technician_id', techIds),
        ])
        statusMap = new Map(statusRes.data?.map(s => [s.id, s]) ?? [])
        // El latido es opcional (APK antigua): si falta, el motivo cae al genérico.
        hbMap = new Map(hbRes.data?.map((h: any) => [h.technician_id, h]) ?? [])
      }

      setRoutes((routesData ?? []).map(r => {
        const items = r.route_items as Array<{ franja: string; status: string }>
        const cs = r.technician_id ? statusMap.get(r.technician_id) : undefined
        const hb = r.technician_id ? hbMap.get(r.technician_id) : undefined
        return {
          id: r.id,
          technician_name: r.technician_name,
          technician_cedula: r.technician_cedula,
          technician_id: r.technician_id,
          am_count: items.filter(i => i.franja === 'AM').length,
          pm_count: items.filter(i => i.franja === 'PM').length,
          total: items.length,
          done: items.filter(i => i.status === 'completed').length,
          techStatus: cs?.status ?? 'offline',
          signals: {
            status:    cs?.status ?? 'offline',
            lastSeen:  cs?.last_seen ?? null,
            lastSpeed: cs?.last_speed ?? null,
            // Una ruta sin técnico vinculado no tiene nada que rastrear: gris.
            hasDevice: r.technician_id ? cs?.device_id != null : false,
            hbGpsOn:   hb?.gps_on ?? null,
            hbNetOn:   hb?.net_on ?? null,
            hbPerm:    hb?.perm ?? null,
            lastHeartbeat: hb?.last_heartbeat ?? null,
          },
        }
      }))
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  // El descriptor se arma aquí (no en load) para que el motivo con tiempo
  // relativo — "sin moverse hace 4 minutos" — se recalcule en cada render.
  const rows = routes.map(r => ({ ...r, st: describeStatus(t, r.signals, getDateLocale(lang)) }))

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
          <RefreshCw className="w-3.5 h-3.5" /> {t('common.retry')}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-text-primary font-semibold text-base">{t('leaderPanel.title.stats')}</h2>
          <p className="text-text-muted text-xs capitalize mt-0.5">{todayLabel}</p>
        </div>
        <button onClick={load} className="text-text-muted hover:text-text-primary transition-colors" title={t('common.refresh')}>
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <StatCard icon={Users} label={t('leaderStats.techsWithRoute')} value={routes.length} color="bg-primary/10 text-primary" />
        <StatCard icon={Wifi} label={t('leaderStats.techsInField')} value={onlineTechs} color="bg-success/10 text-success" sub={t('leaderStats.ofScheduled', { n: routes.length })} />
        <StatCard icon={Sun} label={t('leaderStats.installsAM')} value={totalAM} color="bg-warning/10 text-warning" />
        <StatCard icon={Sunset} label={t('leaderStats.installsPM')} value={totalPM} color="bg-primary/10 text-primary" />
        <StatCard
          icon={CheckCircle2}
          label={t('leaderStats.completedToday')}
          value={completionPct !== null ? `${completionPct}%` : '—'}
          color="bg-success/10 text-success"
          sub={totalAssigned > 0 ? t('leaderStats.ofTotal', { done: totalDone, total: totalAssigned }) : undefined}
        />
      </div>

      {routes.length === 0 ? (
        <div className="bg-surface border border-border-soft rounded-2xl p-12 text-center">
          <div className="w-12 h-12 rounded-xl bg-surface-raised flex items-center justify-center mx-auto mb-4">
            <Users className="w-6 h-6 text-text-muted" />
          </div>
          <p className="text-text-primary font-medium">{t('leaderStats.noRoutesToday')}</p>
          <p className="text-text-muted text-xs mt-1">{t('leaderStats.goUpload')}</p>
        </div>
      ) : (
        <div className="bg-surface border border-border-soft rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border-soft flex items-center justify-between">
            <h3 className="text-text-primary text-sm font-semibold">{t('leaderStats.techsToday')}</h3>
            <span className="text-text-muted text-xs">{t('leaderStats.techsInstalls', { techs: routes.length, installs: totalAM + totalPM })}</span>
            {completionPct !== null && (
              <span className="text-xs text-success font-medium">{t('leaderStats.pctComplete', { pct: completionPct })}</span>
            )}
          </div>
          <div className="px-4 py-2 border-b border-border-soft">
            <StatusLegend />
          </div>
          <div className="divide-y divide-border-soft">
            {rows.map(route => (
              <div key={route.id} className="px-4 py-3.5 flex items-center gap-3">
                <div className={cn(
                  'w-2 h-2 rounded-full flex-shrink-0',
                  route.st.dot, route.st.pulse && 'animate-pulse',
                )} />
                <div className="flex-1 min-w-0">
                  <p className="text-text-primary text-sm font-medium truncate">{route.technician_name}</p>
                  {/* El motivo del color, en la misma fila donde se ve el color. */}
                  <p className="text-text-muted text-xs truncate">{route.st.reason}</p>
                  {route.technician_cedula && (
                    <p className="text-text-muted/60 text-xs">{t('leaderStats.cedula', { value: route.technician_cedula })}</p>
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
                <span className={cn('text-xs px-2 py-0.5 rounded-full border flex-shrink-0', route.st.pill)}>
                  {route.st.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
