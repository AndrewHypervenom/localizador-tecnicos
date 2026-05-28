// Algoritmo ray-casting para verificar si un punto está dentro de un polígono
// polygon: [[lat, lng], ...] en orden Leaflet
export function pointInPolygon(
  lat: number,
  lng: number,
  polygon: [number, number][]
): boolean {
  let inside = false
  const n = polygon.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [yi, xi] = polygon[i]
    const [yj, xj] = polygon[j]
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

// Ramer-Douglas-Peucker polygon simplification — reduces vertex count while preserving shape
function _rdp(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length <= 2) return pts
  let maxDist = 0
  let maxIdx  = 0
  const [x0, y0] = pts[0]
  const [x1, y1] = pts[pts.length - 1]
  const dx = x1 - x0
  const dy = y1 - y0
  const len2 = dx * dx + dy * dy
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i]
    let d: number
    if (len2 === 0) {
      d = Math.sqrt((px - x0) ** 2 + (py - y0) ** 2)
    } else {
      const t = ((px - x0) * dx + (py - y0) * dy) / len2
      d = Math.sqrt((px - (x0 + t * dx)) ** 2 + (py - (y0 + t * dy)) ** 2)
    }
    if (d > maxDist) { maxDist = d; maxIdx = i }
  }
  if (maxDist > tol) {
    const left  = _rdp(pts.slice(0, maxIdx + 1), tol)
    const right = _rdp(pts.slice(maxIdx), tol)
    return [...left.slice(0, -1), ...right]
  }
  return [pts[0], pts[pts.length - 1]]
}

export function simplifyPolygon(coords: [number, number][], tolerance: number): [number, number][] {
  if (coords.length <= 3) return coords
  return _rdp(coords, tolerance)
}

// Devuelve las zonas que contienen el punto dado
export function getZonesForPoint(
  lat: number,
  lng: number,
  zones: Array<{ id: string; name: string; color: string; coordinates: [number, number][] }>
) {
  return zones.filter((z) => pointInPolygon(lat, lng, z.coordinates))
}
