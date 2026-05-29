import { simplifyPolygon } from './geoUtils'

export interface GeocodingResult {
  lat:         number
  lng:         number
  displayName: string
}

export interface ReverseGeocodeResult {
  country:     string
  city:        string
  displayName: string
}

export async function reverseGeocode(lat: number, lng: number): Promise<ReverseGeocodeResult | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10`,
      { headers: { 'Accept-Language': 'es', 'User-Agent': 'Localizador/1.0' } }
    )
    if (!res.ok) return null
    const data = await res.json()
    if (!data?.address) return null
    const city    = data.address.city ?? data.address.town ?? data.address.village ?? data.address.county ?? ''
    const country = data.address.country ?? ''
    return { country, city, displayName: data.display_name }
  } catch {
    return null
  }
}

export async function geocodeAddress(query: string): Promise<GeocodingResult | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`,
      { headers: { 'Accept-Language': 'es', 'User-Agent': 'Localizador/1.0' } }
    )
    if (!res.ok) return null
    const data = await res.json()
    if (!data.length) return null
    return {
      lat:         parseFloat(data[0].lat),
      lng:         parseFloat(data[0].lon),
      displayName: data[0].display_name,
    }
  } catch {
    return null
  }
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

export interface ClaudeGeoResult {
  result: GeocodingResult | null
  radius: number
}

export interface BatchGeoResult {
  id:          number
  lat?:        number
  lng?:        number
  displayName?: string
  confidence:  string
  radius:      number
}

/** Geocodifica un lote de direcciones en paralelo: Claude normaliza en 1 llamada + Google Maps en paralelo. */
export async function geocodeBatch(
  addresses: Array<{ direccion: string; ciudad: string; cliente?: string | null }>
): Promise<BatchGeoResult[]> {
  const res = await fetch(`${API_URL}/api/geocoding/batch`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ addresses }),
  })
  if (!res.ok) return addresses.map((_, id) => ({ id, confidence: 'failed', radius: 0.3 }))
  const data = await res.json()
  return data.results ?? []
}

/** Geocodifica una dirección individual (para búsqueda manual en el mapa). */
export async function geocodeWithClaude(
  direccion: string,
  ciudad: string,
  cliente?: string | null
): Promise<ClaudeGeoResult> {
  try {
    const res = await fetch(`${API_URL}/api/geocoding/resolve`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ direccion, ciudad, cliente }),
    })
    if (!res.ok) return { result: null, radius: 0.3 }
    const data = await res.json()
    if (data.lat && data.lng) {
      return {
        result: { lat: data.lat, lng: data.lng, displayName: data.displayName || `${direccion}, ${ciudad}` },
        radius: data.radius ?? 0.3,
      }
    }
    return { result: null, radius: 0.3 }
  } catch {
    return { result: null, radius: 0.3 }
  }
}

/** Detecta si el texto es un enlace acortado de Google Maps que requiere expandirse en el backend. */
export function isShortMapsLink(input: string): boolean {
  return /\b(maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs|maps\.google\.[a-z.]+\/\?cid=)/i.test(input)
}

/** Extrae coordenadas de un link de Google Maps que ya las contiene (link largo). */
export function extractMapsCoordsFromText(input: string): { lat: number; lng: number } | null {
  const pinMatch = input.match(/!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/)
  if (pinMatch) return { lat: parseFloat(pinMatch[1]), lng: parseFloat(pinMatch[2]) }
  const atMatch = input.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/)
  if (atMatch) return { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]) }
  const llMatch = input.match(/[?&](?:ll|q|query)=(-?\d+\.\d+),\+?(-?\d+\.\d+)/)
  if (llMatch) return { lat: parseFloat(llMatch[1]), lng: parseFloat(llMatch[2]) }
  return null
}

/** Resuelve coordenadas de cualquier link de Google Maps (largo o corto maps.app.goo.gl).
 *  Para links largos extrae localmente; para cortos llama al backend que sigue el redirect. */
export async function resolveMapsLink(input: string): Promise<{ lat: number; lng: number } | null> {
  const local = extractMapsCoordsFromText(input)
  if (local) return local
  if (!isShortMapsLink(input)) return null
  try {
    const res = await fetch(`${API_URL}/api/geocoding/expand-maps`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ url: input.trim() }),
    })
    if (!res.ok) return null
    const data = await res.json()
    if (typeof data.lat === 'number' && typeof data.lng === 'number') {
      return { lat: data.lat, lng: data.lng }
    }
    return null
  } catch {
    return null
  }
}

export interface CityBoundaryResult {
  coords:      [number, number][]
  name:        string
  displayName: string
}

/** Fetches the real administrative boundary polygon of a city from Nominatim/OSM.
 *  Returns a simplified polygon ([lat, lng][]) ready to use as a zone. */
export async function fetchCityBoundary(
  cityName: string,
  country = 'Colombia'
): Promise<CityBoundaryResult | null> {
  try {
    const q   = encodeURIComponent(`${cityName}, ${country}`)
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${q}&polygon_geojson=1&format=jsonv2&limit=5&featuretype=city`,
      { headers: { 'Accept-Language': 'es', 'User-Agent': 'Localizador/1.0' } }
    )
    if (!res.ok) return null
    const data: any[] = await res.json()

    const withPoly = data.filter(
      (d) => d.geojson?.type === 'Polygon' || d.geojson?.type === 'MultiPolygon'
    )
    if (!withPoly.length) return null

    // Pick highest importance (usually the main municipality)
    const best = withPoly.sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0))[0]

    let rawCoords: number[][]
    if (best.geojson.type === 'Polygon') {
      rawCoords = best.geojson.coordinates[0]
    } else {
      // MultiPolygon → take the sub-polygon with the most vertices
      const subPolys: number[][][] = best.geojson.coordinates.map((p: number[][][]) => p[0])
      rawCoords = subPolys.sort((a, b) => b.length - a.length)[0]
    }

    // Convert OSM [lng, lat] → [lat, lng] and simplify
    const coords: [number, number][] = rawCoords.map(([lng, lat]) => [lat, lng])
    const simplified = simplifyPolygon(coords, 0.005)

    return {
      coords:      simplified,
      name:        best.name ?? cityName,
      displayName: best.display_name ?? cityName,
    }
  } catch {
    return null
  }
}

// Circular polygon of N points around (lat, lng) with radius in km — returns [lat, lng][]
export function circlePolygon(lat: number, lng: number, radiusKm: number, n = 36): [number, number][] {
  const R    = 6371
  const d    = radiusKm / R
  const latR = (lat * Math.PI) / 180
  const lngR = (lng * Math.PI) / 180
  const pts: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const bearing = (i / n) * 2 * Math.PI
    const lat2 = Math.asin(
      Math.sin(latR) * Math.cos(d) + Math.cos(latR) * Math.sin(d) * Math.cos(bearing)
    )
    const lng2 = lngR + Math.atan2(
      Math.sin(bearing) * Math.sin(d) * Math.cos(latR),
      Math.cos(d) - Math.sin(latR) * Math.sin(lat2)
    )
    pts.push([(lat2 * 180) / Math.PI, (lng2 * 180) / Math.PI])
  }
  return pts
}
