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

// Devuelve las zonas que contienen el punto dado
export function getZonesForPoint(
  lat: number,
  lng: number,
  zones: Array<{ id: string; name: string; color: string; coordinates: [number, number][] }>
) {
  return zones.filter((z) => pointInPolygon(lat, lng, z.coordinates))
}
