import { useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useTrackingStore } from '@/store/trackingStore'
import type { TechnicianState, TechnicianStatus } from '@/store/trackingStore'
import { toast } from 'sonner'

let audioCtx: AudioContext | null = null
function playAccidentAlert() {
  try {
    if (!audioCtx) audioCtx = new AudioContext()
    const osc = audioCtx.createOscillator()
    osc.connect(audioCtx.destination)
    osc.frequency.value = 880
    osc.start()
    osc.stop(audioCtx.currentTime + 0.3)
  } catch {}
}

export function useRealtimeTechnicians() {
  const { setTechnicians, updateTechnicianPosition, addAlert, setRealtimeStatus, markRealtimeEvent } = useTrackingStore()
  // Tracks statuses from the previous refresh cycle to detect active→inactive transitions
  const prevStatusesRef = useRef<Record<string, TechnicianStatus>>({})

  useEffect(() => {
    // Carga inicial de técnicos y sus estados actuales
    async function loadInitialState() {
      const { data, error } = await supabase
        .from('technician_current_status')
        .select('*')

      if (error) {
        console.error('[Realtime] Error cargando técnicos:', error)
        return
      }

      const techs: TechnicianState[] = (data ?? []).map((row: any) => ({
        id:           row.id,
        name:         row.name,
        deviceId:     row.device_id,
        phone:        row.phone,
        supervisorId: row.supervisor_id,
        lastSeen:     row.last_seen,
        lat:          row.lat,
        lng:          row.lng,
        lastSpeed:    row.last_speed,
        altitude:     row.last_altitude ?? undefined,
        bearing:      row.last_bearing  ?? undefined,
        battery:      row.battery,
        status:       row.status ?? 'offline',
        trail:        row.lat && row.lng ? [[row.lat, row.lng]] : [],
      }))

      setTechnicians(techs)
    }

    // Carga inicial de alertas históricas (últimos 30 días)
    async function loadInitialAlerts() {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const { data, error } = await supabase
        .from('motion_events')
        .select('*, technicians(name)')
        .gte('ts', since)
        .order('ts', { ascending: false })
        .limit(100)

      if (error) { console.error('[Realtime] Error cargando alertas históricas:', error); return }

      ;(data ?? []).forEach((row: any) => {
        const [lng, lat] = row.location ? extractLatLng(row.location) : [undefined, undefined]
        addAlert({
          id:             row.id,
          technicianId:   row.technician_id,
          technicianName: (row.technicians as any)?.name ?? 'Técnico desconocido',
          type:           row.event_type,
          severity:       row.severity,
          ts:             row.ts,
          lat,
          lng,
          acknowledged:   row.acknowledged ?? false,
        })
      })
    }

    loadInitialState()
    loadInitialAlerts()
    // Fallback: si Realtime se desconecta, recargar estado cada 30s
    const pollInterval = setInterval(loadInitialState, 30_000)

    // Recalcular estados basados en tiempo transcurrido (detecta cuando la app deja de enviar)
    const statusRefreshInterval = setInterval(() => {
      const store = useTrackingStore.getState()

      // Capturar estados anteriores antes de refrescar
      const before: Record<string, TechnicianStatus> = {}
      Object.values(store.technicians).forEach((t) => { before[t.id] = t.status })

      store.refreshStatuses()

      // Detectar transiciones activo → inactivo y notificar
      const afterTechs = useTrackingStore.getState().technicians
      Object.values(afterTechs).forEach((tech) => {
        const prev = before[tech.id] ?? prevStatusesRef.current[tech.id]
        if (!prev) return

        const wasActive   = prev === 'moving' || prev === 'idle'
        const isInactive  = tech.status === 'stopped' || tech.status === 'offline'

        if (wasActive && isInactive) {
          toast.warning(`${tech.name} dejó de enviar ubicación`, {
            description: tech.status === 'offline'
              ? 'Sin señal por más de 10 minutos'
              : 'Sin datos por más de 1 minuto',
            duration: 10_000,
          })
        }

        prevStatusesRef.current[tech.id] = tech.status
      })
    }, 10_000)

    // Suscripción a nuevos puntos GPS en tiempo real
    const locationChannel = supabase
      .channel('location_events_realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'location_events' },
        (payload) => {
          const row = payload.new as any
          if (!row) return

          markRealtimeEvent()
          const [lng, lat] = extractLatLng(row.location)
          updateTechnicianPosition({
            technician_id: row.technician_id,
            ts:            row.ts,
            lat,
            lng,
            speed:         row.speed,
            altitude:      row.altitude,
            bearing:       row.bearing,
            battery_level: row.battery_level,
          })
        }
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED')    setRealtimeStatus('connected')
        if (status === 'CHANNEL_ERROR') { setRealtimeStatus('error'); console.error('[Realtime] location_events:', err) }
        if (status === 'CLOSED')        setRealtimeStatus('disconnected')
      })

    // Suscripción a alertas de movimiento brusco
    const alertChannel = supabase
      .channel('motion_events_realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'motion_events' },
        async (payload) => {
          const row = payload.new as any
          if (!row) return

          // Obtener nombre del técnico
          const { data: tech } = await supabase
            .from('technicians')
            .select('name')
            .eq('id', row.technician_id)
            .single()

          const techName = tech?.name ?? 'Técnico desconocido'
          const [lng, lat] = row.location ? extractLatLng(row.location) : [undefined, undefined]

          const alert = {
            id:             row.id,
            technicianId:   row.technician_id,
            technicianName: techName,
            type:           row.event_type,
            severity:       row.severity,
            ts:             row.ts,
            lat,
            lng,
            acknowledged:   false,
          }

          addAlert(alert)

          // Toast de notificación
          const icons: Record<string, string> = {
            accident:    '🚨',
            hard_brake:  '⚠️',
            rapid_accel: '⚡',
            harsh_turn:  '↩️',
          }
          const labels: Record<string, string> = {
            accident:    'ACCIDENTE DETECTADO',
            hard_brake:  'Frenada brusca',
            rapid_accel: 'Aceleración rápida',
            harsh_turn:  'Giro brusco',
          }

          const icon  = icons[row.event_type]  ?? '⚠️'
          const label = labels[row.event_type] ?? 'Evento de conducción'

          if (row.event_type === 'accident') {
            toast.error(`${icon} ${label}`, {
              description: techName,
              duration: 0,
            })
            playAccidentAlert()
          } else {
            toast.warning(`${icon} ${label}`, {
              description: techName,
              duration: 5000,
            })
          }
        }
      )
      .subscribe()

    return () => {
      clearInterval(pollInterval)
      clearInterval(statusRefreshInterval)
      supabase.removeChannel(locationChannel)
      supabase.removeChannel(alertChannel)
    }
  }, [setTechnicians, updateTechnicianPosition, addAlert])
}

// Handles WKT ("POINT(lng lat)") and EWKB hex from Supabase Realtime
function extractLatLng(location: string): [number, number] {
  if (!location) return [0, 0]

  const wktMatch = location.match(/POINT\(([^\s]+)\s+([^\)]+)\)/)
  if (wktMatch) return [parseFloat(wktMatch[1]), parseFloat(wktMatch[2])]

  // EWKB hex (postgres_changes sends raw binary as hex)
  if (/^[0-9A-Fa-f]{34,}$/i.test(location)) {
    try {
      const le = location[1] === '1'
      const typeHex = location.slice(2, 10)
      const typeInt = le
        ? parseInt(typeHex.slice(6) + typeHex.slice(4, 6) + typeHex.slice(2, 4) + typeHex.slice(0, 2), 16)
        : parseInt(typeHex, 16)
      const offset = (typeInt & 0x20000000) ? 18 : 10
      const readDouble = (hex: string) => {
        const buf = new Uint8Array(8)
        for (let i = 0; i < 8; i++) buf[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
        return new DataView(buf.buffer).getFloat64(0, le)
      }
      return [readDouble(location.slice(offset, offset + 16)), readDouble(location.slice(offset + 16, offset + 32))]
    } catch { return [0, 0] }
  }

  return [0, 0]
}
