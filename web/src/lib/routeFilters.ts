// ── Filtros compartidos para rutas GPS ────────────────────────────────────────
// Los usan todos los mapas que dibujan recorridos (TrackingMap del panel interno
// y LeaderHistory de la vista líder) para que la limpieza sea consistente.

export interface RouteFilterPoint {
  ts: string
  lat: number
  lng: number
  speed_kmh: number
}

// ── Descarte de "saltos" GPS ──────────────────────────────────────────────────
// Un fix basura puede caer lejísimos y la polilínea lo une con una recta larga
// (efecto de teletransporte). Descartamos el punto cuando implica una velocidad
// imposible respecto al anterior válido. Umbral alto (150 km/h) para no tocar
// movimiento real, ya sea a pie o en vehículo.
const MAX_PLAUSIBLE_KMH = 150
const MIN_SPIKE_JUMP_M  = 150  // ignora micro-ruido; solo evalúa saltos grandes

// ── "Pegado" (snap) de la deriva GPS estando detenido ─────────────────────────
// Con el teléfono quieto, los fixes se dispersan 10-50 m alrededor del punto real
// y la polilínea dibuja "líneas aleatorias" de movimiento que nunca ocurrió.
// IMPORTANTE: los puntos quietos NO se eliminan — se conservan con su hora pero
// pegados a la posición del punto anterior. Así el historial/reproductor sigue
// cubriendo el periodo detenido (se ve al técnico parqueado ahí, minuto a
// minuto) sin dibujar movimiento falso ni sumar distancia fantasma. Aplica a un
// punto con velocidad ~0 a menos de DRIFT_COLLAPSE_M del anterior (la deriva
// trae speed 0/null; caminar reporta ~4 km/h y no se toca).
const DRIFT_COLLAPSE_M    = 25
const DRIFT_MAX_SPEED_KMH = 1

export function distM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLng = ((bLng - aLng) * Math.PI) / 180
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

export function dropSpikes<T extends RouteFilterPoint>(pts: T[]): T[] {
  if (pts.length < 2) return pts
  const out: T[] = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    const prev = out[out.length - 1]
    const p    = pts[i]
    const dM   = distM(prev.lat, prev.lng, p.lat, p.lng)
    const dt   = (new Date(p.ts).getTime() - new Date(prev.ts).getTime()) / 1000
    if (dt > 0 && dM > MIN_SPIKE_JUMP_M) {
      const kmh = (dM / 1000) / (dt / 3600)
      if (kmh > MAX_PLAUSIBLE_KMH) continue   // punto imposible → descartar
    }
    out.push(p)
  }
  return out
}

export function snapDrift<T extends RouteFilterPoint>(pts: T[]): T[] {
  if (pts.length < 2) return pts
  const out: T[] = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    const prev = out[out.length - 1]
    const p    = pts[i]
    if (p.speed_kmh < DRIFT_MAX_SPEED_KMH &&
        distM(prev.lat, prev.lng, p.lat, p.lng) < DRIFT_COLLAPSE_M) {
      // Deriva: conservar el punto (y su hora) pegado a la posición anterior.
      out.push({ ...p, lat: prev.lat, lng: prev.lng })
    } else {
      out.push(p)
    }
  }
  return out
}

/** Limpieza estándar de una ruta: descarta saltos imposibles y pega la deriva. */
export function cleanRoute<T extends RouteFilterPoint>(pts: T[]): T[] {
  return snapDrift(dropSpikes(pts))
}
