import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import { format, isToday, isTomorrow } from 'date-fns'
import { es } from 'date-fns/locale'
import { useTrackingStore } from '@/store/trackingStore'
import { useTechnicianAssignments } from '@/hooks/useTechnicianAssignments'
import { supabase } from '@/lib/supabase'
import { TechnicianAssignment, AssignmentStatus, ASSIGNMENT_STATUS_CFG } from '@/types/assignments'

function createAssignmentIcon(index: number, a: TechnicianAssignment): L.DivIcon {
  const cfg    = ASSIGNMENT_STATUS_CFG[a.status]
  const faded  = a.status === 'completed' || a.status === 'cancelled'
  const time   = format(new Date(a.scheduled_at), 'HH:mm')
  return L.divIcon({
    html: `<div style="display:flex;flex-direction:column;align-items:center;gap:3px;pointer-events:none;">
      <div style="
        width:28px;height:28px;border-radius:50%;
        background:${cfg.color}25;border:2px solid ${cfg.color}${faded ? '80' : ''};
        display:flex;align-items:center;justify-content:center;
        font-size:12px;font-weight:700;color:${cfg.color};
        font-family:system-ui,sans-serif;
        box-shadow:0 2px 10px rgba(0,0,0,0.5);
        opacity:${faded ? 0.5 : 1};
      ">${index + 1}</div>
      <div style="
        background:rgba(8,8,18,0.90);border:1px solid rgba(255,255,255,0.12);
        border-radius:5px;padding:2px 7px;
        color:#e2e8f0;font-size:10px;font-weight:600;
        font-family:system-ui,sans-serif;
        opacity:${faded ? 0.5 : 1};
      ">${time}</div>
    </div>`,
    className:   '',
    iconSize:    [50, 52],
    iconAnchor:  [25, 14],
    popupAnchor: [0, -20],
  })
}

function createHomeIcon(): L.DivIcon {
  return L.divIcon({
    html: `<div style="
      width:32px;height:32px;border-radius:50%;
      background:#10B98120;border:2px solid #10B981;
      display:flex;align-items:center;justify-content:center;
      font-size:17px;box-shadow:0 2px 12px rgba(0,0,0,0.55);
      pointer-events:none;
    ">🏠</div>`,
    className:   '',
    iconSize:    [32, 32],
    iconAnchor:  [16, 16],
    popupAnchor: [0, -20],
  })
}

function buildPopup(a: TechnicianAssignment): string {
  const cfg  = ASSIGNMENT_STATUS_CFG[a.status]
  const d    = new Date(a.scheduled_at)
  const day  = isToday(d) ? 'Hoy'
             : isTomorrow(d) ? 'Mañana'
             : format(d, "EEEE d 'de' MMMM", { locale: es })
  const time = format(d, 'HH:mm')
  return `<div style="font-family:system-ui,sans-serif;padding:4px 2px;min-width:170px;">
    <div style="font-weight:700;font-size:13px;margin-bottom:4px;">${a.title}</div>
    ${a.address ? `<div style="font-size:11px;color:#94a3b8;margin-bottom:3px;">📍 ${a.address}</div>` : ''}
    <div style="font-size:11px;color:#64748b;margin-bottom:3px;">📅 ${day} · ${time}</div>
    ${a.estimated_duration_minutes ? `<div style="font-size:11px;color:#64748b;margin-bottom:3px;">⏱ ${a.estimated_duration_minutes} min estimados</div>` : ''}
    <div style="font-size:11px;display:inline-flex;align-items:center;gap:4px;
      background:${cfg.color}20;border:1px solid ${cfg.color}60;
      border-radius:4px;padding:2px 6px;color:${cfg.color};font-weight:600;margin-top:4px;">
      ${cfg.label}
    </div>
    ${a.notes ? `<div style="font-size:11px;color:#94a3b8;margin-top:6px;border-top:1px solid #1e293b;padding-top:5px;">${a.notes}</div>` : ''}
  </div>`
}

function buildHomePopup(name: string, address?: string | null, city?: string | null, country?: string | null): string {
  return `<div style="font-family:system-ui,sans-serif;padding:4px 2px;min-width:165px;">
    <div style="font-weight:700;font-size:13px;margin-bottom:5px;">🏠 Casa de ${name}</div>
    ${address  ? `<div style="font-size:11px;color:#94a3b8;margin-bottom:3px;">📍 ${address}</div>` : ''}
    ${city     ? `<div style="font-size:11px;color:#94a3b8;">🏙️ ${city}${country ? `, ${country}` : ''}</div>` : ''}
  </div>`
}

export function AssignmentRouteLayer() {
  const { selectedTechnicianId, technicians, updateTechnicianMeta } = useTrackingStore()
  const { assignments } = useTechnicianAssignments(selectedTechnicianId)
  const map = useMap()

  const markersRef    = useRef<L.Marker[]>([])
  const polylinesRef  = useRef<L.Polyline[]>([])
  const homeRef       = useRef<L.Marker | null>(null)
  const homeCircleRef = useRef<L.Circle | null>(null)

  const [techExtra, setTechExtra] = useState<{ city?: string; country?: string } | null>(null)

  const tech    = selectedTechnicianId ? technicians[selectedTechnicianId] : null
  const homeLat = tech?.home_lat ?? null
  const homeLng = tech?.home_lng ?? null

  // Carga home + ciudad desde Supabase al seleccionar un técnico
  useEffect(() => {
    setTechExtra(null)
    if (!selectedTechnicianId) return
    supabase
      .from('technicians')
      .select('home_lat, home_lng, home_address, city, country')
      .eq('id', selectedTechnicianId)
      .single()
      .then(({ data }) => {
        if (!data) return
        updateTechnicianMeta(selectedTechnicianId, {
          home_lat:     data.home_lat     ?? null,
          home_lng:     data.home_lng     ?? null,
          home_address: data.home_address ?? null,
        })
        setTechExtra({ city: data.city ?? undefined, country: data.country ?? undefined })
      })
  }, [selectedTechnicianId])

  useLayoutEffect(() => {
    markersRef.current.forEach(m => m.remove())
    markersRef.current = []
    polylinesRef.current.forEach(p => p.remove())
    polylinesRef.current = []
    if (homeRef.current)    { homeRef.current.remove();    homeRef.current    = null }
    if (homeCircleRef.current) { homeCircleRef.current.remove(); homeCircleRef.current = null }

    if (!selectedTechnicianId) return

    if (homeLat && homeLng) {
      const circle = L.circle([homeLat, homeLng], {
        radius:      300,
        color:       '#10B981',
        fillColor:   '#10B981',
        fillOpacity: 0.18,
        weight:      2,
        opacity:     0.8,
        dashArray:   '6, 4',
      })
      circle.addTo(map)
      homeCircleRef.current = circle

      const hm = L.marker([homeLat, homeLng], { icon: createHomeIcon(), zIndexOffset: 200 })
      hm.bindPopup(buildHomePopup(tech?.name ?? 'Técnico', tech?.home_address, techExtra?.city, techExtra?.country))
      hm.addTo(map)
      homeRef.current = hm
    }

    const visible = assignments.filter(a => a.lat && a.lng && a.status !== 'cancelled')

    const routePoints: [number, number][] = []
    if (tech?.lat && tech?.lng) {
      routePoints.push([tech.lat, tech.lng])
    } else if (homeLat && homeLng) {
      routePoints.push([homeLat, homeLng])
    }

    visible.forEach((a, i) => {
      const marker = L.marker([a.lat!, a.lng!], {
        icon: createAssignmentIcon(i, a),
        zIndexOffset: 150 + i,
      })
      marker.bindPopup(buildPopup(a), { maxWidth: 260 })
      marker.addTo(map)
      markersRef.current.push(marker)
      routePoints.push([a.lat!, a.lng!])
    })

    if (routePoints.length >= 2) {
      const line = L.polyline(routePoints, {
        color:     '#F59E0B',
        weight:    2.5,
        opacity:   0.7,
        dashArray: '10, 8',
      })
      line.addTo(map)
      polylinesRef.current.push(line)
    }
  }, [selectedTechnicianId, assignments, homeLat, homeLng, technicians, map, techExtra])

  return null
}
