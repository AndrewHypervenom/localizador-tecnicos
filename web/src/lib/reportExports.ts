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

/** Tracking por técnico en el período (distancias, viajes, zonas, incidentes). */
export interface TrackStat {
  techId: string
  name: string
  company: string | null
  km: number
  trips: number
  durationMin: number
  avgSpeed: number
  maxSpeed: number
  zoneEnters: number
  zoneExits: number
  incidents: number
  deviceTampers: number   // eventos de sabotaje al rastreo en el período
  batteryDrainPerH?: number | null  // %/h de drenaje del equipo (sin cargar) mientras rastreaba
  trackedHours?: number   // horas con muestras de batería cercanas (sin cargar)
}

/** Un evento de la bitácora de dispositivo (para la sección/hoja de detalle). */
export interface DeviceEventRow {
  techId: string
  name: string
  company: string | null
  ts: string        // ISO
  type: string      // event_type
}

// Eventos que cuentan como SABOTAJE/mal uso del rastreo (para el conteo y la
// bitácora de evidencia). Las recuperaciones (gps_on, net_on, …) y el inicio de
// rastreo no se cuentan como sabotaje.
export const DEVICE_TAMPER_TYPES = [
  'gps_off', 'net_off', 'mock_on', 'battery_restricted', 'tracking_killed', 'tracking_stop',
  'perm_revoked', 'clock_skew',
]

export const DEVICE_EVENT_LABELS: Record<string, string> = {
  gps_off:              'Apagó el GPS',
  gps_on:               'Reactivó el GPS',
  net_off:              'Apagó datos / Wi-Fi',
  net_on:               'Reactivó datos / Wi-Fi',
  mock_on:              'Ubicación falsa (Fake GPS)',
  mock_off:             'Cesó ubicación falsa',
  battery_restricted:   'Restringió la batería',
  battery_unrestricted: 'Quitó restricción de batería',
  tracking_killed:      'Cerró la app a la fuerza',
  tracking_stop:        'Detuvo la localización',
  tracking_start:       'Inició la localización',
  perm_revoked:         'Quitó "Permitir siempre"',
  perm_granted:         'Restauró "Permitir siempre"',
  clock_skew:           'Reloj del teléfono alterado',
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
  track: TrackStat[],
  routes: RouteStat[],
  hoursAgg: HoursAgg[],
  hoursDaily: HoursDaily[],
  deviceEvents: DeviceEventRow[] = [],
) {
  const wb = utils.book_new()

  // ── Hoja 1: Resumen (cruce tracking + servicios + horas por técnico) ──
  const routeById = new Map(routes.map(r => [r.techId, r]))
  const trackById = new Map(track.map(t => [t.techId, t]))
  const hoursById = new Map(hoursAgg.map(h => [h.techId, h]))
  const techIds = new Set<string>([
    ...track.map(t => t.techId), ...routes.map(r => r.techId), ...hoursAgg.map(h => h.techId),
  ])
  const nameById = new Map<string, { name: string; company: string | null }>()
  track.forEach(t => nameById.set(t.techId, { name: t.name, company: t.company }))
  hoursAgg.forEach(h => { if (!nameById.has(h.techId)) nameById.set(h.techId, { name: h.name, company: h.company }) })
  routes.forEach(r => { if (!nameById.has(r.techId)) nameById.set(r.techId, { name: r.name, company: null }) })

  const resumen = [...techIds].map(id => {
    const t = trackById.get(id)
    const r = routeById.get(id)
    const h = hoursById.get(id)
    const info = nameById.get(id)!
    return {
      'Técnico': info.name,
      'Empresa': info.company ?? '',
      // Tracking primero
      'Km recorridos': Math.round((t?.km ?? 0) * 10) / 10,
      'Viajes': t?.trips ?? 0,
      'Horas en ruta': Math.round(((t?.durationMin ?? 0) / 60) * 100) / 100,
      'Vel. prom (km/h)': Math.round((t?.avgSpeed ?? 0) * 10) / 10,
      'Vel. máx (km/h)': Math.round((t?.maxSpeed ?? 0) * 10) / 10,
      'Entradas a zona': t?.zoneEnters ?? 0,
      'Salidas de zona': t?.zoneExits ?? 0,
      'Incidentes': t?.incidents ?? 0,
      'Sabotajes (disp.)': t?.deviceTampers ?? 0,
      // Servicios
      'Servicios asignados': r?.assigned ?? 0,
      'Servicios completados': r?.completed ?? 0,
      'En progreso': r?.in_progress ?? 0,
      'Fallidos': r?.failed ?? 0,
      '% Cumplimiento': r ? pct(r.completed, r.assigned) : 0,
      // Horas (extra al final)
      'Días trabajados': h?.daysWorked ?? 0,
      'Horas trabajadas': hoursDec(h?.workedSec ?? 0),
      'Horas regulares': hoursDec(h?.regularSec ?? 0),
      'Horas extra': hoursDec(h?.overtimeSec ?? 0),
    }
  }).sort((a, b) => (b['Km recorridos'] as number) - (a['Km recorridos'] as number))

  const wsResumen = utils.json_to_sheet(resumen.length ? resumen : [{ 'Sin datos': '' }])
  autoWidth(wsResumen, resumen)
  utils.book_append_sheet(wb, wsResumen, 'Resumen')

  // ── Hoja 2: Tracking por técnico ──
  const tracking = track
    .slice()
    .sort((a, b) => b.km - a.km)
    .map(t => ({
      'Técnico': t.name,
      'Empresa': t.company ?? '',
      'Km recorridos': Math.round(t.km * 10) / 10,
      'Viajes': t.trips,
      'Horas en ruta': Math.round((t.durationMin / 60) * 100) / 100,
      'Vel. prom (km/h)': Math.round(t.avgSpeed * 10) / 10,
      'Vel. máx (km/h)': Math.round(t.maxSpeed * 10) / 10,
      'Entradas a zona': t.zoneEnters,
      'Salidas de zona': t.zoneExits,
      'Incidentes': t.incidents,
      'Sabotajes (disp.)': t.deviceTampers,
      'Batería %/h (sin cargar)': t.batteryDrainPerH != null ? Math.round(t.batteryDrainPerH * 10) / 10 : '',
      'Horas con muestra batería': t.trackedHours != null ? Math.round(t.trackedHours * 10) / 10 : '',
    }))
  const wsTracking = utils.json_to_sheet(tracking.length ? tracking : [{ 'Sin datos': '' }])
  autoWidth(wsTracking, tracking)
  utils.book_append_sheet(wb, wsTracking, 'Tracking')

  // ── Hoja: Bitácora de dispositivo (evidencia de sabotaje) ──
  const bitacora = deviceEvents
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name) || a.ts.localeCompare(b.ts))
    .map(e => ({
      'Técnico': e.name,
      'Empresa': e.company ?? '',
      'Fecha': format(new Date(e.ts), 'yyyy-MM-dd'),
      'Hora':  format(new Date(e.ts), 'HH:mm'),
      'Evento': DEVICE_EVENT_LABELS[e.type] ?? e.type,
    }))
  const wsBit = utils.json_to_sheet(bitacora.length ? bitacora : [{ 'Sin eventos de dispositivo en el período': '' }])
  autoWidth(wsBit, bitacora)
  utils.book_append_sheet(wb, wsBit, 'Bitácora dispositivo')

  // ── Hoja 3: Horas por día (detalle para cruces) ──
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
  track: TrackStat[],
  routes: RouteStat[],
  hoursAgg: HoursAgg[],
  deviceEvents: DeviceEventRow[] = [],
) {
  const doc = new jsPDF({ orientation: 'landscape' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const now = format(new Date(), 'dd/MM/yyyy HH:mm', { locale: es })

  const headStyles = (rgb: [number, number, number], text: [number, number, number]) =>
    ({ fillColor: rgb, textColor: text, fontStyle: 'bold' as const })
  const baseStyles = { fontSize: 8, cellPadding: 2.5 }
  const zebra = { fillColor: [245, 245, 248] as [number, number, number] }

  /** Título de sección con salto de página automático. Devuelve el startY de la tabla. */
  const section = (title: string): number => {
    let yy = ((doc as any).lastAutoTable?.finalY ?? 36) + 9
    if (yy > pageH - 26) { doc.addPage('landscape'); yy = 18 }
    doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(30, 30, 30)
    doc.text(title, 14, yy)
    return yy + 4
  }

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
  doc.text(`Empresa: ${meta.companyName}`, 130, 20)
  doc.text(`Generado: ${now}`, 130, 26)

  // ── Resumen general (tracking primero) ──
  const tt = track.reduce((a, t) => ({
    km: a.km + t.km, trips: a.trips + t.trips,
    enters: a.enters + t.zoneEnters, exits: a.exits + t.zoneExits, inc: a.inc + t.incidents,
  }), { km: 0, trips: 0, enters: 0, exits: 0, inc: 0 })
  const rt = routes.reduce((a, r) => ({
    assigned: a.assigned + r.assigned, completed: a.completed + r.completed,
  }), { assigned: 0, completed: 0 })
  const ht = hoursAgg.reduce((a, h) => ({ worked: a.worked + h.workedSec }), { worked: 0 })
  const tamperTotal = track.reduce((a, t) => a + t.deviceTampers, 0)
  const techCount = new Set([...track.map(t => t.techId), ...routes.map(r => r.techId), ...hoursAgg.map(h => h.techId)]).size

  doc.setTextColor(30, 30, 30)
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text('Resumen general', 14, 42)

  autoTable(doc, {
    startY: 46,
    head: [['Técnicos', 'Km recorridos', 'Viajes', 'Servicios completados', 'Entradas a zona', 'Salidas de zona', 'Incidentes', 'Sabotajes', 'Horas trabajadas']],
    body: [[
      String(techCount),
      `${tt.km.toFixed(1)} km`,
      String(tt.trips),
      `${rt.completed} / ${rt.assigned}`,
      String(tt.enters),
      String(tt.exits),
      String(tt.inc),
      String(tamperTotal),
      hm(ht.worked),
    ]],
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: headStyles(GREEN, DARK),
    alternateRowStyles: zebra,
    margin: { left: 14, right: 14 },
  })

  // ── 1) Tracking por técnico (lo principal) ──
  autoTable(doc, {
    startY: section('Tracking por técnico'),
    head: [['Técnico', 'Empresa', 'Km', 'Viajes', 'Tiempo en ruta', 'Vel. prom.', 'Vel. máx.', 'Entradas', 'Salidas', 'Incidentes', 'Sabotajes', 'Batería %/h']],
    body: track.slice().sort((a, b) => b.km - a.km).map(t => [
      t.name, t.company ?? '—',
      t.km.toFixed(1), String(t.trips), hm(t.durationMin * 60),
      `${t.avgSpeed.toFixed(1)}`, `${t.maxSpeed.toFixed(1)}`,
      String(t.zoneEnters), String(t.zoneExits), String(t.incidents), String(t.deviceTampers),
      t.batteryDrainPerH != null ? t.batteryDrainPerH.toFixed(1) : '—',
    ]),
    styles: baseStyles,
    headStyles: headStyles(SLATE, [200, 200, 200]),
    alternateRowStyles: zebra,
    margin: { left: 14, right: 14 },
  })

  // ── Bitácora de dispositivo (sabotaje al rastreo) ──
  // Conteo por técnico y tipo: la evidencia de que el técnico apagó GPS/datos,
  // usó Fake GPS, restringió la batería o cerró la app a la fuerza.
  const tamperByTech = new Map<string, { name: string; company: string | null; counts: Record<string, number>; total: number }>()
  for (const e of deviceEvents) {
    if (!DEVICE_TAMPER_TYPES.includes(e.type)) continue
    let g = tamperByTech.get(e.techId)
    if (!g) { g = { name: e.name, company: e.company, counts: {}, total: 0 }; tamperByTech.set(e.techId, g) }
    g.counts[e.type] = (g.counts[e.type] ?? 0) + 1
    g.total += 1
  }
  const tamperRows = [...tamperByTech.values()].sort((a, b) => b.total - a.total)
  const yBit = section('Bitácora de dispositivo (sabotaje al rastreo)')
  if (tamperRows.length) {
    autoTable(doc, {
      startY: yBit,
      head: [['Técnico', 'Empresa', 'GPS off', 'Datos off', 'Fake GPS', 'Batería', 'App cerrada', 'Detuvo', 'Permiso', 'Reloj', 'Total']],
      body: tamperRows.map(g => [
        g.name, g.company ?? '—',
        String(g.counts['gps_off'] ?? 0),
        String(g.counts['net_off'] ?? 0),
        String(g.counts['mock_on'] ?? 0),
        String(g.counts['battery_restricted'] ?? 0),
        String(g.counts['tracking_killed'] ?? 0),
        String(g.counts['tracking_stop'] ?? 0),
        String(g.counts['perm_revoked'] ?? 0),
        String(g.counts['clock_skew'] ?? 0),
        String(g.total),
      ]),
      styles: baseStyles,
      headStyles: headStyles([153, 27, 27], [255, 255, 255]),
      alternateRowStyles: { fillColor: [253, 242, 242] },
      margin: { left: 14, right: 14 },
    })
  } else {
    doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(90, 90, 90)
    doc.text('Sin eventos de sabotaje al rastreo en el período.', 14, yBit + 2)
  }

  // ── 2) Servicios (cumplimiento de rutas) ──
  if (routes.length) {
    autoTable(doc, {
      startY: section('Servicios (cumplimiento de rutas)'),
      head: [['Técnico', 'Asignados', 'Completados', 'En progreso', 'Fallidos', '% Cumplimiento']],
      body: routes.slice().sort((a, b) => pct(b.completed, b.assigned) - pct(a.completed, a.assigned)).map(r => [
        r.name, String(r.assigned), String(r.completed), String(r.in_progress), String(r.failed),
        `${pct(r.completed, r.assigned)}%`,
      ]),
      styles: baseStyles,
      headStyles: headStyles(SLATE, [200, 200, 200]),
      alternateRowStyles: zebra,
      margin: { left: 14, right: 14 },
    })
  }

  // ── 3) Horas trabajadas (sin foco en extra) ──
  if (hoursAgg.length) {
    autoTable(doc, {
      startY: section('Horas trabajadas por técnico'),
      head: [['Técnico', 'Empresa', 'Días', 'Trabajadas', 'Regulares', 'Prom. h/día']],
      body: hoursAgg.slice().sort((a, b) => b.workedSec - a.workedSec).map(h => [
        h.name, h.company ?? '—', String(h.daysWorked), hm(h.workedSec), hm(h.regularSec),
        h.daysWorked > 0 ? hm(h.workedSec / h.daysWorked) : '—',
      ]),
      styles: baseStyles,
      headStyles: headStyles(SLATE, [200, 200, 200]),
      alternateRowStyles: zebra,
      margin: { left: 14, right: 14 },
    })
  }

  // ── 4) Horas extra — AL FINAL ──
  const withOt = hoursAgg.filter(h => h.overtimeSec > 0).sort((a, b) => b.overtimeSec - a.overtimeSec)
  const yOt = section('Horas extra')
  if (withOt.length) {
    autoTable(doc, {
      startY: yOt,
      head: [['Técnico', 'Empresa', 'Horas extra', 'En fin de semana']],
      body: withOt.map(h => [h.name, h.company ?? '—', hm(h.overtimeSec), h.weekendSec > 0 ? hm(h.weekendSec) : '—']),
      styles: baseStyles,
      headStyles: headStyles([180, 83, 9], [255, 255, 255]),
      alternateRowStyles: { fillColor: [253, 246, 236] },
      margin: { left: 14, right: 14 },
    })
  } else {
    doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(90, 90, 90)
    doc.text('Sin horas extra registradas en el período.', 14, yOt + 2)
  }

  // ── Pie de página ──
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(150, 150, 150)
    doc.text(
      `PositivoS+ · Localizador  ·  Página ${i} de ${pages}`,
      pageW / 2, pageH - 6, { align: 'center' },
    )
  }

  doc.save(`reporte_${fileStamp(meta)}.pdf`)
}
