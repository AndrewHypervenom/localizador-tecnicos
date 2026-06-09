import { useEffect, useState, useCallback } from 'react'
import {
  RefreshCw, Download, CheckCircle2, Clock, XCircle, AlertTriangle, TrendingUp,
  FileText, FileSpreadsheet, Timer, Hourglass, Navigation, Route, MapPin, ShieldAlert,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getLeaderScope } from '@/lib/leaderContext'
import { cn } from '@/lib/utils'
import { format, subDays, addDays } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  exportLeaderPdf, exportLeaderExcel, aggregateHours, hm, DEVICE_TAMPER_TYPES,
  type HoursDaily, type HoursAgg, type RouteStat, type ReportMeta, type TrackStat,
  type DeviceEventRow,
} from '@/lib/reportExports'

interface Company {
  id: string
  name: string
}

interface TechRow {
  techId: string
  name: string
  assigned: number
  completed: number
  in_progress: number
  failed: number
}

interface Totals {
  assigned: number
  completed: number
  in_progress: number
  failed: number
}

function SummaryCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType
  label: string
  value: string | number
  sub?: string
  color: string
}) {
  return (
    <div className="bg-surface border border-border-soft rounded-2xl p-4 flex items-start gap-3">
      <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0', color)}>
        <Icon className="w-4 h-4" />
      </div>
      <div>
        <p className="text-text-muted text-xs">{label}</p>
        <p className="text-text-primary text-xl font-bold mt-0.5">{value}</p>
        {sub && <p className="text-text-muted text-xs mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

export function LeaderReports() {
  const todayStr   = format(new Date(), 'yyyy-MM-dd')
  const defaultFrom = format(subDays(new Date(), 6), 'yyyy-MM-dd')

  const [dateFrom, setDateFrom] = useState(defaultFrom)
  const [dateTo,   setDateTo]   = useState(todayStr)
  const [companies, setCompanies]             = useState<Company[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('')
  const [rows,    setRows]    = useState<TechRow[]>([])
  const [totals,  setTotals]  = useState<Totals | null>(null)
  const [loading, setLoading] = useState(false)
  const [sortDesc, setSortDesc] = useState(true)

  // Horas trabajadas (vía RPC leader_work_hours)
  const [hoursDaily, setHoursDaily] = useState<HoursDaily[]>([])
  const [hoursAgg,   setHoursAgg]   = useState<HoursAgg[]>([])
  const [hoursAvailable, setHoursAvailable] = useState(true) // false si falta la migración RPC

  // Tracking (distancias, viajes, zonas, incidentes)
  const [track, setTrack] = useState<TrackStat[]>([])

  // Bitácora de dispositivo (evidencia de sabotaje al rastreo) para los exports
  const [deviceEvents, setDeviceEvents] = useState<DeviceEventRow[]>([])

  // Load company list for filter
  useEffect(() => {
    async function init() {
      const { companyIds } = await getLeaderScope()
      if (companyIds.length === 0) return
      const { data } = await supabase
        .from('companies')
        .select('id, name')
        .in('id', companyIds)
        .order('name')
      setCompanies(data ?? [])
    }
    init()
  }, [])

  const loadReport = useCallback(async () => {
    setLoading(true)
    try {
      const { technicianIds, companyIds } = await getLeaderScope()
      if (technicianIds.length === 0) {
        setRows([])
        setTotals({ assigned: 0, completed: 0, in_progress: 0, failed: 0 })
        return
      }

      // Build query
      let query = supabase
        .from('technician_routes')
        .select('technician_id, technician_name, route_items(status)')
        .gte('route_date', dateFrom)
        .lte('route_date', dateTo)
        .in('technician_id', technicianIds)

      // Filter by company via campaigns
      if (selectedCompanyId && companyIds.includes(selectedCompanyId)) {
        const { data: campaigns } = await supabase
          .from('campaigns')
          .select('id')
          .eq('company_id', selectedCompanyId)
        const campaignIds = (campaigns ?? []).map((c: any) => c.id)
        if (campaignIds.length > 0) {
          query = query.in('campaign_id', campaignIds)
        }
      }

      const { data: routeData } = await query

      // Aggregate per technician
      const techMap = new Map<string, TechRow>()
      for (const route of routeData ?? []) {
        const items = (route.route_items ?? []) as Array<{ status: string }>
        const existing = techMap.get(route.technician_id) ?? {
          techId: route.technician_id,
          name: route.technician_name,
          assigned: 0, completed: 0, in_progress: 0, failed: 0,
        }
        existing.assigned    += items.length
        existing.completed   += items.filter(i => i.status === 'completed').length
        existing.in_progress += items.filter(i => i.status === 'in_progress').length
        existing.failed      += items.filter(i => i.status === 'failed').length
        techMap.set(route.technician_id, existing)
      }

      const allRows = [...techMap.values()]
      setRows(allRows)
      setTotals(allRows.reduce(
        (acc, r) => ({
          assigned:    acc.assigned    + r.assigned,
          completed:   acc.completed   + r.completed,
          in_progress: acc.in_progress + r.in_progress,
          failed:      acc.failed      + r.failed,
        }),
        { assigned: 0, completed: 0, in_progress: 0, failed: 0 }
      ))

      // ── Horas trabajadas ──
      // Si hay empresa seleccionada, acotar a sus técnicos; si no, todo el scope.
      let hoursTechIds = technicianIds
      if (selectedCompanyId && companyIds.includes(selectedCompanyId)) {
        const { data: techsOfCompany } = await supabase
          .from('technicians')
          .select('id')
          .eq('company_id', selectedCompanyId)
          .in('id', technicianIds)
        hoursTechIds = (techsOfCompany ?? []).map((t: any) => t.id)
      }

      if (hoursTechIds.length === 0) {
        setHoursDaily([]); setHoursAgg([]); setHoursAvailable(true)
      } else {
        const { data: hData, error: hErr } = await supabase.rpc('leader_work_hours', {
          p_from: dateFrom,
          p_to:   dateTo,
          p_technician_ids: hoursTechIds,
        })
        if (hErr) {
          // La función aún no existe (falta correr la migración) u otro error.
          console.warn('[leader_work_hours]', hErr.message)
          setHoursDaily([]); setHoursAgg([]); setHoursAvailable(false)
        } else {
          const daily: HoursDaily[] = (hData ?? []).map((r: any) => ({
            techId:     r.technician_id,
            name:       r.technician_name,
            company:    r.company_name ?? null,
            date:       r.work_date,
            firstLocal: r.first_local ?? '—',
            lastLocal:  r.last_local ?? '—',
            points:     Number(r.points ?? 0),
            workedSec:  Number(r.worked_seconds ?? 0),
            regularSec: Number(r.regular_seconds ?? 0),
            overtimeSec: Number(r.overtime_seconds ?? 0),
            isWeekend:  !!r.is_weekend,
          }))
          setHoursDaily(daily)
          setHoursAgg(aggregateHours(daily))
          setHoursAvailable(true)
        }
      }

      // ── Tracking: distancias, viajes, zonas, incidentes ──
      if (hoursTechIds.length === 0) {
        setTrack([])
        setDeviceEvents([])
      } else {
        const toNext = format(addDays(new Date(dateTo + 'T12:00:00'), 1), 'yyyy-MM-dd')
        const [tripsRes, zonesRes, namesRes, deviceRes, batteryRes] = await Promise.all([
          supabase.from('trips')
            .select('technician_id, distance_km, duration_min, avg_speed_kmh, max_speed_kmh, hard_brakes, rapid_accels, harsh_turns, accidents')
            .in('technician_id', hoursTechIds)
            .gte('started_at', `${dateFrom}T00:00:00`)
            .lt('started_at', `${toNext}T00:00:00`),
          supabase.from('zone_events')
            .select('technician_id, event_type')
            .in('technician_id', hoursTechIds)
            .gte('ts', `${dateFrom}T00:00:00`)
            .lt('ts', `${toNext}T00:00:00`),
          supabase.from('technicians')
            .select('id, name, company_id')
            .in('id', hoursTechIds),
          supabase.from('motion_events')
            .select('technician_id, event_type, ts')
            .in('technician_id', hoursTechIds)
            .in('event_type', DEVICE_TAMPER_TYPES)
            .gte('ts', `${dateFrom}T00:00:00`)
            .lt('ts', `${toNext}T00:00:00`),
          // Drenaje de batería (%/h) del equipo mientras rastreaba, sin cargar.
          supabase.rpc('battery_drain_report', {
            p_tech_ids: hoursTechIds,
            p_from:     `${dateFrom}T00:00:00`,
            p_to:       `${toNext}T00:00:00`,
          }),
        ])

        const nameMap = new Map<string, { name: string; company: string | null }>()
        ;(namesRes.data ?? []).forEach((t: any) => {
          const comp = companies.find(c => c.id === t.company_id)?.name ?? null
          nameMap.set(t.id, { name: t.name, company: comp })
        })

        const tmap = new Map<string, TrackStat>()
        const ensure = (id: string): TrackStat => {
          let s = tmap.get(id)
          if (!s) {
            const info = nameMap.get(id)
            s = {
              techId: id, name: info?.name ?? 'Técnico', company: info?.company ?? null,
              km: 0, trips: 0, durationMin: 0, avgSpeed: 0, maxSpeed: 0,
              zoneEnters: 0, zoneExits: 0, incidents: 0, deviceTampers: 0,
            }
            tmap.set(id, s)
          }
          return s
        }

        const avgAccum = new Map<string, { sum: number; n: number }>()
        ;(tripsRes.data ?? []).forEach((tr: any) => {
          const s = ensure(tr.technician_id)
          s.km          += tr.distance_km ?? 0
          s.trips       += 1
          s.durationMin += tr.duration_min ?? 0
          s.maxSpeed     = Math.max(s.maxSpeed, tr.max_speed_kmh ?? 0)
          s.incidents   += (tr.hard_brakes ?? 0) + (tr.rapid_accels ?? 0) + (tr.harsh_turns ?? 0) + (tr.accidents ?? 0)
          if (tr.avg_speed_kmh != null) {
            const a = avgAccum.get(tr.technician_id) ?? { sum: 0, n: 0 }
            a.sum += tr.avg_speed_kmh; a.n += 1
            avgAccum.set(tr.technician_id, a)
          }
        })
        avgAccum.forEach((a, id) => { const s = tmap.get(id); if (s) s.avgSpeed = a.n > 0 ? a.sum / a.n : 0 })

        ;(zonesRes.data ?? []).forEach((z: any) => {
          const s = ensure(z.technician_id)
          if (z.event_type === 'enter') s.zoneEnters += 1
          else if (z.event_type === 'exit') s.zoneExits += 1
        })

        // Bitácora de dispositivo: contar sabotajes por técnico y guardar el
        // detalle (con hora) para los exports PDF/Excel.
        const devRows: DeviceEventRow[] = []
        ;(deviceRes.data ?? []).forEach((m: any) => {
          const s = ensure(m.technician_id)
          s.deviceTampers += 1
          const info = nameMap.get(m.technician_id)
          devRows.push({
            techId:  m.technician_id,
            name:    info?.name ?? 'Técnico',
            company: info?.company ?? null,
            ts:      m.ts,
            type:    m.event_type,
          })
        })
        setDeviceEvents(devRows)

        // Consumo de batería: %/h de drenaje (sin cargar) por técnico.
        ;(batteryRes.data ?? []).forEach((b: any) => {
          const s = ensure(b.technician_id)
          s.batteryDrainPerH = b.drain_pct_per_h != null ? Number(b.drain_pct_per_h) : null
          s.trackedHours     = b.tracked_hours   != null ? Number(b.tracked_hours)   : 0
        })

        setTrack([...tmap.values()].sort((a, b) => b.km - a.km))
      }
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo, selectedCompanyId])

  useEffect(() => { loadReport() }, [loadReport])

  function pct(done: number, total: number) {
    return total > 0 ? Math.round((done / total) * 100) : 0
  }

  function exportCSV() {
    const headers = ['Técnico', 'Asignadas', 'Completadas', 'En progreso', 'Fallidas', '%']
    const sorted = [...rows].sort((a, b) => pct(b.completed, b.assigned) - pct(a.completed, a.assigned))
    const csvRows = [
      headers.join(','),
      ...sorted.map(r => [
        `"${r.name}"`,
        r.assigned,
        r.completed,
        r.in_progress,
        r.failed,
        pct(r.completed, r.assigned),
      ].join(',')),
    ]
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `reporte-${dateFrom}-a-${dateTo}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const companyName = selectedCompanyId
    ? (companies.find(c => c.id === selectedCompanyId)?.name ?? 'Empresa')
    : 'Todas las empresas'
  const reportMeta: ReportMeta = { from: dateFrom, to: dateTo, companyName }

  function handlePdf()   { exportLeaderPdf(reportMeta, track, rows as RouteStat[], hoursAgg, deviceEvents) }
  function handleExcel() { exportLeaderExcel(reportMeta, track, rows as RouteStat[], hoursAgg, hoursDaily, deviceEvents) }

  const hasAnyData = rows.length > 0 || hoursDaily.length > 0 || track.length > 0

  const trackTotals = track.reduce(
    (a, t) => ({
      km:     a.km     + t.km,
      trips:  a.trips  + t.trips,
      enters: a.enters + t.zoneEnters,
      exits:  a.exits  + t.zoneExits,
      inc:    a.inc    + t.incidents,
      tampers: a.tampers + t.deviceTampers,
    }),
    { km: 0, trips: 0, enters: 0, exits: 0, inc: 0, tampers: 0 },
  )

  const hoursTotals = hoursAgg.reduce(
    (a, h) => ({
      worked:   a.worked   + h.workedSec,
      regular:  a.regular  + h.regularSec,
      overtime: a.overtime + h.overtimeSec,
      withOt:   a.withOt   + (h.overtimeSec > 0 ? 1 : 0),
    }),
    { worked: 0, regular: 0, overtime: 0, withOt: 0 },
  )

  const sortedRows = [...rows].sort((a, b) => {
    const pa = pct(a.completed, a.assigned)
    const pb = pct(b.completed, b.assigned)
    return sortDesc ? pb - pa : pa - pb
  })

  const completionPct = totals && totals.assigned > 0
    ? Math.round((totals.completed / totals.assigned) * 100)
    : null

  const fromLabel = format(new Date(dateFrom + 'T00:00:00'), "d MMM", { locale: es })
  const toLabel   = format(new Date(dateTo   + 'T00:00:00'), "d MMM yyyy", { locale: es })

  return (
    <div className="space-y-5">
      {/* Header + filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h2 className="text-text-primary font-semibold text-base">Reportes</h2>
          <p className="text-text-muted text-xs mt-0.5">{fromLabel} — {toLabel}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap ml-auto">
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-text-muted">Desde</label>
            <input
              type="date"
              value={dateFrom}
              max={dateTo}
              onChange={e => setDateFrom(e.target.value)}
              className="bg-surface-raised border border-border rounded-xl px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-primary transition-colors"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-text-muted">Hasta</label>
            <input
              type="date"
              value={dateTo}
              min={dateFrom}
              max={todayStr}
              onChange={e => setDateTo(e.target.value)}
              className="bg-surface-raised border border-border rounded-xl px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-primary transition-colors"
            />
          </div>
          {companies.length > 1 && (
            <select
              value={selectedCompanyId}
              onChange={e => setSelectedCompanyId(e.target.value)}
              className="bg-surface-raised border border-border rounded-xl px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-primary transition-colors"
            >
              <option value="">Todas las empresas</option>
              {companies.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          <button onClick={loadReport} disabled={loading}
            title="Actualizar"
            className="p-1.5 text-text-muted hover:text-text-primary transition-colors rounded-lg hover:bg-surface-raised disabled:opacity-50">
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          </button>
          {hasAnyData && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={handlePdf}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-danger/10 text-danger border border-danger/20 rounded-xl text-xs font-medium hover:bg-danger/20 transition-colors"
              >
                <FileText className="w-3.5 h-3.5" />
                PDF
              </button>
              <button
                onClick={handleExcel}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-success/10 text-success border border-success/20 rounded-xl text-xs font-medium hover:bg-success/20 transition-colors"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                Excel
              </button>
              <button
                onClick={exportCSV}
                disabled={rows.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 text-primary border border-primary/20 rounded-xl text-xs font-medium hover:bg-primary/20 transition-colors disabled:opacity-40"
              >
                <Download className="w-3.5 h-3.5" />
                CSV
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Tracking (lo principal) ── */}
      {!loading && track.length > 0 && (
        <div className="space-y-3">
          <div>
            <h3 className="text-text-primary font-semibold text-base flex items-center gap-2">
              <Navigation className="w-4 h-4 text-primary" /> Tracking de técnicos
            </h3>
            <p className="text-text-muted text-xs mt-0.5">Distancias, viajes, entradas/salidas de zonas e incidentes en el período.</p>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <SummaryCard icon={Navigation} label="Km recorridos"  value={`${trackTotals.km.toFixed(1)} km`} color="bg-primary/10 text-primary" />
            <SummaryCard icon={Route}      label="Viajes"          value={trackTotals.trips} color="bg-accent/10 text-accent" />
            <SummaryCard icon={MapPin}     label="Entradas a zona" value={trackTotals.enters} sub={`${trackTotals.exits} salidas`} color="bg-success/10 text-success" />
            <SummaryCard icon={MapPin}     label="Salidas de zona" value={trackTotals.exits} color="bg-warning/10 text-warning" />
            <SummaryCard icon={AlertTriangle} label="Incidentes"   value={trackTotals.inc} color={trackTotals.inc > 0 ? 'bg-danger/10 text-danger' : 'bg-surface-raised text-text-muted'} />
            <SummaryCard icon={ShieldAlert} label="Sabotajes"      value={trackTotals.tampers} sub="al rastreo" color={trackTotals.tampers > 0 ? 'bg-danger/10 text-danger' : 'bg-surface-raised text-text-muted'} />
          </div>

          <div className="bg-surface border border-border-soft rounded-2xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-soft bg-surface-raised">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">Técnico</th>
                  <th className="px-3 py-3 text-center text-xs font-semibold text-text-muted uppercase tracking-wider">Km</th>
                  <th className="px-3 py-3 text-center text-xs font-semibold text-text-muted uppercase tracking-wider">Viajes</th>
                  <th className="px-3 py-3 text-center text-xs font-semibold text-text-muted uppercase tracking-wider">Tiempo en ruta</th>
                  <th className="px-3 py-3 text-center text-xs font-semibold text-text-muted uppercase tracking-wider">Vel. prom.</th>
                  <th className="px-3 py-3 text-center text-xs font-semibold text-text-muted uppercase tracking-wider">Vel. máx.</th>
                  <th className="px-3 py-3 text-center text-xs font-semibold text-text-muted uppercase tracking-wider">Entradas</th>
                  <th className="px-3 py-3 text-center text-xs font-semibold text-text-muted uppercase tracking-wider">Salidas</th>
                  <th className="px-3 py-3 text-center text-xs font-semibold text-text-muted uppercase tracking-wider">Incidentes</th>
                  <th className="px-3 py-3 text-center text-xs font-semibold text-text-muted uppercase tracking-wider">Sabotajes</th>
                  <th className="px-3 py-3 text-center text-xs font-semibold text-text-muted uppercase tracking-wider" title="Drenaje de batería del equipo por hora, sin cargar, mientras rastreaba">Batería %/h</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {track.map(t => (
                  <tr key={t.techId} className="hover:bg-surface-raised transition-colors">
                    <td className="px-4 py-3 text-text-primary font-medium truncate max-w-[180px]">{t.name}</td>
                    <td className="px-3 py-3 text-center text-text-secondary font-mono">{t.km.toFixed(1)}</td>
                    <td className="px-3 py-3 text-center text-text-secondary font-mono">{t.trips}</td>
                    <td className="px-3 py-3 text-center text-text-secondary font-mono">{t.durationMin > 0 ? hm(t.durationMin * 60) : '—'}</td>
                    <td className="px-3 py-3 text-center text-text-secondary font-mono">{t.avgSpeed.toFixed(1)}</td>
                    <td className="px-3 py-3 text-center text-text-secondary font-mono">{t.maxSpeed.toFixed(1)}</td>
                    <td className="px-3 py-3 text-center text-text-secondary font-mono">{t.zoneEnters}</td>
                    <td className="px-3 py-3 text-center text-text-secondary font-mono">{t.zoneExits}</td>
                    <td className="px-3 py-3 text-center">
                      <span className={cn('font-mono', t.incidents > 0 ? 'text-danger font-bold' : 'text-text-muted')}>{t.incidents}</span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className={cn('font-mono', t.deviceTampers > 0 ? 'text-danger font-bold' : 'text-text-muted')}>{t.deviceTampers}</span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className={cn('font-mono', (t.batteryDrainPerH ?? 0) > 12 ? 'text-warning font-bold' : 'text-text-secondary')}>
                        {t.batteryDrainPerH != null ? `${t.batteryDrainPerH.toFixed(1)}%` : '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Summary cards — servicios (cumplimiento de rutas) */}
      {totals && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <SummaryCard
            icon={TrendingUp}
            label="Asignadas"
            value={totals.assigned}
            color="bg-primary/10 text-primary"
          />
          <SummaryCard
            icon={CheckCircle2}
            label="Completadas"
            value={totals.completed}
            color="bg-success/10 text-success"
          />
          <SummaryCard
            icon={Clock}
            label="En progreso"
            value={totals.in_progress}
            color="bg-warning/10 text-warning"
          />
          <SummaryCard
            icon={XCircle}
            label="Fallidas"
            value={totals.failed}
            color="bg-danger/10 text-danger"
          />
          <SummaryCard
            icon={AlertTriangle}
            label="Completado"
            value={completionPct !== null ? `${completionPct}%` : '—'}
            sub={totals.assigned > 0 ? `${totals.completed} de ${totals.assigned}` : undefined}
            color={
              completionPct !== null && completionPct >= 80
                ? 'bg-success/10 text-success'
                : completionPct !== null && completionPct >= 50
                ? 'bg-warning/10 text-warning'
                : 'bg-danger/10 text-danger'
            }
          />
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : sortedRows.length === 0 ? (
        <div className="bg-surface border border-border-soft rounded-2xl p-12 text-center">
          <TrendingUp className="w-10 h-10 mx-auto mb-3 text-text-muted/30" />
          <p className="text-text-primary font-medium">Sin datos para el período seleccionado</p>
          <p className="text-text-muted text-xs mt-1">Ajusta el rango de fechas o la empresa.</p>
        </div>
      ) : (
        <div className="bg-surface border border-border-soft rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-soft bg-surface-raised">
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">Técnico</th>
                <th className="px-3 py-3 text-center text-xs font-semibold text-text-muted uppercase tracking-wider">Asignadas</th>
                <th className="px-3 py-3 text-center text-xs font-semibold text-text-muted uppercase tracking-wider">Completadas</th>
                <th className="px-3 py-3 text-center text-xs font-semibold text-text-muted uppercase tracking-wider">En progreso</th>
                <th className="px-3 py-3 text-center text-xs font-semibold text-text-muted uppercase tracking-wider">Fallidas</th>
                <th
                  className="px-3 py-3 text-center text-xs font-semibold text-text-muted uppercase tracking-wider cursor-pointer hover:text-text-primary transition-colors select-none"
                  onClick={() => setSortDesc(v => !v)}
                >
                  % {sortDesc ? '↓' : '↑'}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-soft">
              {sortedRows.map(r => {
                const p = pct(r.completed, r.assigned)
                return (
                  <tr key={r.techId} className="hover:bg-surface-raised transition-colors">
                    <td className="px-4 py-3 text-text-primary font-medium truncate max-w-[180px]">{r.name}</td>
                    <td className="px-3 py-3 text-center text-text-secondary font-mono">{r.assigned}</td>
                    <td className="px-3 py-3 text-center">
                      <span className={cn('font-mono', r.completed > 0 ? 'text-success' : 'text-text-muted')}>{r.completed}</span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className={cn('font-mono', r.in_progress > 0 ? 'text-warning' : 'text-text-muted')}>{r.in_progress}</span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className={cn('font-mono', r.failed > 0 ? 'text-danger' : 'text-text-muted')}>{r.failed}</span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className={cn(
                        'inline-flex items-center justify-center min-w-[40px] px-2 py-0.5 rounded-full text-xs font-bold',
                        p >= 80 ? 'bg-success/10 text-success' :
                        p >= 50 ? 'bg-warning/10 text-warning' :
                        p > 0   ? 'bg-danger/10 text-danger' :
                        'bg-surface-raised text-text-muted'
                      )}>
                        {p}%
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Horas trabajadas ── */}
      {!loading && (
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-text-primary font-semibold text-base flex items-center gap-2">
                <Timer className="w-4 h-4 text-primary" /> Horas trabajadas
              </h3>
              <p className="text-text-muted text-xs mt-0.5">
                Tiempo activo según GPS. <span className="text-warning">Extra</span> = fuera del horario laboral de la empresa o en fin de semana.
              </p>
            </div>
          </div>

          {!hoursAvailable ? (
            <div className="bg-warning/10 border border-warning/30 rounded-2xl p-4 text-sm text-warning flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>
                El cálculo de horas requiere una migración en la base de datos
                (<code className="font-mono text-xs">leader_work_hours</code>). Ejecuta
                <code className="font-mono text-xs"> supabase/migrations/20260603_leader_work_hours.sql</code> en el SQL Editor para activarlo.
                El resto del reporte y los exports funcionan igual.
              </span>
            </div>
          ) : hoursAgg.length === 0 ? (
            <div className="bg-surface border border-border-soft rounded-2xl p-8 text-center">
              <Hourglass className="w-8 h-8 mx-auto mb-2 text-text-muted/30" />
              <p className="text-text-secondary text-sm">Sin horas registradas en el período.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <SummaryCard icon={Timer}      label="Horas trabajadas" value={hm(hoursTotals.worked)}   color="bg-primary/10 text-primary" />
                <SummaryCard icon={Clock}      label="Horas regulares"  value={hm(hoursTotals.regular)}  color="bg-success/10 text-success" />
                <SummaryCard icon={Hourglass}  label="Horas extra"      value={hm(hoursTotals.overtime)} color="bg-warning/10 text-warning" />
                <SummaryCard icon={AlertTriangle} label="Técnicos con extra" value={hoursTotals.withOt} sub={`de ${hoursAgg.length}`} color="bg-warning/10 text-warning" />
              </div>

              <div className="bg-surface border border-border-soft rounded-2xl overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border-soft bg-surface-raised">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">Técnico</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-text-muted uppercase tracking-wider">Días</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-text-muted uppercase tracking-wider">Trabajadas</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-text-muted uppercase tracking-wider">Regulares</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-text-muted uppercase tracking-wider">Extra</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-text-muted uppercase tracking-wider">Fin de semana</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-text-muted uppercase tracking-wider">Prom. h/día</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-soft">
                    {hoursAgg.map(h => (
                      <tr key={h.techId} className="hover:bg-surface-raised transition-colors">
                        <td className="px-4 py-3 text-text-primary font-medium truncate max-w-[180px]">{h.name}</td>
                        <td className="px-3 py-3 text-center text-text-secondary font-mono">{h.daysWorked}</td>
                        <td className="px-3 py-3 text-center text-text-secondary font-mono">{hm(h.workedSec)}</td>
                        <td className="px-3 py-3 text-center text-text-secondary font-mono">{hm(h.regularSec)}</td>
                        <td className="px-3 py-3 text-center">
                          <span className={cn('font-mono font-bold', h.overtimeSec > 0 ? 'text-warning' : 'text-text-muted')}>
                            {hm(h.overtimeSec)}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-center text-text-secondary font-mono">{h.weekendSec > 0 ? hm(h.weekendSec) : '—'}</td>
                        <td className="px-3 py-3 text-center text-text-secondary font-mono">{h.daysWorked > 0 ? hm(h.workedSec / h.daysWorked) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
