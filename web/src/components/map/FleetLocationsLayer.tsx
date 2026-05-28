import { useLayoutEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import { useFleetStore } from '@/store/fleetStore'
import { FleetLocation, FLEET_LOCATION_TYPES } from '@/types/fleet'

function createFleetLocationIcon(loc: FleetLocation): L.DivIcon {
  const cfg   = FLEET_LOCATION_TYPES[loc.type]
  const color = loc.color ?? cfg.defaultColor
  return L.divIcon({
    html: `
      <div style="display:flex;flex-direction:column;align-items:center;gap:3px;pointer-events:none;">
        <div style="
          width:32px;height:32px;border-radius:50%;
          background:${color}22;border:2px solid ${color};
          display:flex;align-items:center;justify-content:center;
          font-size:16px;box-shadow:0 2px 12px rgba(0,0,0,0.55);
        ">${cfg.emoji}</div>
        <div style="
          background:rgba(8,8,18,0.90);backdrop-filter:blur(6px);
          border:1px solid rgba(255,255,255,0.13);border-radius:6px;
          padding:2px 8px;color:#e2e8f0;font-size:10px;font-weight:600;
          white-space:nowrap;max-width:140px;overflow:hidden;text-overflow:ellipsis;
          font-family:system-ui,sans-serif;letter-spacing:0.01em;
        ">${loc.name}</div>
      </div>`,
    className: '',
    iconSize:   [140, 58],
    iconAnchor: [70, 16],
    popupAnchor:[0, -22],
  })
}

export function FleetLocationsLayer() {
  const { locations, showLocations } = useFleetStore()
  const map        = useMap()
  const markersRef = useRef<Record<string, L.Marker>>({})

  useLayoutEffect(() => {
    if (!showLocations) {
      Object.values(markersRef.current).forEach(m => m.remove())
      markersRef.current = {}
      return
    }

    const currentIds = new Set(locations.map(l => l.id))

    locations.forEach(loc => {
      const icon     = createFleetLocationIcon(loc)
      const existing = markersRef.current[loc.id]
      if (existing) {
        existing.setIcon(icon)
        return
      }

      const cfg    = FLEET_LOCATION_TYPES[loc.type]
      const color  = loc.color ?? cfg.defaultColor
      const marker = L.marker([loc.lat, loc.lng], { icon, zIndexOffset: -100 })
      marker.bindPopup(`
        <div style="font-family:system-ui,sans-serif;padding:4px 2px;min-width:160px;">
          <div style="font-weight:700;font-size:13px;display:flex;align-items:center;gap:6px;margin-bottom:4px;">
            <span style="
              display:inline-flex;align-items:center;justify-content:center;
              width:22px;height:22px;border-radius:50%;
              background:${color}22;border:1.5px solid ${color};font-size:12px;
            ">${cfg.emoji}</span>
            ${loc.name}
          </div>
          <div style="font-size:11px;color:#64748b;margin-bottom:${loc.address || loc.notes ? '5px' : '0'};">${cfg.label}</div>
          ${loc.address ? `<div style="font-size:11px;color:#94a3b8;margin-bottom:2px;">📍 ${loc.address}</div>` : ''}
          ${loc.notes   ? `<div style="font-size:11px;color:#94a3b8;margin-top:4px;border-top:1px solid #1e293b;padding-top:4px;">${loc.notes}</div>` : ''}
        </div>`, { maxWidth: 260 })
      marker.addTo(map)
      markersRef.current[loc.id] = marker
    })

    Object.keys(markersRef.current).forEach(id => {
      if (!currentIds.has(id)) {
        markersRef.current[id].remove()
        delete markersRef.current[id]
      }
    })
  }, [locations, showLocations, map])

  return null
}
