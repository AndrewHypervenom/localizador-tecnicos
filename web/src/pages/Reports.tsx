import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { getRoleFromSession } from '@/lib/roles'
import api from '@/lib/api'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, ResponsiveContainer, Legend,
} from 'recharts'
import {
  ArrowLeft, Download, RefreshCw, Route, Clock,
  AlertTriangle, Users, TrendingUp, ChevronDown,
  FileText, Activity,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { cn } from '@/lib/utils'

// ── Types ────────────────────────────────────────────────────────────

interface TechnicianRow {
  id: string; name: string; phone: string
  total_trips: number; total_km: number
  avg_speed_kmh: number; max_speed_kmh: number
  hard_brakes: number; rapid_accels: number; harsh_turns: number; accidents: number
  total_min: number
}

interface FleetReport {
  from: string; to: string
  technicians: TechnicianRow[]
}

interface DailyRow { date: string; trips: number; km: number; incidents: number }

interface TripRow {
  id: string; started_at: string; ended_at: string | null
  distance_km: number; avg_speed_kmh: number; max_speed_kmh: number
  duration_min: number | null
  hard_brakes: number; rapid_accels: number; harsh_turns: number; accidents: number
}

interface Summary {
  total_trips: number; total_km: number
  avg_speed_kmh: number; max_speed_kmh: number
  hard_brakes: number; rapid_accels: number; harsh_turns: number; accidents: number
  total_min: number
}

interface TechnicianReport {
  from: string; to: string
  technician: { name: string; phone: string }
  summary: Summary | null
  daily: DailyRow[]
  trips: TripRow[]
}

interface TechnicianOption { id: string; name: string; phone: string }

// ── Helpers ──────────────────────────────────────────────────────────

const PIE_COLORS = ['#F59E0B', '#EF4444', '#7B2FF7', '#3B82F6']

function fmtDate(iso: string) {
  return format(parseISO(iso), 'dd/MM/yyyy', { locale: es })
}

function fmtDateTime(iso: string) {
  return format(parseISO(iso), 'dd/MM HH:mm', { locale: es })
}

function fmtMin(min: number | null) {
  if (!min) return '—'
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

// ── KPI Card ─────────────────────────────────────────────────────────

function KpiCard({ label, value, unit, icon: Icon, color }: {
  label: string; value: string | number; unit?: string
  icon: React.ElementType; color: string
}) {
  return (
    <div className="bg-surface border border-border-soft rounded-xl p-4 flex items-center gap-3">
      <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0', color)}>
        <Icon className="w-4 h-4 text-white" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-text-muted truncate">{label}</p>
        <p className="text-lg font-bold text-text-primary leading-tight">
          {value}{unit && <span className="text-xs font-normal text-text-muted ml-1">{unit}</span>}
        </p>
      </div>
    </div>
  )
}

// ── Chart Tooltip custom ──────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-surface border border-border-soft rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-text-muted mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }} className="font-medium">
          {p.name}: {typeof p.value === 'number' ? p.value.toLocaleString('es') : p.value}
        </p>
      ))}
    </div>
  )
}

// ── PDF generators ────────────────────────────────────────────────────

function generateFleetPDF(report: FleetReport) {
  const doc = new jsPDF({ orientation: 'landscape' })
  const now = format(new Date(), "dd/MM/yyyy HH:mm", { locale: es })

  doc.setFillColor(10, 10, 20)
  doc.rect(0, 0, 297, 30, 'F')
  doc.setTextColor(0, 214, 50)
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text('REPORTE DE FLOTA', 14, 12)
  doc.setTextColor(200, 200, 200)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text('PositivoS+ · Localizador GPS', 14, 20)
  doc.text(`Período: ${fmtDate(report.from)} — ${fmtDate(report.to)}`, 14, 26)
  doc.text(`Generado: ${now}`, 200, 26)

  // Summary
  const totals = report.technicians.reduce((acc, t) => ({
    trips: acc.trips + t.total_trips,
    km: acc.km + t.total_km,
    incidents: acc.incidents + t.hard_brakes + t.rapid_accels + t.harsh_turns + t.accidents,
    min: acc.min + t.total_min,
  }), { trips: 0, km: 0, incidents: 0, min: 0 })

  doc.setTextColor(30, 30, 30)
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text('Resumen general', 14, 40)

  autoTable(doc, {
    startY: 44,
    head: [['Técnicos', 'Total viajes', 'Total km', 'Total horas', 'Total incidentes']],
    body: [[
      report.technicians.length,
      totals.trips,
      totals.km.toFixed(1) + ' km',
      fmtMin(totals.min),
      totals.incidents,
    ]],
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [0, 214, 50], textColor: [10, 10, 20], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 245, 248] },
    margin: { left: 14, right: 14 },
  })

  const y1 = (doc as any).lastAutoTable.finalY + 8

  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(30, 30, 30)
  doc.text('Detalle por técnico', 14, y1)

  autoTable(doc, {
    startY: y1 + 4,
    head: [['Técnico', 'Viajes', 'Km', 'Vel. prom.', 'Vel. máx.', 'Horas', 'Frenadas', 'Aceleraciones', 'Giros', 'Accidentes']],
    body: report.technicians.map(t => [
      t.name,
      t.total_trips,
      t.total_km.toFixed(1) + ' km',
      t.avg_speed_kmh.toFixed(1) + ' km/h',
      t.max_speed_kmh.toFixed(1) + ' km/h',
      fmtMin(t.total_min),
      t.hard_brakes,
      t.rapid_accels,
      t.harsh_turns,
      t.accidents,
    ]),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [20, 20, 32], textColor: [200, 200, 200], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 245, 248] },
    margin: { left: 14, right: 14 },
  })

  doc.save(`reporte-flota-${report.from}-${report.to}.pdf`)
}

function generateTechnicianPDF(report: TechnicianReport) {
  const doc = new jsPDF()
  const now = format(new Date(), "dd/MM/yyyy HH:mm", { locale: es })
  const s = report.summary

  doc.setFillColor(10, 10, 20)
  doc.rect(0, 0, 210, 30, 'F')
  doc.setTextColor(0, 214, 50)
  doc.setFontSize(15)
  doc.setFont('helvetica', 'bold')
  doc.text('REPORTE DE TÉCNICO', 14, 12)
  doc.setTextColor(200, 200, 200)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(`Técnico: ${report.technician.name}`, 14, 20)
  doc.text(`Período: ${fmtDate(report.from)} — ${fmtDate(report.to)}`, 14, 26)
  doc.text(`Generado: ${now}`, 140, 26)

  doc.setTextColor(30, 30, 30)
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text('Resumen del período', 14, 40)

  autoTable(doc, {
    startY: 44,
    head: [['Viajes', 'Km total', 'Vel. promedio', 'Vel. máxima', 'Horas', 'Incidentes totales']],
    body: [[
      s?.total_trips ?? 0,
      (s?.total_km ?? 0).toFixed(1) + ' km',
      (s?.avg_speed_kmh ?? 0).toFixed(1) + ' km/h',
      (s?.max_speed_kmh ?? 0).toFixed(1) + ' km/h',
      fmtMin(s?.total_min ?? 0),
      ((s?.hard_brakes ?? 0) + (s?.rapid_accels ?? 0) + (s?.harsh_turns ?? 0) + (s?.accidents ?? 0)),
    ]],
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [0, 214, 50], textColor: [10, 10, 20], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 245, 248] },
    margin: { left: 14, right: 14 },
  })

  if (s) {
    const y1 = (doc as any).lastAutoTable.finalY + 8
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.text('Detalle de incidentes', 14, y1)
    autoTable(doc, {
      startY: y1 + 4,
      head: [['Tipo', 'Cantidad']],
      body: [
        ['Frenadas bruscas', s.hard_brakes],
        ['Aceleraciones bruscas', s.rapid_accels],
        ['Giros bruscos', s.harsh_turns],
        ['Accidentes', s.accidents],
      ],
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [20, 20, 32], textColor: [200, 200, 200], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 245, 248] },
      margin: { left: 14, right: 14 },
    })
  }

  if (report.trips.length > 0) {
    const y2 = (doc as any).lastAutoTable.finalY + 8
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.text('Lista de viajes', 14, y2)
    autoTable(doc, {
      startY: y2 + 4,
      head: [['Inicio', 'Duración', 'Km', 'Vel. prom.', 'Vel. máx.', 'Frenos', 'Acels', 'Giros', 'Accident.']],
      body: report.trips.map(t => [
        fmtDateTime(t.started_at),
        fmtMin(t.duration_min),
        t.distance_km.toFixed(1),
        t.avg_speed_kmh.toFixed(1),
        t.max_speed_kmh.toFixed(1),
        t.hard_brakes,
        t.rapid_accels,
        t.harsh_turns,
        t.accidents,
      ]),
      styles: { fontSize: 7.5, cellPadding: 2.5 },
      headStyles: { fillColor: [20, 20, 32], textColor: [200, 200, 200], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 245, 248] },
      margin: { left: 14, right: 14 },
    })
  }

  doc.save(`reporte-tecnico-${report.technician.name.replace(/\s+/g, '-')}-${report.from}-${report.to}.pdf`)
}

// ── Main Component ────────────────────────────────────────────────────

export function Reports() {
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [tab, setTab] = useState<'fleet' | 'technician'>('fleet')

  const today = new Date().toISOString().slice(0, 10)
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10)
  const [fromDate, setFromDate] = useState(sevenDaysAgo)
  const [toDate, setToDate] = useState(today)

  // Fleet
  const [fleetReport, setFleetReport] = useState<FleetReport | null>(null)
  const [fleetLoading, setFleetLoading] = useState(false)
  const [fleetError, setFleetError] = useState<string | null>(null)

  // Technician
  const [technicians, setTechnicians] = useState<TechnicianOption[]>([])
  const [selectedTech, setSelectedTech] = useState<string>('')
  const [techReport, setTechReport] = useState<TechnicianReport | null>(null)
  const [techLoading, setTechLoading] = useState(false)
  const [techError, setTechError] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const role = getRoleFromSession(session)
      setIsSuperAdmin(role === 'superadmin')
      setTab(role === 'superadmin' ? 'fleet' : 'technician')
    })
    api.get('/api/reports/technicians').then(r => {
      setTechnicians(r.data)
      if (r.data.length > 0) setSelectedTech(r.data[0].id)
    }).catch(() => {})
  }, [])

  const loadFleetReport = async () => {
    setFleetLoading(true)
    setFleetError(null)
    try {
      const { data } = await api.get(`/api/reports/fleet?from=${fromDate}&to=${toDate}`)
      setFleetReport(data)
    } catch {
      setFleetError('Error al cargar el reporte de flota')
    } finally {
      setFleetLoading(false)
    }
  }

  const loadTechReport = async () => {
    if (!selectedTech) return
    setTechLoading(true)
    setTechError(null)
    try {
      const { data } = await api.get(`/api/reports/technician/${selectedTech}?from=${fromDate}&to=${toDate}`)
      setTechReport(data)
    } catch {
      setTechError('Error al cargar el reporte del técnico')
    } finally {
      setTechLoading(false)
    }
  }

  useEffect(() => {
    if (tab === 'fleet' && isSuperAdmin) loadFleetReport()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, isSuperAdmin])

  useEffect(() => {
    if (tab === 'technician' && selectedTech) loadTechReport()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, selectedTech])

  const handleGenerate = () => {
    if (tab === 'fleet') loadFleetReport()
    else loadTechReport()
  }

  // ── Incident pie data ─────────────────────────────────────────────
  const incidentPieData = techReport?.summary
    ? [
        { name: 'Frenadas', value: techReport.summary.hard_brakes },
        { name: 'Aceleraciones', value: techReport.summary.rapid_accels },
        { name: 'Giros bruscos', value: techReport.summary.harsh_turns },
        { name: 'Accidentes', value: techReport.summary.accidents },
      ].filter(d => d.value > 0)
    : []

  const totalIncidents = techReport?.summary
    ? (techReport.summary.hard_brakes + techReport.summary.rapid_accels +
       techReport.summary.harsh_turns + techReport.summary.accidents)
    : 0

  const fleetTotalIncidents = fleetReport?.technicians.reduce(
    (sum, t) => sum + t.hard_brakes + t.rapid_accels + t.harsh_turns + t.accidents, 0
  ) ?? 0

  return (
    <div className="min-h-screen bg-base text-text-primary">
      {/* Top Nav */}
      <div className="sticky top-0 z-50 bg-surface/95 backdrop-blur-sm border-b border-border-soft">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="flex items-center gap-1.5 text-text-muted hover:text-text-primary transition-colors text-sm"
            >
              <ArrowLeft className="w-4 h-4" />
              Inicio
            </Link>
            <span className="text-border-soft">/</span>
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" />
              <span className="font-semibold text-sm">Reportes</span>
            </div>
          </div>

          {/* Date range + generate */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-base border border-border-soft rounded-lg px-3 py-1.5">
              <span className="text-xs text-text-muted">De:</span>
              <input
                type="date"
                value={fromDate}
                max={toDate}
                onChange={e => setFromDate(e.target.value)}
                className="bg-transparent text-xs text-text-primary outline-none"
              />
            </div>
            <div className="flex items-center gap-1.5 bg-base border border-border-soft rounded-lg px-3 py-1.5">
              <span className="text-xs text-text-muted">A:</span>
              <input
                type="date"
                value={toDate}
                min={fromDate}
                max={today}
                onChange={e => setToDate(e.target.value)}
                className="bg-transparent text-xs text-text-primary outline-none"
              />
            </div>
            <button
              onClick={handleGenerate}
              className="flex items-center gap-1.5 bg-primary text-base text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-primary-hover transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Generar
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-surface rounded-xl p-1 border border-border-soft w-fit">
          {isSuperAdmin && (
            <button
              onClick={() => setTab('fleet')}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                tab === 'fleet'
                  ? 'bg-primary text-base'
                  : 'text-text-muted hover:text-text-primary'
              )}
            >
              <Users className="w-4 h-4" />
              Flota completa
            </button>
          )}
          <button
            onClick={() => setTab('technician')}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              tab === 'technician'
                ? 'bg-primary text-base'
                : 'text-text-muted hover:text-text-primary'
            )}
          >
            <Activity className="w-4 h-4" />
            Por técnico
          </button>
        </div>

        {/* ── FLEET TAB ──────────────────────────────────────────── */}
        {tab === 'fleet' && (
          <FleetTab
            report={fleetReport}
            loading={fleetLoading}
            error={fleetError}
            totalIncidents={fleetTotalIncidents}
            onDownloadPDF={() => fleetReport && generateFleetPDF(fleetReport)}
          />
        )}

        {/* ── TECHNICIAN TAB ─────────────────────────────────────── */}
        {tab === 'technician' && (
          <TechnicianTab
            technicians={technicians}
            selectedTech={selectedTech}
            onSelectTech={(id) => { setSelectedTech(id); setTechReport(null) }}
            onLoadReport={loadTechReport}
            report={techReport}
            loading={techLoading}
            error={techError}
            incidentPieData={incidentPieData}
            totalIncidents={totalIncidents}
            onDownloadPDF={() => techReport && generateTechnicianPDF(techReport)}
          />
        )}
      </div>
    </div>
  )
}

// ── Fleet Tab ─────────────────────────────────────────────────────────

function FleetTab({ report, loading, error, totalIncidents, onDownloadPDF }: {
  report: FleetReport | null
  loading: boolean
  error: string | null
  totalIncidents: number
  onDownloadPDF: () => void
}) {
  if (loading) return <LoadingState />
  if (error) return <ErrorState msg={error} />
  if (!report) return <EmptyPrompt label="Haz clic en «Generar» para cargar el reporte de flota" />

  const totals = report.technicians.reduce((acc, t) => ({
    trips: acc.trips + t.total_trips,
    km: acc.km + t.total_km,
    min: acc.min + t.total_min,
  }), { trips: 0, km: 0, min: 0 })

  const kmData = report.technicians
    .filter(t => t.total_km > 0)
    .map(t => ({ name: t.name.split(' ')[0], km: t.total_km, viajes: t.total_trips }))

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Técnicos activos" value={report.technicians.length} icon={Users} color="bg-primary" />
        <KpiCard label="Total viajes" value={totals.trips} icon={Route} color="bg-accent" />
        <KpiCard label="Total km" value={totals.km.toFixed(1)} unit="km" icon={TrendingUp} color="bg-success" />
        <KpiCard label="Total incidentes" value={totalIncidents} icon={AlertTriangle} color={totalIncidents > 0 ? 'bg-danger' : 'bg-text-muted/40'} />
      </div>

      {/* Charts */}
      {kmData.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard title="Kilómetros por técnico">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={kmData} margin={{ top: 4, right: 10, bottom: 40, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#252540" />
                <XAxis dataKey="name" tick={{ fill: '#64748B', fontSize: 11 }} angle={-30} textAnchor="end" interval={0} />
                <YAxis tick={{ fill: '#64748B', fontSize: 11 }} unit=" km" />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="km" name="Km" fill="#00D632" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Viajes por técnico">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={kmData} margin={{ top: 4, right: 10, bottom: 40, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#252540" />
                <XAxis dataKey="name" tick={{ fill: '#64748B', fontSize: 11 }} angle={-30} textAnchor="end" interval={0} />
                <YAxis tick={{ fill: '#64748B', fontSize: 11 }} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="viajes" name="Viajes" fill="#7B2FF7" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      )}

      {/* Table */}
      <div className="bg-surface border border-border-soft rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-soft">
          <h3 className="text-sm font-semibold">Detalle por técnico</h3>
          <button
            onClick={onDownloadPDF}
            className="flex items-center gap-1.5 text-xs text-primary hover:text-primary-light transition-colors font-medium"
          >
            <Download className="w-3.5 h-3.5" />
            Descargar PDF
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border-soft bg-base/50">
                {['Técnico', 'Viajes', 'Km', 'Vel. prom.', 'Vel. máx.', 'Horas', 'Frenos', 'Acels.', 'Giros', 'Accident.'].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 text-text-muted font-medium whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.technicians.map((t, i) => (
                <tr key={t.id} className={cn('border-b border-border-soft/50', i % 2 === 0 ? '' : 'bg-base/30')}>
                  <td className="px-4 py-2.5 font-medium text-text-primary">{t.name}</td>
                  <td className="px-4 py-2.5 text-text-secondary">{t.total_trips}</td>
                  <td className="px-4 py-2.5 text-text-secondary">{t.total_km.toFixed(1)}</td>
                  <td className="px-4 py-2.5 text-text-secondary">{t.avg_speed_kmh.toFixed(1)}</td>
                  <td className="px-4 py-2.5 text-text-secondary">{t.max_speed_kmh.toFixed(1)}</td>
                  <td className="px-4 py-2.5 text-text-secondary">{fmtMin(t.total_min)}</td>
                  <td className="px-4 py-2.5">{t.hard_brakes > 0 ? <Badge val={t.hard_brakes} color="warning" /> : <span className="text-text-muted">0</span>}</td>
                  <td className="px-4 py-2.5">{t.rapid_accels > 0 ? <Badge val={t.rapid_accels} color="warning" /> : <span className="text-text-muted">0</span>}</td>
                  <td className="px-4 py-2.5">{t.harsh_turns > 0 ? <Badge val={t.harsh_turns} color="warning" /> : <span className="text-text-muted">0</span>}</td>
                  <td className="px-4 py-2.5">{t.accidents > 0 ? <Badge val={t.accidents} color="danger" /> : <span className="text-text-muted">0</span>}</td>
                </tr>
              ))}
              {report.technicians.length === 0 && (
                <tr><td colSpan={10} className="text-center py-8 text-text-muted">Sin datos para el período seleccionado</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  )
}

// ── Technician Tab ────────────────────────────────────────────────────

function TechnicianTab({ technicians, selectedTech, onSelectTech, onLoadReport, report, loading, error, incidentPieData, totalIncidents, onDownloadPDF }: {
  technicians: TechnicianOption[]
  selectedTech: string
  onSelectTech: (id: string) => void
  onLoadReport: () => void
  report: TechnicianReport | null
  loading: boolean
  error: string | null
  incidentPieData: { name: string; value: number }[]
  totalIncidents: number
  onDownloadPDF: () => void
}) {
  const s = report?.summary

  return (
    <div className="space-y-6">
      {/* Technician selector */}
      <div className="flex items-center gap-3">
        <div className="relative">
          <select
            value={selectedTech}
            onChange={e => onSelectTech(e.target.value)}
            className="appearance-none bg-surface border border-border-soft rounded-xl pl-4 pr-9 py-2 text-sm text-text-primary outline-none focus:border-primary transition-colors cursor-pointer"
          >
            {technicians.length === 0 && <option value="">Sin técnicos registrados</option>}
            {technicians.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <ChevronDown className="w-4 h-4 text-text-muted absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
        <button
          onClick={onLoadReport}
          disabled={!selectedTech}
          className="flex items-center gap-1.5 bg-surface border border-border-soft text-sm px-3 py-2 rounded-xl hover:border-primary text-text-secondary hover:text-primary transition-colors disabled:opacity-50"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Cargar
        </button>
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState msg={error} />}
      {!loading && !error && !report && (
        <EmptyPrompt label="Selecciona un técnico y haz clic en «Cargar»" />
      )}

      {report && !loading && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard label="Total viajes" value={s?.total_trips ?? 0} icon={Route} color="bg-accent" />
            <KpiCard label="Total km" value={(s?.total_km ?? 0).toFixed(1)} unit="km" icon={TrendingUp} color="bg-primary" />
            <KpiCard label="Vel. promedio" value={(s?.avg_speed_kmh ?? 0).toFixed(1)} unit="km/h" icon={Activity} color="bg-success" />
            <KpiCard label="Incidentes" value={totalIncidents} icon={AlertTriangle} color={totalIncidents > 0 ? 'bg-danger' : 'bg-text-muted/40'} />
          </div>

          {/* Charts */}
          {report.daily.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2">
                <ChartCard title="Actividad diaria">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={report.daily} margin={{ top: 4, right: 10, bottom: 10, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#252540" />
                      <XAxis dataKey="date" tick={{ fill: '#64748B', fontSize: 11 }}
                        tickFormatter={d => format(parseISO(d), 'dd/MM', { locale: es })} />
                      <YAxis yAxisId="km" tick={{ fill: '#64748B', fontSize: 11 }} unit=" km" />
                      <YAxis yAxisId="trips" orientation="right" tick={{ fill: '#64748B', fontSize: 11 }} allowDecimals={false} />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 11, color: '#94A3B8' }} />
                      <Bar yAxisId="km" dataKey="km" name="Km" fill="#00D632" radius={[3, 3, 0, 0]} />
                      <Bar yAxisId="trips" dataKey="trips" name="Viajes" fill="#7B2FF7" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>
              </div>

              <ChartCard title="Tipos de incidentes">
                {incidentPieData.length === 0 ? (
                  <div className="h-[220px] flex items-center justify-center text-sm text-text-muted">Sin incidentes</div>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={incidentPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label={({ name, value }) => `${name}: ${value}`} labelLine={{ stroke: '#64748B' }}>
                        {incidentPieData.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </ChartCard>
            </div>
          )}

          {/* Trips table */}
          <div className="bg-surface border border-border-soft rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-soft">
              <h3 className="text-sm font-semibold">
                Lista de viajes
                <span className="ml-2 text-xs text-text-muted font-normal">({report.trips.length})</span>
              </h3>
              <button
                onClick={onDownloadPDF}
                className="flex items-center gap-1.5 text-xs text-primary hover:text-primary-light transition-colors font-medium"
              >
                <Download className="w-3.5 h-3.5" />
                Descargar PDF
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border-soft bg-base/50">
                    {['Inicio', 'Fin', 'Duración', 'Km', 'Vel. prom.', 'Vel. máx.', 'Frenos', 'Acels.', 'Giros', 'Accident.'].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-text-muted font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.trips.map((t, i) => {
                    const hasIncident = t.accidents > 0
                    return (
                      <tr key={t.id} className={cn('border-b border-border-soft/50', i % 2 === 0 ? '' : 'bg-base/30', hasIncident && 'bg-danger/5')}>
                        <td className="px-4 py-2.5 text-text-secondary whitespace-nowrap">{fmtDateTime(t.started_at)}</td>
                        <td className="px-4 py-2.5 text-text-secondary whitespace-nowrap">{t.ended_at ? fmtDateTime(t.ended_at) : '—'}</td>
                        <td className="px-4 py-2.5 text-text-secondary">{fmtMin(t.duration_min)}</td>
                        <td className="px-4 py-2.5 font-medium text-text-primary">{t.distance_km.toFixed(1)}</td>
                        <td className="px-4 py-2.5 text-text-secondary">{t.avg_speed_kmh.toFixed(1)}</td>
                        <td className="px-4 py-2.5 text-text-secondary">{t.max_speed_kmh.toFixed(1)}</td>
                        <td className="px-4 py-2.5">{t.hard_brakes > 0 ? <Badge val={t.hard_brakes} color="warning" /> : <span className="text-text-muted">0</span>}</td>
                        <td className="px-4 py-2.5">{t.rapid_accels > 0 ? <Badge val={t.rapid_accels} color="warning" /> : <span className="text-text-muted">0</span>}</td>
                        <td className="px-4 py-2.5">{t.harsh_turns > 0 ? <Badge val={t.harsh_turns} color="warning" /> : <span className="text-text-muted">0</span>}</td>
                        <td className="px-4 py-2.5">{t.accidents > 0 ? <Badge val={t.accidents} color="danger" /> : <span className="text-text-muted">0</span>}</td>
                      </tr>
                    )
                  })}
                  {report.trips.length === 0 && (
                    <tr><td colSpan={10} className="text-center py-8 text-text-muted">Sin viajes en el período seleccionado</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  )
}

// ── Utility sub-components ────────────────────────────────────────────

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border-soft rounded-xl p-4">
      <h3 className="text-xs font-semibold text-text-secondary mb-3">{title}</h3>
      {children}
    </div>
  )
}

function Badge({ val, color }: { val: number; color: 'warning' | 'danger' }) {
  return (
    <span className={cn('inline-flex items-center justify-center w-5 h-5 rounded text-white text-xs font-bold', color === 'warning' ? 'bg-warning' : 'bg-danger')}>
      {val}
    </span>
  )
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function ErrorState({ msg }: { msg: string }) {
  return (
    <div className="bg-danger/10 border border-danger/30 rounded-xl px-4 py-6 text-center">
      <AlertTriangle className="w-6 h-6 text-danger mx-auto mb-2" />
      <p className="text-sm text-danger">{msg}</p>
    </div>
  )
}

function EmptyPrompt({ label }: { label: string }) {
  return (
    <div className="border border-dashed border-border-soft rounded-xl px-6 py-16 text-center">
      <FileText className="w-8 h-8 text-text-muted mx-auto mb-3" />
      <p className="text-sm text-text-muted">{label}</p>
    </div>
  )
}
