import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet.heat'
import { useTrackingStore } from '@/store/trackingStore'
import axios from 'axios'

declare module 'leaflet' {
  function heatLayer(
    latlngs: Array<[number, number, number?]>,
    options?: {
      minOpacity?: number
      maxZoom?: number
      max?: number
      radius?: number
      blur?: number
      gradient?: Record<string, string>
    }
  ): L.Layer & { setLatLngs: (latlngs: any[]) => void }
}

export function SpeedHeatmap() {
  const map = useMap()
  const { selectedTechnicianId } = useTrackingStore()
  const heatLayerRef = useRef<any>(null)

  useEffect(() => {
    if (!selectedTechnicianId) return

    async function loadHeatmapData() {
      try {
        const { data } = await axios.get(
          `/api/analytics/technicians/${selectedTechnicianId}/heatmap`
        )

        // Normalizar velocidad (0-1) para el heatmap
        const speeds: number[] = data.map((p: any) => p.speed_kmh)
        const maxSpeed = Math.max(...speeds, 1)

        const heatData: [number, number, number][] = data.map((p: any) => [
          p.lat,
          p.lng,
          Math.min(p.speed_kmh / maxSpeed, 1),
        ])

        if (heatLayerRef.current) {
          map.removeLayer(heatLayerRef.current)
        }

        heatLayerRef.current = L.heatLayer(heatData, {
          radius: 18,
          blur: 15,
          maxZoom: 17,
          max: 1.0,
          gradient: {
            0.0: '#10B981',   // Verde: velocidad baja
            0.4: '#F59E0B',   // Amarillo: velocidad media
            0.7: '#EF4444',   // Rojo: velocidad alta
            1.0: '#7C3AED',   // Púrpura: velocidad muy alta
          },
        })
        map.addLayer(heatLayerRef.current)
      } catch (err) {
        console.error('[SpeedHeatmap] Error:', err)
      }
    }

    loadHeatmapData()
    const interval = setInterval(loadHeatmapData, 2_000)

    return () => {
      clearInterval(interval)
      if (heatLayerRef.current) {
        map.removeLayer(heatLayerRef.current)
        heatLayerRef.current = null
      }
    }
  }, [map, selectedTechnicianId])

  return null
}
