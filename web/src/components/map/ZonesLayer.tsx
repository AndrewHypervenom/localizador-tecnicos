import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useMap } from 'react-leaflet'
import { useZonesStore } from '@/store/zonesStore'
import type { Zone } from '@/types/zones'
import { ZONE_TYPE_LABEL_KEYS } from '@/types/zones'
import { useI18n, type TFunc } from '@/lib/i18n/i18n'

function createZoneLayer(zone: Zone, selected: boolean, t: TFunc): L.Polygon {
  const fillOp = selected ? 0.25 : 0.12
  const weight  = selected ? 3 : 2

  const polygon = L.polygon(zone.coordinates, {
    color:       zone.color,
    weight,
    opacity:     selected ? 1 : 0.85,
    fillColor:   zone.color,
    fillOpacity: fillOp,
    dashArray:   zone.type === 'restricted' ? '8 4' : undefined,
  })

  const labelHtml = `
    <div style="
      font-family:Inter,system-ui,sans-serif;
      font-size:12px;
      background:rgba(14,14,26,0.88);
      color:#F1F5F9;
      border:1.5px solid ${zone.color}80;
      padding:5px 10px;
      border-radius:9px;
      white-space:nowrap;
      backdrop-filter:blur(6px);
      box-shadow:0 2px 10px rgba(0,0,0,.45);
      pointer-events:none;
    ">
      <span style="
        display:inline-block;width:8px;height:8px;border-radius:50%;
        background:${zone.color};margin-right:6px;vertical-align:middle;
      "></span>
      <strong>${zone.name}</strong>
      <span style="color:#64748B;margin-left:6px;font-size:11px">${t(ZONE_TYPE_LABEL_KEYS[zone.type])}</span>
    </div>`

  polygon.bindTooltip(labelHtml, { sticky: true, className: 'zone-tooltip', opacity: 1 })

  // Etiqueta fija en el centroide cuando está seleccionada
  if (selected) {
    polygon.bindPopup(labelHtml, { closeButton: false, className: 'zone-popup' })
  }

  return polygon
}

export function ZonesLayer() {
  const { t } = useI18n()
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
      const layer = createZoneLayer(zone, selected, t)
      layer.on('click', () => selectZone(selectedZoneId === zone.id ? null : zone.id))
      layer.addTo(map)
      layersRef.current[zone.id] = layer
    })
  }, [zones, showZones, selectedZoneId, map, selectZone, t])

  // Limpiar al desmontar
  useEffect(() => {
    return () => {
      Object.values(layersRef.current).forEach((l) => l.remove())
      layersRef.current = {}
    }
  }, [])

  return null
}
