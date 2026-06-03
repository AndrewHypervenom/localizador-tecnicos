import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { utils, writeFile } from 'xlsx'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

// ─────────────────────────────────────────────────────────────────────────────
// Exportación de reportes del líder: PDF enriquecido + Excel multi-hoja.
// Pensado para que el líder entienda de un vistazo el cumplimiento de rutas y
// las horas trabajadas (regulares vs. extra) y pueda cruzar información.
// ─────────────────────────────────────────────────────────────────────────────

export interface RouteStat {
  techId: string
  name: string
  assigned: number
  completed: number
  in_progress: number
  failed: number
}

/** Fila diaria de horas (una por técnico y día). */
export interface HoursDaily {
  techId: string
  name: string
  company: string | null
  date: string          // yyyy-MM-dd (fecha local de la empresa)
  firstLocal: string    // HH:MM entrada
  lastLocal: string     // HH:MM salida
  points: number
  workedSec: number
  regularSec: number
  overtimeSec: number
  isWeekend: boolean
}

/** Agregado de horas por técnico en todo el período. */
export interface HoursAgg {
  techId: string
  name: string
  company: string | null
  daysWorked: number
  workedSec: number
  regularSec: number
  overtimeSec: number
  weekendSec: number
}

export interface ReportMeta {
  from: string
  to: string
  companyName: string   // "Todas las empresas" o el nombre concreto
  leaderName?: string
}

// ── Helpers de formato ───────────────────────────────────────────────────────

export function hm(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600)
  const m = Math.round((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

/** Horas en decimal (para cruces/sumas en Excel). 2 decimales. */
export function hoursDec(sec: number): number {
  return Math.round((sec / 3600) * 100) / 100
}

function pct(done: number, total: number): number {
  return total > 0 ? Math.round((done / total) * 100) : 0
}

function fmtDay(d: string): string {
  try { return format(new Date(d + 'T00:00:00'), 'EEE d MMM', { locale: es }) } catch { return d }
}

function fileStamp(meta: ReportMeta): string {
  const comp = meta.companyName.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase().slice(0, 24)
  return `${meta.from}_a_${meta.to}_${comp}`
}

// ── Agregación de horas diarias → por técnico ────────────────────────────────

export function aggregateHours(daily: HoursDaily[]): HoursAgg[] {
  const map = new Map<string, HoursAgg>()
  for (const d of daily) {
    const a = map.get(d.techId) ?? {
      techId: d.techId, name: d.name, company: d.company,
      daysWorked: 0, workedSec: 0, regularSec: 0, overtimeSec: 0, weekendSec: 0,
    }
    if (d.points > 0) a.daysWorked += 1
    a.workedSec   += d.workedSec
    a.regularSec  += d.regularSec
    a.overtimeSec += d.overtimeSec
    if (d.isWeekend) a.weekendSec += d.workedSec
    map.set(d.techId, a)
  }
  return [...map.values()].sort((x, y) => y.overtimeSec - x.overtimeSec || y.workedSec - x.workedSec)
}

// ─────────────────────────────────────────────────────────────────────────────
// EXCEL
// ─────────────────────────────────────────────────────────────────────────────

export function exportLeaderExcel(
  meta: ReportMeta,
  routes: RouteStat[],
  hoursAgg: HoursAgg[],
  hoursDaily: HoursDaily[],
) {
  const wb = utils.book_new()

  // ── Hoja 1: Resumen (cruce rutas + horas por técnico) ──
  const routeById = new Map(routes.map(r => [r.techId, r]))
  const techIds = new Set<string>([...routes.map(r => r.techId), ...hoursAgg.map(h => h.techId)])
  const nameById = new Map<string, { name: string; company: string | null }>()
  hoursAgg.forEach(h => nameById.set(h.techId, { name: h.name, company: h.company }))
  routes.forEach(r => { if (!nameById.has(r.techId)) nameById.set(r.techId, { name: r.name, company: null }) })
  const hoursById = new Map(hoursAgg.map(h => [h.techId, h]))

  const resumen = [...techIds].map(id => {
    const r = routeById.get(id)
    const h = hoursById.get(id)
    const info = nameById.get(id)!
    return {
      'Técnico': info.name,
      'Empresa': info.company ?? '',
      'Días trabajados': h?.daysWorked ?? 0,
      'Horas trabajadas': hoursDec(h?.workedSec ?? 0),
      'Horas regulares': hoursDec(h?.regularSec ?? 0),
      'Horas extra': hoursDec(h?.overtimeSec ?? 0),
      'Horas fin de semana': hoursDec(h?.weekendSec ?? 0),
      'Prom. h/día': h && h.daysWorked > 0 ? Math.round((h.workedSec / h.daysWorked / 3600) * 100) / 100 : 0,
      'Rutas asignadas': r?.assigned ?? 0,
      'Rutas completadas': r?.completed ?? 0,
      'En progreso': r?.in_progress ?? 0,
      'Fallidas': r?.failed ?? 0,
      '% Cumplimiento': r ? pct(r.completed, r.assigned) : 0,
    }
  }).sort((a, b) => (b['Horas extra'] as number) - (a['Horas extra'] as number))

  const wsResumen = utils.json_to_sheet(resumen.length ? resumen : [{ 'Sin datos': '' }])
  autoWidth(wsResumen, resumen)
  utils.book_append_sheet(wb, wsResumen, 'Resumen')

  // ── Hoja 2: Horas por día (detalle para cruces) ──
  const detalle = hoursDaily
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name) || a.date.localeCompare(b.date))
    .map(d => ({
      'Técnico': d.name,
      'Empresa': d.company ?? '',
      'Fecha': d.date,
      'Día': fmtDay(d.date),
      'Fin de semana': d.isWeekend ? 'Sí' : 'No',
      'Entrada': d.firstLocal,
      'Salida': d.lastLocal,
      'Horas trabajadas': hoursDec(d.workedSec),
      'Horas regulares': hoursDec(d.regularSec),
      'Horas extra': hoursDec(d.overtimeSec),
      'Registros GPS': d.points,
    }))
  const wsDetalle = utils.json_to_sheet(detalle.length ? detalle : [{ 'Sin datos': '' }])
  autoWidth(wsDetalle, detalle)
  utils.book_append_sheet(wb, wsDetalle, 'Horas por día')

  // ── Hoja 3: Cumplimiento de rutas ──
  const rutas = routes
    .slice()
    .sort((a, b) => pct(b.completed, b.assigned) - pct(a.completed, a.assigned))
    .map(r => ({
      'Técnico': r.name,
      'Asignadas': r.assigned,
      'Completadas': r.completed,
      'En progreso': r.in_progress,
      'Fallidas': r.failed,
      '% Cumplimiento': pct(r.completed, r.assigned),
    }))
  const wsRutas = utils.json_to_sheet(rutas.length ? rutas : [{ 'Sin datos': '' }])
  autoWidth(wsRutas, rutas)
  utils.book_append_sheet(wb, wsRutas, 'Cumplimiento rutas')

  writeFile(wb, `reporte_${fileStamp(meta)}.xlsx`)
}

/** Ajusta el ancho de columnas al contenido más largo. */
function autoWidth(ws: any, rows: any[]) {
  if (!rows.length) return
  const keys = Object.keys(rows[0])
  ws['!cols'] = keys.map(k => {
    const maxLen = Math.max(k.length, ...rows.map(r => String(r[k] ?? '').length))
    return { wch: Math.min(Math.max(maxLen + 2, 8), 40) }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF
// ─────────────────────────────────────────────────────────────────────────────

const GREEN: [number, number, number] = [0, 214, 50]
const DARK:  [number, number, number] = [10, 10, 20]
const SLATE: [number, number, number] = [20, 20, 32]

export function exportLeaderPdf(
  meta: ReportMeta,
  routes: RouteStat[],
  hoursAgg: HoursAgg[],
) {
  const doc = new jsPDF({ orientation: 'landscape' })
  const pageW = doc.internal.pageSize.getWidth()
  const now = format(new Date(), 'dd/MM/yyyy HH:mm', { locale: es })

  // ── Cabecera ──
  doc.setFillColor(...DARK)
  doc.rect(0, 0, pageW, 32, 'F')
  doc.setTextColor(...GREEN)
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text('REPORTE DE TÉCNICOS', 14, 13)
  doc.setTextColor(200, 200, 200)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text('PositivoS+ · Localizador GPS', 14, 20)
  doc.text(`Período: ${meta.from}  —  ${meta.to}`, 14, 26)
  doc.text(`Empresa: ${meta.companyName}`, 110, 20)
  doc.text(`Generado: ${now}`, 110, 26)

  // ── Totales ──
  const tot = hoursAgg.reduce((a, h) => ({
    worked: a.worked + h.workedSec,
    regular: a.regular + h.regularSec,
    overtime: a.overtime + h.overtimeSec,
  }), { worked: 0, regular: 0, overtime: 0 })
  const rt = routes.reduce((a, r) => ({
    assigned: a.assigned + r.assigned,
    completed: a.completed + r.completed,
  }), { assigned: 0, completed: 0 })

  doc.setTextColor(30, 30, 30)
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text('Resumen general', 14, 42)

  autoTable(doc, {
    startY: 46,
    head: [['Técnicos', 'Horas trabajadas', 'Horas regulares', 'Horas extra', 'Rutas asignadas', 'Completadas', '% Cumplimiento']],
    body: [[
      String(hoursAgg.length || routes.length),
      hm(tot.worked),
      hm(tot.regular),
      hm(tot.overtime),
      String(rt.assigned),
      String(rt.completed),
      `${pct(rt.completed, rt.assigned)}%`,
    ]],
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: GREEN, textColor: DARK, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 245, 248] },
    margin: { left: 14, right: 14 },
  })

  // ── Horas por técnico ──
  let y = (doc as any).lastAutoTable.finalY + 8
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(30, 30, 30)
  doc.text('Horas trabajadas por técnico', 14, y)

  autoTable(doc, {
    startY: y + 4,
    head: [['Técnico', 'Empresa', 'Días', 'Trabajadas', 'Regulares', 'Extra', 'Fin de semana', 'Prom. h/día']],
    body: aggregateSorted(hoursAgg).map(h => [
      h.name,
      h.company ?? '—',
      String(h.daysWorked),
      hm(h.workedSec),
      hm(h.regularSec),
      hm(h.overtimeSec),
      hm(h.weekendSec),
      h.daysWorked > 0 ? hm(h.workedSec / h.daysWorked) : '—',
    ]),
    styles: { fontSize: 8, cellPadding: 2.5 },
    headStyles: { fillColor: SLATE, textColor: [200, 200, 200], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 245, 248] },
    // Resaltar horas extra (>0) en color
    didParseCell: (d: any) => {
      if (d.section === 'body' && d.column.index === 5 && d.cell.raw !== '0m') {
        d.cell.styles.textColor = [180, 83, 9]
        d.cell.styles.fontStyle = 'bold'
      }
    },
    margin: { left: 14, right: 14 },
  })

  // ── Cumplimiento de rutas ──
  if (routes.length) {
    y = (doc as any).lastAutoTable.finalY + 8
    if (y > doc.internal.pageSize.getHeight() - 30) { doc.addPage('landscape'); y = 18 }
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(30, 30, 30)
    doc.text('Cumplimiento de rutas', 14, y)

    autoTable(doc, {
      startY: y + 4,
      head: [['Técnico', 'Asignadas', 'Completadas', 'En progreso', 'Fallidas', '% Cumplimiento']],
      body: routes
        .slice()
        .sort((a, b) => pct(b.completed, b.assigned) - pct(a.completed, a.assigned))
        .map(r => [
          r.name, String(r.assigned), String(r.completed), String(r.in_progress), String(r.failed),
          `${pct(r.completed, r.assigned)}%`,
        ]),
      styles: { fontSize: 8, cellPadding: 2.5 },
      headStyles: { fillColor: SLATE, textColor: [200, 200, 200], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 245, 248] },
      margin: { left: 14, right: 14 },
    })
  }

  // ── Pie de página ──
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(150, 150, 150)
    doc.text(
      `PositivoS+ · Localizador  ·  Página ${i} de ${pages}`,
      pageW / 2, doc.internal.pageSize.getHeight() - 6, { align: 'center' },
    )
  }

  doc.save(`reporte_${fileStamp(meta)}.pdf`)
}

function aggregateSorted(h: HoursAgg[]): HoursAgg[] {
  return h.slice().sort((a, b) => b.overtimeSec - a.overtimeSec || b.workedSec - a.workedSec)
}
