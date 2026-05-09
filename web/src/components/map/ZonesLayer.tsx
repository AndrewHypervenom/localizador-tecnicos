import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useMap } from 'react-leaflet'
import { useZonesStore } from '@/store/zonesStore'
import type { Zone } from '@/types/zones'
import { ZONE_TYPE_LABELS } from '@/types/zones'

function createZoneLayer(zone: Zone, selected: boolean): L.Polygon {
  const opacity  = selected ? 0.35 : 0.15
  const weight   = selected ? 3 : 2

  const polygon = L.polygon(zone.coordinates, {
    color:       zone.color,
    weight,
    opacity:     selected ? 1 : 0.7,
    fillColor:   zone.color,
    fillOpacity: opacity,
    dashArray:   zone.type === 'restricted' ? '8 4' : undefined,
  })

  polygon.bindTooltip(
    `<div style="font-family:Inter,sans-serif;font-size:12px;background:#141420;color:#F1F5F9;border:1px solid #252540;padding:6px 10px;border-radius:8px;white-space:nowrap">
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${zone.color};margin-right:6px;vertical-align:middle"></span>
      <strong>${zone.name}</strong>
      <span style="color:#94A3B8;margin-left:6px">${ZONE_TYPE_LABELS[zone.type]}</span>
    </div>`,
    { sticky: true, className: 'zone-tooltip', opacity: 1 }
  )

  return polygon
}

export function ZonesLayer() {
  const { zones, showZones, selectedZoneId, selectZone } = useZonesStore()
  const map        = useMap()
  const layersRef  = useRef<Record<string, L.Polygon>>({})

  useEffect(() => {
    if (!showZones) {
      Object.values(layersRef.current).forEach((l) => l.remove())
      layersRef.current = {}
      return
    }

    const currentIds = new Set(zones.map((z) => z.id))

    // Eliminar zonas que ya no existen
    Object.keys(layersRef.current).forEach((id) => {
      if (!currentIds.has(id)) {
        layersRef.current[id].remove()
        delete layersRef.current[id]
      }
    })

    // Crear / actualizar capas
    zones.forEach((zone) => {
      const selected = zone.id === selectedZoneId
      if (layersRef.current[zone.id]) {
        layersRef.current[zone.id].remove()
      }
      const layer = createZoneLayer(zone, selected)
      layer.on('click', () => selectZone(selectedZoneId === zone.id ? null : zone.id))
      layer.addTo(map)
      layersRef.current[zone.id] = layer
    })
  }, [zones, showZones, selectedZoneId, map, selectZone])

  // Limpiar al desmontar
  useEffect(() => {
    return () => {
      Object.values(layersRef.current).forEach((l) => l.remove())
      layersRef.current = {}
    }
  }, [])

  return null
}
