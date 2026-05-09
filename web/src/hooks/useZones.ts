import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useZonesStore } from '@/store/zonesStore'
import type { Zone, ZoneType } from '@/types/zones'

export function parseGeoJsonPolygon(geojsonStr: string): [number, number][] {
  try {
    const gj = JSON.parse(geojsonStr)
    // GeoJSON ring: [[lng, lat], ...], cierre incluido — convertir a [lat, lng] sin el cierre
    const ring: [number, number][] = gj.coordinates[0]
    return ring.slice(0, -1).map(([lng, lat]: [number, number]) => [lat, lng])
  } catch {
    return []
  }
}

export function coordsToWkt(coords: [number, number][]): string {
  // coords: [lat, lng] → WKT necesita lng lat
  const pts = coords.map(([lat, lng]) => `${lng} ${lat}`)
  pts.push(pts[0]) // cerrar anillo
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
  }
}

async function fetchZone(id: string): Promise<Zone | null> {
  const { data } = await supabase
    .from('zones_geojson')
    .select('*')
    .eq('id', id)
    .single()
  return data ? rowToZone(data) : null
}

export function useZones() {
  const { setZones, addZone, updateZone, removeZone } = useZonesStore()

  useEffect(() => {
    async function loadAll() {
      const { data, error } = await supabase
        .from('zones_geojson')
        .select('*')
      if (error) { console.error('[Zones] carga inicial:', error); return }
      const zones = (data ?? []).map(rowToZone).filter(Boolean) as Zone[]
      setZones(zones)
    }

    loadAll()

    const channel = supabase
      .channel('zones_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'zones' },
        async (payload) => {
          if (payload.eventType === 'DELETE') {
            removeZone((payload.old as any).id)
            return
          }
          const zone = await fetchZone((payload.new as any).id)
          if (!zone) return
          if (payload.eventType === 'INSERT') addZone(zone)
          if (payload.eventType === 'UPDATE') {
            if (!zone.isActive) removeZone(zone.id)
            else updateZone(zone)
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [setZones, addZone, updateZone, removeZone])
}
