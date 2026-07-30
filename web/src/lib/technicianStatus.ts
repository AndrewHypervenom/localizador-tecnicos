// ── Semáforo de estado del técnico — FUENTE ÚNICA DE VERDAD ───────────────────
//
// Antes cada pantalla del sitio (mapa, lista, Resumen, Rutas, Técnicos) repetía
// su propia cadena de ternarios con colores y etiquetas distintas para el MISMO
// estado. El resultado era que 'idle' se llamaba "Activo" en el mapa e "Inactivo"
// en Resumen, y que 'offline' era rojo en una pantalla y gris en otra. Los
// técnicos dejaron de confiar en el color porque no significaba lo mismo en dos
// lugares. Todo eso vive aquí ahora y las pantallas solo consumen.
//
// REGLA DEL COLOR — responde "¿tengo que hacer algo?", no "¿se está moviendo?":
//
//   VERDE  (ok)   La app está sirviendo. Llegan posiciones al día. Da igual si
//                 va manejando o está parado en una instalación: el rastreo
//                 funciona y no hay nada que hacer. NO se pinta de ámbar a
//                 alguien que simplemente está quieto trabajando.
//   ÁMBAR  (warn) La app vive (sigue latiendo) pero el rastreo está degradado.
//                 SIEMPRE va acompañado del motivo concreto — es la diferencia
//                 entre "algo pasa" y "el GPS del teléfono está apagado".
//   ROJO   (down) El rastreo se cayó (ni posiciones ni latido) o hay accidente.
//                 Requiere llamar al técnico.
//   GRIS   (none) No aplica: el técnico no tiene teléfono vinculado todavía.
//
import type { Locale } from 'date-fns'
import { formatDistanceToNowStrict } from 'date-fns'
import type { TechnicianStatus } from '@/store/trackingStore'
import type { TFunc } from '@/lib/i18n/i18n'

/** Qué acción implica el color. Un tono = una acción del líder. */
export type StatusTone = 'ok' | 'warn' | 'down' | 'none'

interface ToneStyle {
  /** Punto de color de las listas. */
  dot: string
  /** Color del texto de la etiqueta. */
  text: string
  /** Píldora (fondo + texto + borde) para las vistas de Resumen y Rutas. */
  pill: string
  /** Hex para los marcadores de Leaflet, que no admiten clases de Tailwind. */
  hex: string
}

// Un solo lugar define los 4 colores. `warning` y `amber-500` de Tailwind son el
// MISMO hex (#F59E0B); el código antiguo mezclaba los dos sin razón, así que
// aquí se usa el token del design system (`warning`) y punto.
export const TONE_STYLE: Record<StatusTone, ToneStyle> = {
  ok:   { dot: 'bg-success', text: 'text-success',   pill: 'bg-success/10 text-success border-success/20',   hex: '#10B981' },
  warn: { dot: 'bg-warning', text: 'text-warning',   pill: 'bg-warning/10 text-warning border-warning/20',   hex: '#F59E0B' },
  down: { dot: 'bg-danger',  text: 'text-danger',    pill: 'bg-danger/10 text-danger border-danger/20',      hex: '#EF4444' },
  none: { dot: 'bg-border',  text: 'text-text-muted',pill: 'bg-surface-raised text-text-muted border-border',hex: '#64748B' },
}

/** Estado → tono. El único mapa que decide de qué color se ve cada cosa. */
const STATUS_TONE: Record<TechnicianStatus, StatusTone> = {
  moving:    'ok',
  idle:      'ok',
  no_signal: 'warn',
  stopped:   'warn',
  offline:   'down',
  accident:  'down',
}

/** Orden de urgencia para las listas: lo que requiere acción va primero. */
const STATUS_ORDER: Record<TechnicianStatus, number> = {
  accident: 0, offline: 1, no_signal: 2, stopped: 3, moving: 4, idle: 5,
}

/** Señales necesarias para explicar POR QUÉ el estado es el que es. */
export interface StatusSignals {
  status?: TechnicianStatus | string | null
  /** Última posición GPS recibida (ISO). */
  lastSeen?: string | null
  /** Velocidad del último punto, en m/s (como la guarda la base). */
  lastSpeed?: number | null
  /** false → el técnico nunca vinculó un teléfono con el QR. */
  hasDevice?: boolean
  // Últimas señales del latido: convierten un ámbar mudo en un motivo accionable.
  hbGpsOn?: boolean | null
  hbNetOn?: boolean | null
  hbPerm?: 'full' | 'partial' | 'none' | null
}

export interface StatusDescriptor {
  status: TechnicianStatus
  tone: StatusTone
  /** Etiqueta corta y única en todo el sitio. Ej. "En sitio". */
  label: string
  /** El "por qué" en lenguaje llano. Ej. "GPS apagado en el teléfono". */
  reason: string
  dot: string
  text: string
  pill: string
  hex: string
  order: number
  /** true si el punto debe parpadear (movimiento en vivo o accidente). */
  pulse: boolean
}

function isKnownStatus(s: unknown): s is TechnicianStatus {
  return typeof s === 'string' && s in STATUS_TONE
}

/** "hace 4 minutos" / "hace 2 horas", o null si nunca reportó. */
function ago(t: TFunc, iso: string | null | undefined, locale: Locale): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return t('techStatus.ago', { time: formatDistanceToNowStrict(d, { locale }) })
}

/**
 * Motivo del ámbar 'no_signal'. Se ordena de la causa más accionable (el técnico
 * apagó algo) a la más benigna (está bajo techo). Sin esto el líder solo veía un
 * punto ámbar y asumía lo peor.
 */
function noSignalReason(t: TFunc, s: StatusSignals): string {
  if (s.hbGpsOn === false)                    return t('techStatus.no_signal.gpsOff')
  if (s.hbNetOn === false)                    return t('techStatus.no_signal.netOff')
  if (s.hbPerm && s.hbPerm !== 'full')        return t('techStatus.no_signal.perm')
  return t('techStatus.no_signal.roof')
}

/**
 * Traduce un estado crudo + sus señales a etiqueta, motivo y color.
 * Es lo único que deben llamar los componentes.
 *
 * `locale` es OBLIGATORIO a propósito: los motivos llevan tiempo relativo y, si
 * se omite, date-fns cae a inglés y el líder lee "hace 4 minutes" mezclado con
 * el resto en español. Que TypeScript lo exija impide que vuelva a colarse.
 */
export function describeStatus(t: TFunc, s: StatusSignals, locale: Locale): StatusDescriptor {
  // Sin teléfono vinculado no hay nada que rastrear: gris, y el motivo dice qué
  // hacer (escanear el QR) en vez de dejar al líder adivinando.
  if (s.hasDevice === false) {
    const st = TONE_STYLE.none
    return {
      status: 'offline', tone: 'none',
      label:  t('techStatus.noDevice.label'),
      reason: t('techStatus.noDevice.reason'),
      ...st, order: 6, pulse: false,
    }
  }

  const status: TechnicianStatus = isKnownStatus(s.status) ? s.status : 'offline'
  const tone = STATUS_TONE[status]
  const st   = TONE_STYLE[tone]
  const seen = ago(t, s.lastSeen, locale)

  let label: string
  let reason: string

  switch (status) {
    case 'moving': {
      // lastSpeed viene en m/s; se muestra en km/h porque es lo que el líder lee.
      const kmh = s.lastSpeed != null ? Math.round(s.lastSpeed * 3.6) : 0
      label  = t('techStatus.moving.label')
      reason = kmh > 0
        ? t('techStatus.moving.reason', { speed: kmh })
        : t('techStatus.moving.reasonNoSpeed')
      break
    }
    case 'idle':
      label  = t('techStatus.idle.label')
      reason = seen
        ? t('techStatus.idle.reason', { ago: seen })
        : t('techStatus.idle.reasonNoTime')
      break
    case 'no_signal':
      label  = t('techStatus.no_signal.label')
      reason = noSignalReason(t, s)
      break
    case 'stopped':
      label  = t('techStatus.stopped.label')
      reason = seen
        ? t('techStatus.stopped.reason', { ago: seen })
        : t('techStatus.stopped.reasonNoTime')
      break
    case 'accident':
      label  = t('techStatus.accident.label')
      reason = t('techStatus.accident.reason')
      break
    case 'offline':
    default:
      label  = t('techStatus.offline.label')
      reason = seen
        ? t('techStatus.offline.reason', { ago: seen })
        : t('techStatus.offline.never')
      break
  }

  return {
    status, tone, label, reason,
    ...st,
    order: STATUS_ORDER[status],
    pulse: status === 'moving' || status === 'accident',
  }
}

/** Los 4 tonos en orden, para pintar la leyenda. */
export const LEGEND_TONES: { tone: StatusTone; labelKey: string; descKey: string }[] = [
  { tone: 'ok',   labelKey: 'techStatus.legend.ok',   descKey: 'techStatus.legend.okDesc'   },
  { tone: 'warn', labelKey: 'techStatus.legend.warn', descKey: 'techStatus.legend.warnDesc' },
  { tone: 'down', labelKey: 'techStatus.legend.down', descKey: 'techStatus.legend.downDesc' },
  { tone: 'none', labelKey: 'techStatus.legend.none', descKey: 'techStatus.legend.noneDesc' },
]
