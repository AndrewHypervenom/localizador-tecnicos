import { supabase } from './supabase'
import { CITY_COORDS } from './geo'
import { ZONE_PALETTE } from '@/types/zones'
import { geocodeAddress, geocodeBatch } from './geocoding'
import { getLeaderScope } from './leaderContext'

// Devuelve los id de technician_routes que pertenecen al líder actual
// (técnicos de sus empresas). Opcionalmente acotado a una fecha.
async function getLeaderRouteIds(routeDate?: string): Promise<string[]> {
  const { allTechnicianIds } = await getLeaderScope()
  if (allTechnicianIds.length === 0) return []
  let q = supabase.from('technician_routes').select('id').in('technician_id', allTechnicianIds)
  if (routeDate) q = q.eq('route_date', routeDate)
  const { data } = await q
  return (data ?? []).map((r: any) => r.id)
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// Expande abreviaciones colombianas y extrae solo la parte base de la dirección
// (descarta sufijos de unidad como APT, LOCAL, OFC, PISO que Nominatim no entiende)
function normalizeColAddress(s: string): string {
  let norm = s
    .replace(/\bAVCR\b\.?/gi, 'Avenida Carrera')
    .replace(/\bAVKR\b\.?/gi, 'Avenida Carrera')
    .replace(/\bAVCL\b\.?/gi, 'Avenida Calle')
    .replace(/\bCRA?\b\.?/gi, 'Carrera')
    .replace(/\bKR\b\.?/gi,   'Carrera')
    .replace(/\bCL+\b\.?/gi,  'Calle')
    .replace(/\bTV[A]?\b\.?/gi,  'Transversal')
    .replace(/\bTRANS\b\.?/gi,   'Transversal')
    .replace(/\bDG\b\.?/gi,   'Diagonal')
    .replace(/\bDIAG\b\.?/gi, 'Diagonal')
    .replace(/\bAV[DA]?\b\.?/gi, 'Avenida')
    .replace(/N°\s*/gi, '')
    .replace(/#\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  // Extrae hasta el primer patrón X-Y (número de cruce - puerta), descartando el sufijo de unidad
  const baseMatch = norm.match(/^(.+?\d+[A-Za-z]?-\d+)/i)
  if (baseMatch) norm = baseMatch[1].trim()

  return norm
}

// "BOGOTÁ, D.C." → "Bogotá"  (la coma interna rompe la consulta a Nominatim)
function normalizeCiudad(c: string | null): string | null {
  if (!c) return null
  return c.replace(/,?\s*D\.?C\.?/i, '').trim()
}

// Genera un polígono circular de N puntos alrededor de (lat, lng) con radio en km
function circlePolygon(lat: number, lng: number, radiusKm: number, n = 36): [number, number][] {
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

function toWkt(coords: [number, number][]): string {
  const pts = coords.map(([la, ln]) => `${ln} ${la}`)
  pts.push(pts[0])
  return `SRID=4326;POLYGON((${pts.join(', ')}))`
}

// ─── Obtener company_id del usuario actual ────────────────────────────────────
export async function getUserCompanyId(): Promise<string | null> {
  const { data: sessionData } = await supabase.auth.getSession()
  const userId = sessionData?.session?.user?.id
  if (!userId) return null
  const { data } = await supabase.from('companies').select('id').eq('created_by', userId).limit(1)
  return (data ?? [])[0]?.id ?? null
}

// ─── Borrar TODAS las zonas de la base de datos ───────────────────────────────
// Intenta hard-delete primero; si RLS lo bloquea (count = 0), usa soft-delete
// como respaldo para que no vuelvan a aparecer en el hook (que filtra is_active).
export async function deleteAllZones(): Promise<number> {
  // Solo borra las zonas de las empresas del líder actual, nunca las de otros.
  const { companyIds } = await getLeaderScope()
  if (companyIds.length === 0) return 0

  // 1. Hard-delete
  const { count: hardCount, error: hardErr } = await supabase
    .from('zones')
    .delete({ count: 'exact' })
    .in('company_id', companyIds)

  if (hardErr) throw new Error(hardErr.message)

  // 2. Soft-delete como respaldo (cubre zonas que RLS impidió borrar)
  const { error: softErr } = await supabase
    .from('zones')
    .update({ is_active: false })
    .eq('is_active', true)
    .in('company_id', companyIds)

  if (softErr) console.warn('[deleteAllZones] soft-delete fallback error:', softErr.message)

  return hardCount ?? 0
}

// ─── Previsualización: qué ciudades se crearían (sin tocar la BD) ─────────────
export interface CityPreview {
  city:       string
  country:    string
  hasCoords:  boolean
}

export async function previewCityZones(): Promise<CityPreview[]> {
  const { companyIds } = await getLeaderScope()
  if (companyIds.length === 0) return []

  const { data, error } = await supabase
    .from('technicians')
    .select('city, country')
    .in('company_id', companyIds)

  if (error) throw new Error(error.message)

  const seen = new Set<string>()
  const result: CityPreview[] = []

  for (const row of data ?? []) {
    if (row.city && !seen.has(row.city)) {
      seen.add(row.city)
      result.push({ city: row.city, country: row.country ?? '', hasCoords: !!CITY_COORDS[row.city] })
    }
  }

  return result.sort((a, b) => a.city.localeCompare(b.city))
}

// ─── Generación: borrar existentes + crear zonas circulares ──────────────────
export interface GenerateResult {
  created: string[]
  skipped: string[]
  deleted: number
}

export async function generateCityZones(radiusKm = 6): Promise<GenerateResult> {
  const { companyIds } = await getLeaderScope()
  const preview = await previewCityZones()

  // Borrar solo las zonas de las empresas del líder antes de regenerar.
  let deletedCount = 0
  if (companyIds.length > 0) {
    const { count, error: delErr } = await supabase
      .from('zones')
      .delete({ count: 'exact' })
      .in('company_id', companyIds)
    if (delErr) throw new Error(delErr.message)
    deletedCount = count ?? 0
  }

  const created: string[] = []
  const skipped: string[] = []

  const { data: sessionData } = await supabase.auth.getSession()
  const userId    = sessionData?.session?.user?.id
  const companyId = await getUserCompanyId()

  let colorIdx = 0
  for (const { city, country, hasCoords } of preview) {
    let lat: number, lng: number

    if (hasCoords) {
      ;[lat, lng] = CITY_COORDS[city]
    } else {
      const geo = await geocodeAddress(`${city}, ${country}`)
      if (!geo) { skipped.push(city); continue }
      lat = geo.lat
      lng = geo.lng
      await sleep(1100) // Nominatim: max 1 req/s
    }
    const polygon    = toWkt(circlePolygon(lat, lng, radiusKm))
    const color      = ZONE_PALETTE[colorIdx % ZONE_PALETTE.length]
    colorIdx++

    const { error } = await supabase.from('zones').insert({
      name:        city,
      description: country || null,
      type:        'service_area',
      color,
      polygon,
      is_active:   true,
      created_by:  userId ?? null,
      company_id:  companyId,
    })

    if (error) {
      console.error(`[generateCityZones] ${city}:`, error.message)
      skipped.push(city)
    } else {
      created.push(city)
    }
  }

  return { created, skipped, deleted: deletedCount ?? 0 }
}

// ─── Zonas por direcciones de ruta ────────────────────────────────────────────

export interface RouteZoneResult {
  created: number
  skipped: number
  total:   number
}

/** Devuelve cuántas direcciones únicas hay en route_items */
export async function previewRouteZones(): Promise<number> {
  const routeIds = await getLeaderRouteIds()
  if (routeIds.length === 0) return 0

  const { data, error } = await supabase
    .from('route_items')
    .select('direccion, ciudad')
    .in('route_id', routeIds)
    .not('direccion', 'is', null)

  if (error) throw new Error(error.message)

  const seen = new Set<string>()
  for (const row of data ?? []) {
    if (row.direccion) seen.add(`${row.direccion}|${row.ciudad ?? ''}`)
  }
  return seen.size
}

/**
 * Geocodifica cada dirección única de route_items y crea una zona circular.
 * onProgress(done, total) se llama después de cada dirección procesada.
 */
export async function generateRouteZones(
  _radiusKm = 0.3,
  onProgress?: (done: number, total: number) => void,
  routeDate?: string
): Promise<RouteZoneResult> {
  const routeIds = await getLeaderRouteIds()
  if (routeIds.length === 0) return { created: 0, skipped: 0, total: 0 }

  const { data, error } = await supabase
    .from('route_items')
    .select('direccion, ciudad, cliente')
    .in('route_id', routeIds)
    .not('direccion', 'is', null)

  if (error) throw new Error(error.message)

  // Deduplicar por direccion+ciudad
  const seen  = new Set<string>()
  const items: Array<{ direccion: string; ciudad: string | null; cliente: string | null }> = []
  for (const row of data ?? []) {
    if (!row.direccion) continue
    const key = `${row.direccion}|${row.ciudad ?? ''}`
    if (!seen.has(key)) {
      seen.add(key)
      items.push({ direccion: row.direccion, ciudad: row.ciudad, cliente: row.cliente })
    }
  }

  if (items.length === 0) return { created: 0, skipped: 0, total: 0 }

  const { data: sessionData } = await supabase.auth.getSession()
  const userId    = sessionData?.session?.user?.id
  const companyId = await getUserCompanyId()

  // ── Geocodificar TODO en paralelo (1 llamada Claude + Google Maps paralelo) ──
  onProgress?.(0, items.length)
  const geoResults = await geocodeBatch(
    items.map(it => ({ direccion: it.direccion, ciudad: it.ciudad ?? '', cliente: it.cliente }))
  )
  onProgress?.(items.length, items.length)

  // ── Insertar zonas ────────────────────────────────────────────────────────────
  let created = 0, skipped = 0, colorIdx = 0

  for (let i = 0; i < items.length; i++) {
    const { direccion, ciudad, cliente } = items[i]
    const geo = geoResults[i]

    // Si el batch falló, intentar centroide de ciudad como último recurso
    let lat = geo?.lat, lng = geo?.lng
    let radius = geo?.radius ?? 0.3

    if (!lat || !lng) {
      const normCiudad = normalizeCiudad(ciudad)
      const cityKey    = normCiudad?.toLowerCase() ?? ''
      const cityEntry  = Object.entries(CITY_COORDS).find(([k]) => k.toLowerCase() === cityKey)
      if (cityEntry) {
        ;[lat, lng] = cityEntry[1]
        radius = 2.0
      } else {
        skipped++
        continue
      }
    }

    const polygon = toWkt(circlePolygon(lat, lng, radius))
    const color   = ZONE_PALETTE[colorIdx % ZONE_PALETTE.length]
    colorIdx++

    const { error: insertErr } = await supabase.from('zones').insert({
      name:        (cliente || direccion).slice(0, 80),
      description: ciudad ? `${direccion}, ${ciudad}` : direccion,
      type:        'checkpoint',
      color,
      polygon,
      is_active:   true,
      created_by:  userId ?? null,
      company_id:  companyId,
      route_date:  routeDate ?? null,
    })

    if (insertErr) { skipped++; console.error('[generateRouteZones]', insertErr.message) }
    else created++
  }

  return { created, skipped, total: items.length }
}
