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

// ── Suavizado del trazado a paso de peatón ────────────────────────────────────
// Medido sobre una caminata real (2026-08-31, 272 fixes): la precisión media del
// GPS es de 15,6 m y el avance medio entre puntos consecutivos, de 8,0 m. Es
// decir, **el error de cada punto casi duplica el trayecto que separa a dos**, así
// que la recta que los une la dibuja el ruido, no el movimiento. De ahí las
// "líneas chuecas": no son un fallo del mapa, es que a 14 s de cadencia y 1,4 m/s
// no hay señal suficiente por encima del ruido.
//
// En vehículo no pasa: a 40 km/h se avanzan ~220 m entre puntos y esos 15 m no se
// notan. Por eso el suavizado se aplica SOLO por debajo de una velocidad de
// peatón; tocar el trazado rápido redondearía curvas reales.
//
// Los puntos NO se eliminan, se reposicionan —misma decisión que en `snapDrift` y
// por la misma razón: el reproductor, el perfil de elevación y la gráfica de
// velocidad se alimentan de este mismo array y necesitan conservar la cadencia.
const SMOOTH_MAX_SPEED_KMH = 12
const SMOOTH_WINDOW        = 2     // vecinos a cada lado
// No se promedia a través de un hueco: tras una parada larga o un corte de red
// (la cola offline puede traer una hora de golpe) los vecinos ya no describen el
// mismo tramo, y promediarlos arrastraría la línea por encima del hueco.
const SMOOTH_MAX_GAP_S     = 60
const SMOOTH_MAX_NEIGHBOR_M = 120

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

/**
 * Suaviza el trazado lento con una media ponderada de los vecinos en el tiempo.
 *
 * El peso es triangular (el propio punto pesa más que sus vecinos), que basta
 * para hundir el temblor del GPS sin comerse las esquinas reales: una vuelta de
 * esquina sostiene su forma porque la mantienen varios puntos seguidos, mientras
 * que un pico de un solo fix —que es lo que produce el ruido— queda promediado
 * contra sus vecinos y se aplana.
 */
export function smoothSlowTrack<T extends RouteFilterPoint>(pts: T[]): T[] {
  if (pts.length < 3) return pts

  const t = pts.map(p => new Date(p.ts).getTime())

  return pts.map((p, i) => {
    if (p.speed_kmh > SMOOTH_MAX_SPEED_KMH) return p

    let sumaLat = 0, sumaLng = 0, sumaPeso = 0
    for (let j = i - SMOOTH_WINDOW; j <= i + SMOOTH_WINDOW; j++) {
      if (j < 0 || j >= pts.length) continue
      const v = pts[j]
      // Un vecino solo cuenta si describe el mismo tramo: cerca en tiempo y en
      // espacio. Si no, se ignora y el punto se promedia con los que queden.
      if (Math.abs(t[j] - t[i]) / 1000 > SMOOTH_MAX_GAP_S) continue
      if (distM(p.lat, p.lng, v.lat, v.lng) > SMOOTH_MAX_NEIGHBOR_M) continue

      const peso = SMOOTH_WINDOW + 1 - Math.abs(j - i)   // triangular
      sumaLat += v.lat * peso
      sumaLng += v.lng * peso
      sumaPeso += peso
    }

    if (sumaPeso === 0) return p
    return { ...p, lat: sumaLat / sumaPeso, lng: sumaLng / sumaPeso }
  })
}

/**
 * Limpieza estándar de una ruta.
 *
 * El orden importa: primero fuera los puntos imposibles (si no, un pico
 * entraría en la media y contaminaría a sus vecinos en vez de desaparecer),
 * después el suavizado del tramo lento, y al final el pegado de la deriva en
 * parado, que ya trabaja sobre coordenadas limpias.
 */
export function cleanRoute<T extends RouteFilterPoint>(pts: T[]): T[] {
  return snapDrift(smoothSlowTrack(dropSpikes(pts)))
}
