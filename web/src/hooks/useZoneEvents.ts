import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useTrackingStore, ZoneAlert } from '@/store/trackingStore'
import { useZonesStore } from '@/store/zonesStore'
import type { TechnicianState } from '@/store/trackingStore'
import type { Zone } from '@/types/zones'

export async function persistZoneAlertAck(alertId: string) {
  const { error } = await supabase.from('zone_events').update({ acknowledged: true }).eq('id', alertId)
  if (error) throw error
}

// filterByIds (mismo convenio que useRealtimeTechnicians):
//   undefined → modo admin, todas las alertas de zona
//   null      → scope del líder aún sin resolver, no cargar
//   string[]  → modo líder, solo estos técnicos
export function useZoneEvents(filterByIds?: string[] | null) {
  // Refs para acceder a datos frescos SIN recrear la suscripción
  const techRef           = useRef<Record<string, TechnicianState>>({})
  const zonesRef          = useRef<Zone[]>([])
  const wasDisconnectedRef = useRef(false)
  const filterRef         = useRef(filterByIds)
  const loadFnRef         = useRef<() => Promise<void>>()

  const technicians  = useTrackingStore((s) => s.technicians)
  const addZoneAlert = useTrackingStore((s) => s.addZoneAlert)
  const zones        = useZonesStore((s) => s.zones)

  // Sincronizar refs cuando cambian los datos (sin disparar el efecto de suscripción)
  useEffect(() => { techRef.current  = technicians }, [technicians])
  useEffect(() => { zonesRef.current = zones        }, [zones])
  useEffect(() => { filterRef.current = filterByIds })

  // La suscripción se crea UNA sola vez y lee de los refs
  useEffect(() => {
    // Carga inicial de alertas de zona históricas (últimos 30 días)
    async function loadInitialZoneAlerts() {
      const ids = filterRef.current
      // null → scope del líder sin resolver; [] → líder sin técnicos.
      if (ids === null) return
      if (ids !== undefined && ids.length === 0) return

      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      let zoneQuery = supabase
        .from('zone_events')
        .select('*, technicians(name), zones(name, color)')
        .gte('ts', since)

      // Modo líder: solo alertas de sus técnicos.
      if (ids !== undefined) zoneQuery = (zoneQuery as any).in('technician_id', ids)

      const { data, error } = await zoneQuery
        .order('ts', { ascending: false })
        .limit(100)

      if (error) { console.error('[ZoneEvents] Error cargando alertas históricas:', error); return }

      ;(data ?? []).forEach((row: any) => {
        addZoneAlert({
          id:             row.id,
          technicianId:   row.technician_id,
          technicianName: (row.technicians as any)?.name ?? 'Técnico',
          zoneId:         row.zone_id,
          zoneName:       (row.zones as any)?.name  ?? 'Zona desconocida',
          zoneColor:      (row.zones as any)?.color ?? '#00D632',
          eventType:      row.event_type as 'enter' | 'exit',
          ts:             row.ts,
          acknowledged:   row.acknowledged ?? false,
        })
      })
    }

    loadFnRef.current = loadInitialZoneAlerts
    loadInitialZoneAlerts()

    const channel = supabase
      .channel('zone_events_feed')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'zone_events' },
        (payload) => {
          const row = payload.new as any
          if (!row) return

          // Guard: en modo líder, ignorar técnicos fuera de scope.
          const ids = filterRef.current
          if (ids !== undefined && ids !== null && !ids.includes(row.technician_id)) return

          const techName  = techRef.current[row.technician_id]?.name ?? 'Técnico'
          const zone      = zonesRef.current.find((z) => z.id === row.zone_id)
          const zoneName  = zone?.name  ?? 'Zona desconocida'
          const zoneColor = zone?.color ?? '#00D632'

          const alert: ZoneAlert = {
            id:             row.id,
            technicianId:   row.technician_id,
            technicianName: techName,
            zoneId:         row.zone_id,
            zoneName,
            zoneColor,
            eventType:      row.event_type as 'enter' | 'exit',
            ts:             row.ts,
            acknowledged:   false,
          }

          addZoneAlert(alert)

          if (row.event_type === 'enter') {
            toast.success(`${techName} entró a "${zoneName}"`, {
              duration: 6000,
              style: { borderLeft: `3px solid ${zoneColor}` },
            })
          } else {
            toast.warning(`${techName} salió de "${zoneName}"`, {
              duration: 6000,
              style: { borderLeft: `3px solid ${zoneColor}` },
            })
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED' && wasDisconnectedRef.current) {
          // Catch-up: recuperar eventos de zona perdidos durante el corte
          wasDisconnectedRef.current = false
          loadInitialZoneAlerts()
        }
        if (status === 'CHANNEL_ERROR') {
          wasDisconnectedRef.current = true
          console.error('[ZoneEvents] Error en canal Realtime — verifica que zone_events esté en supabase_realtime publication')
        }
        if (status === 'CLOSED' || status === 'TIMED_OUT') wasDisconnectedRef.current = true
      })

    return () => { supabase.removeChannel(channel) }
  }, [addZoneAlert]) // addZoneAlert es estable (Zustand action), solo corre una vez

  // Cuando el scope del líder pasa de null a un array real, recargar el histórico.
  const filterKey = Array.isArray(filterByIds) ? filterByIds.join(',') : String(filterByIds)
  useEffect(() => {
    if (Array.isArray(filterByIds)) loadFnRef.current?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey])
}
