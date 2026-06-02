import { useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useTrackingStore } from '@/store/trackingStore'
import type { TechnicianState } from '@/store/trackingStore'
import { toast } from 'sonner'

let audioCtx: AudioContext | null = null

/** Crea/reanuda el AudioContext. Los navegadores lo dejan "suspended" hasta
 *  que haya un gesto del usuario; por eso lo reanudamos aquí y en el unlock. */
function ensureAudio(): AudioContext | null {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {})
    return audioCtx
  } catch {
    return null
  }
}

function playAccidentAlert() {
  const ctx = ensureAudio()
  if (!ctx) return
  // Tres pitidos cortos con envolvente para que sea claramente audible.
  const start = ctx.currentTime
  for (let i = 0; i < 3; i++) {
    const osc  = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 880
    const t = start + i * 0.35
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.4, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
    osc.start(t)
    osc.stop(t + 0.31)
  }
}

// filterByIds:
//   undefined → admin mode, load all technicians
//   null      → leader scope not yet resolved, skip fetch
//   string[]  → leader mode, filter to these IDs only
export function useRealtimeTechnicians(filterByIds?: string[] | null) {
  const { setTechnicians, replaceTechnicians, updateTechnicianPosition, addAlert, setRealtimeStatus, markRealtimeEvent, updateTechnicianMeta } = useTrackingStore()
  const filterRef = useRef(filterByIds)
  // true tras un corte de realtime: dispara un catch-up al reconectar
  const wasDisconnectedRef = useRef(false)

  useEffect(() => {
    filterRef.current = filterByIds
  })

  // Desbloquear el audio en el primer gesto del usuario: los navegadores
  // mantienen el AudioContext suspendido hasta entonces y por eso "no sonaba".
  useEffect(() => {
    const unlock = () => ensureAudio()
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  const loadFnRef = useRef<() => Promise<void>>()
  const alertsFnRef = useRef<() => Promise<void>>()

  useEffect(() => {
    async function loadInitialState() {
      const ids = filterRef.current
      if (ids === null) return

      let statusQuery = supabase.from('technician_current_status').select('*')
      let homeQuery   = supabase.from('technicians').select('id, home_lat, home_lng, home_address, home_radius')

      if (ids !== undefined) {
        // Líder sin técnicos: vaciar de verdad (replace), no fusionar — si no,
        // quedan los técnicos del líder anterior al cambiar de sesión.
        if (ids.length === 0) { replaceTechnicians([]); return }
        statusQuery = (statusQuery as any).in('id', ids)
        homeQuery   = (homeQuery   as any).in('id', ids)
      }

      const [statusRes, homeRes] = await Promise.all([statusQuery, homeQuery])

      if (statusRes.error) {
        console.error('[Realtime] Error cargando técnicos:', statusRes.error)
        return
      }

      const homeMap = new Map((homeRes.data ?? []).map((h: any) => [h.id, h]))

      const techs: TechnicianState[] = (statusRes.data ?? []).map((row: any) => {
        const home = homeMap.get(row.id)
        return {
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
          home_lat:     home?.home_lat     ?? undefined,
          home_lng:     home?.home_lng     ?? undefined,
          home_address: home?.home_address ?? undefined,
          home_radius:  home?.home_radius  ?? undefined,
        }
      })

      if (ids !== undefined) {
        replaceTechnicians(techs)
      } else {
        setTechnicians(techs)
      }
    }

    // Carga inicial de alertas históricas (últimos 30 días)
    async function loadInitialAlerts() {
      const ids = filterRef.current
      // null → scope del líder aún sin resolver; no cargar todavía.
      if (ids === null) return
      // [] → líder sin técnicos: no hay alertas que mostrar.
      if (ids !== undefined && ids.length === 0) return

      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      let alertsQuery = supabase
        .from('motion_events')
        .select('*, technicians(name)')
        .gte('ts', since)

      // Modo líder: solo alertas de sus técnicos. Modo admin (undefined): todas.
      if (ids !== undefined) alertsQuery = (alertsQuery as any).in('technician_id', ids)

      const { data, error } = await alertsQuery
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

    loadFnRef.current = loadInitialState
    alertsFnRef.current = loadInitialAlerts

    loadInitialState()
    loadInitialAlerts()
    // No pollear mientras la pestaña esté oculta (ahorra red/CPU en segundo plano)
    const pollInterval = setInterval(() => { if (!document.hidden) loadInitialState() }, 30_000)

    // Al volver a la pestaña, refrescar de inmediato en vez de esperar al próximo tick
    const onVisible = () => {
      if (document.hidden) return
      loadInitialState()
      useTrackingStore.getState().refreshStatuses()
    }
    document.addEventListener('visibilitychange', onVisible)

    // Recalcular estados según el tiempo transcurrido: actualiza el color del
    // marcador a "sin señal" cuando un técnico deja de enviar ubicación. Es
    // SOLO visual — ya no lanzamos un toast por técnico: "sin señal" es un
    // estado (no una emergencia) y con muchos técnicos sería una catarata de
    // avisos. El conteo agregado ya se ve en LeaderStats / la lista de técnicos.
    const statusRefreshInterval = setInterval(() => {
      if (document.hidden) return
      useTrackingStore.getState().refreshStatuses()
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

          // Guard: ignorar técnicos que no están en nuestro store (fuera de scope)
          if (!useTrackingStore.getState().technicians[row.technician_id]) return

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
        if (status === 'SUBSCRIBED') {
          setRealtimeStatus('connected')
          // Catch-up: tras reconectar (supabase-js re-une el canal solo), recuperar
          // posiciones y alertas que pudieron emitirse durante el corte.
          if (wasDisconnectedRef.current) {
            wasDisconnectedRef.current = false
            loadInitialState()
            loadInitialAlerts()
          }
        }
        if (status === 'CHANNEL_ERROR') { setRealtimeStatus('error'); wasDisconnectedRef.current = true; console.error('[Realtime] location_events:', err) }
        if (status === 'CLOSED' || status === 'TIMED_OUT') { setRealtimeStatus('disconnected'); wasDisconnectedRef.current = true }
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

          // Guard: ignorar técnicos que no están en nuestro store (fuera de scope)
          const tech = useTrackingStore.getState().technicians[row.technician_id]
          if (!tech) return

          // El nombre ya está en el store: evita un query por cada alerta (N+1)
          const techName = tech.name ?? 'Técnico desconocido'
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
            sos:         '🆘',
            hard_brake:  '⚠️',
            rapid_accel: '⚡',
            harsh_turn:  '↩️',
            offline:     '📡',
            battery_low: '🔋',
            home_enter:  '🏠',
            home_exit:   '🚪',
          }
          const labels: Record<string, string> = {
            accident:    'ACCIDENTE DETECTADO',
            sos:         'SOS — EMERGENCIA',
            hard_brake:  'Frenada brusca',
            rapid_accel: 'Aceleración rápida',
            harsh_turn:  'Giro brusco',
            offline:     'Técnico sin señal',
            battery_low: 'Batería baja',
            home_enter:  'Llegó a casa',
            home_exit:   'Salió de casa',
          }

          const icon  = icons[row.event_type]  ?? '⚠️'
          const label = labels[row.event_type] ?? 'Evento de conducción'

          const isCritical = row.event_type === 'accident' || row.event_type === 'sos'
          if (isCritical) {
            toast.error(`${icon} ${label}`, {
              description: techName,
              duration: 0,
            })
            playAccidentAlert()
          } else if (row.event_type === 'home_enter') {
            toast.success(`${icon} ${label}`, { description: techName, duration: 5000 })
          } else if (row.event_type === 'home_exit') {
            toast(`${icon} ${label}`, { description: techName, duration: 5000 })
          } else if (row.event_type !== 'offline') {
            // 'offline' (sin señal) ya quedó registrado en el panel (addAlert),
            // pero no molestamos con un toast: es un estado, no una emergencia.
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
      document.removeEventListener('visibilitychange', onVisible)
      supabase.removeChannel(locationChannel)
      supabase.removeChannel(alertChannel)
    }
  }, [setTechnicians, updateTechnicianPosition, addAlert])

  // When filterByIds transitions from null to a real array, trigger a reload.
  // Clave estable derivada de los ids para no re-ejecutar en cada render.
  const filterKey = Array.isArray(filterByIds) ? filterByIds.join(',') : String(filterByIds)
  useEffect(() => {
    if (Array.isArray(filterByIds)) {
      loadFnRef.current?.()
      alertsFnRef.current?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey])
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
