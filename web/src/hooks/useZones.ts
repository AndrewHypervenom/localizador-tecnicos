import { useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useZonesStore } from '@/store/zonesStore'
import type { Zone, ZoneType } from '@/types/zones'

export function parseGeoJsonPolygon(geojsonStr: string): [number, number][] {
  try {
    const gj = JSON.parse(geojsonStr)
    const ring: [number, number][] = gj.coordinates[0]
    return ring.slice(0, -1).map(([lng, lat]: [number, number]) => [lat, lng])
  } catch {
    return []
  }
}

export function coordsToWkt(coords: [number, number][]): string {
  const pts = coords.map(([lat, lng]) => `${lng} ${lat}`)
  pts.push(pts[0])
  return `SRID=4326;POLYGON((${pts.join(', ')}))`
}

function rowToZone(row: any): Zone | null {
  const coords = parseGeoJsonPolygon(row.polygon_geojson)
  if (coords.length < 3) return null
  return {
    id:          row.id,
    name:        row.name,
    description: row.description ?? undefined,
    color:       row.color,
    type:        row.type as ZoneType,
    coordinates: coords,
    isActive:    row.is_active,
    createdAt:   row.created_at,
    companyId:   row.company_id ?? null,
    routeDate:   row.route_date ?? null,
  }
}

/**
 * Sin `date` (página admin): carga las zonas activas de la empresa del usuario.
 *
 * Con `date` ('yyyy-MM-dd'):
 *   1. Verifica si hay rutas en technician_routes para ese día.
 *   2. Si NO hay rutas → setZones([])  — mapa limpio.
 *   3. Si SÍ hay rutas → muestra solo las zonas cuyo route_date coincide.
 *
 * Aislamiento multi-tenant: solo superadmin ve todas las zonas; el resto
 * ve únicamente las zonas cuyo company_id pertenece a sus empresas.
 */
export function useZones(date?: string) {
  const { setZones, removeZone } = useZonesStore()
  const dateRef = useRef(date)
  dateRef.current = date

  const loadAll = useCallback(async () => {
    const filterDate = dateRef.current

    // ── Determinar scope de empresa del usuario ─────────────────────────
    const { data: { session } } = await supabase.auth.getSession()
    const role   = session?.user?.app_metadata?.role as string | undefined
    const userId = session?.user?.id ?? ''

    let companyIds: string[] | null = null
    if (role !== 'superadmin') {
      const { data: companies } = await supabase
        .from('companies')
        .select('id')
        .eq('created_by', userId)
      const ids = (companies ?? []).map((c: any) => c.id)
      if (ids.length === 0) { setZones([]); return }
      companyIds = ids
    }

    // Aplica filtro de empresa cuando no es superadmin
    const applyScope = (q: ReturnType<typeof supabase.from>) =>
      companyIds ? (q as any).in('company_id', companyIds) : q

    // ── Sin filtro de fecha: vista de administrador/editor ──────────────
    if (!filterDate) {
      const { data, error } = await applyScope(
        supabase.from('zones_geojson').select('*').eq('is_active', true)
      )
      if (error) { console.error('[Zones]', error); return }
      setZones((data ?? []).map((r: any) => rowToZone(r)).filter(Boolean) as Zone[])
      return
    }

    // ── Con fecha: tres consultas en paralelo ────────────────────────────
    const [zonesRes, idsRes, routesRes] = await Promise.all([
      applyScope(supabase.from('zones_geojson').select('*').eq('is_active', true)),
      supabase.from('zones').select('id').eq('route_date', filterDate).eq('is_active', true),
      supabase.from('technician_routes').select('id').eq('route_date', filterDate).limit(1),
    ])

    if (zonesRes.error) { console.error('[Zones]', zonesRes.error); return }

    // Sin rutas para este día → mapa sin zonas
    if ((routesRes.data ?? []).length === 0) {
      setZones([])
      return
    }

    // Con rutas → mostrar solo las zonas de la fecha exacta
    const matchIds = new Set((idsRes.data ?? []).map((r: any) => r.id))
    const zones = (zonesRes.data ?? [])
      .filter((r: any) => matchIds.has(r.id))
      .map((r: any) => rowToZone(r))
      .filter(Boolean) as Zone[]

    setZones(zones)
  }, [setZones])

  useEffect(() => { loadAll() }, [loadAll, date])

  useEffect(() => {
    const channelName = `zones_ch_${Math.random().toString(36).slice(2)}`
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'zones' }, (payload) => {
        if (payload.eventType === 'DELETE') removeZone((payload.old as any).id)
        else loadAll()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [loadAll, removeZone])
}
