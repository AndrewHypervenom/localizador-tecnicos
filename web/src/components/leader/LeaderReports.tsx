import { useEffect, useState, useCallback } from 'react'
import {
  RefreshCw, Download, CheckCircle2, Clock, XCircle, AlertTriangle, TrendingUp,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getLeaderScope } from '@/lib/leaderContext'
import { cn } from '@/lib/utils'
import { format, subDays } from 'date-fns'
import { es } from 'date-fns/locale'

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
          {rows.length > 0 && (
            <button
              onClick={exportCSV}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 text-primary border border-primary/20 rounded-xl text-xs font-medium hover:bg-primary/20 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Exportar CSV
            </button>
          )}
        </div>
      </div>

      {/* Summary cards */}
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
    </div>
  )
}
