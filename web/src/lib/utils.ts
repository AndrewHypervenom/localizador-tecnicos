import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * `toFixed` seguro para métricas que la base puede devolver nulas.
 *
 * `location_events.speed` y `.altitude` son NULLABLE, así que las agregaciones
 * del backend pueden traer null; hacer `valor.toFixed()` directo tumbaba el
 * render entero de la gráfica ("Cannot read properties of null"). Ante un valor
 * ausente o no numérico devolvemos un guion, que es lo que el líder debe ver.
 */
export function fmtNum(v: number | null | undefined, digits = 0, dash = '—'): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : dash
}
