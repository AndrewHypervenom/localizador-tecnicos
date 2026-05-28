import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { useMap } from 'react-leaflet'
import { useTrackingStore } from '@/store/trackingStore'
import { supabase } from '@/lib/supabase'
import { CITY_COORDS } from '@/lib/geo'

interface CityInfo {
  city: string
  country: string
  techName: string
}

const ZONE_COLOR = '#7B2FF7'
const RADIUS_M   = 6_000   // 6 km de radio

function buildCityIcon(cityInfo: CityInfo) {
  return L.divIcon({
    className: '',
    html: `
      <div style="
        background: rgba(14,14,26,0.88);
        border: 1.5px solid ${ZONE_COLOR};
        border-radius: 10px;
        padding: 4px 10px;
        font-family: Inter, system-ui, sans-serif;
        font-size: 11px;
        font-weight: 600;
        color: #C4B5FD;
        white-space: nowrap;
        backdrop-filter: blur(6px);
        box-shadow: 0 2px 12px rgba(123,47,247,0.35);
        display: flex;
        align-items: center;
        gap: 5px;
        pointer-events: none;
      ">
        <span style="font-size:13px;line-height:1">📍</span>
        <span>${cityInfo.city}</span>
        <span style="color:#6B7280;font-weight:400;font-size:10px">· ${cityInfo.country}</span>
      </div>
    `,
    iconSize:   [200, 28],
    iconAnchor: [100, -8],
  })
}

export function TechnicianCityLayer() {
  const { selectedTechnicianId } = useTrackingStore()
  const map      = useMap()
  const layersRef = useRef<L.Layer[]>([])
  const [cityInfo, setCityInfo] = useState<CityInfo | null>(null)

  // Obtener ciudad del técnico seleccionado
  useEffect(() => {
    if (!selectedTechnicianId) { setCityInfo(null); return }

    supabase
      .from('technicians')
      .select('name, city, country')
      .eq('id', selectedTechnicianId)
      .single()
      .then(({ data }) => {
        if (data?.city) {
          setCityInfo({ city: data.city, country: data.country ?? '', techName: data.name })
        } else {
          setCityInfo(null)
        }
      })
  }, [selectedTechnicianId])

  // Dibujar zona de ciudad en el mapa
  useEffect(() => {
    layersRef.current.forEach((l) => map.removeLayer(l))
    layersRef.current = []

    if (!cityInfo) return

    const coords = CITY_COORDS[cityInfo.city]
    if (!coords) return

    const [lat, lng] = coords

    // Círculo de zona
    const circle = L.circle([lat, lng], {
      radius:      RADIUS_M,
      color:       ZONE_COLOR,
      weight:      2,
      opacity:     0.8,
      fillColor:   ZONE_COLOR,
      fillOpacity: 0.07,
      dashArray:   '8 5',
    })

    // Punto central
    const centerDot = L.circleMarker([lat, lng], {
      radius:      5,
      color:       '#fff',
      weight:      2,
      fillColor:   ZONE_COLOR,
      fillOpacity: 1,
    })

    // Etiqueta flotante
    const label = L.marker([lat, lng], {
      icon:        buildCityIcon(cityInfo),
      interactive: false,
    })

    circle.addTo(map)
    centerDot.addTo(map)
    label.addTo(map)

    layersRef.current = [circle, centerDot, label]

    return () => {
      layersRef.current.forEach((l) => map.removeLayer(l))
      layersRef.current = []
    }
  }, [cityInfo, map])

  return null
}
