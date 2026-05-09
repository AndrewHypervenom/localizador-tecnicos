import { query } from '../config/db'
import { supabase } from '../config/supabase'

// Inactividad > 5 minutos = fin de viaje
const INACTIVITY_THRESHOLD_MIN = 5

// Distancia mínima para considerar que hubo un viaje real (100m)
const MIN_TRIP_DISTANCE_M = 100

export async function detectAndCloseTrips(): Promise<void> {
  console.log('[TripDetection] Running trip detection job...')

  try {
    // Obtener todos los técnicos activos
    const { data: technicians } = await supabase
      .from('technicians')
      .select('id, name')
      .eq('active', true)

    if (!technicians?.length) return

    for (const tech of technicians) {
      await processTechnicianTrip(tech.id, tech.name)
    }

    console.log('[TripDetection] Done.')
  } catch (err) {
    console.error('[TripDetection] Error:', err)
  }
}

async function processTechnicianTrip(techId: string, techName: string): Promise<void> {
  // Verificar si hay un viaje activo para este técnico
  const { data: activeTrip } = await supabase
    .from('trips')
    .select('id, started_at')
    .eq('technician_id', techId)
    .eq('status', 'active')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Obtener el último punto GPS del técnico
  const lastPoints = await query<{ ts: Date; speed: number | null }>(
    `SELECT ts, speed FROM location_events
     WHERE technician_id = $1
     ORDER BY ts DESC
     LIMIT 1`,
    [techId]
  )

  const lastPoint = lastPoints[0]
  if (!lastPoint) return

  const minutesSinceLast = (Date.now() - new Date(lastPoint.ts).getTime()) / 60_000
  const isInactive = minutesSinceLast > INACTIVITY_THRESHOLD_MIN

  if (!activeTrip) {
    // No hay viaje activo: crear uno si hay actividad reciente
    if (!isInactive) {
      // Buscar el primer punto de la ventana de actividad continua
      const firstPoints = await query<{ ts: Date }>(
        `SELECT ts FROM location_events
         WHERE technician_id = $1
           AND ts >= NOW() - INTERVAL '${INACTIVITY_THRESHOLD_MIN} minutes'
         ORDER BY ts ASC
         LIMIT 1`,
        [techId]
      )
      const startedAt = firstPoints[0]
        ? new Date(firstPoints[0].ts).toISOString()
        : new Date().toISOString()

      await supabase.from('trips').insert({
        technician_id: techId,
        started_at:    startedAt,
        status:        'active',
      })
      console.log(`[TripDetection] Opened trip for ${techName}`)
    }
    return
  }

  // Hay un viaje activo: cerrarlo si el técnico lleva > 5min inactivo
  if (!isInactive) return

  await closeTripWithAnalytics(activeTrip.id, techId, activeTrip.started_at)
  console.log(`[TripDetection] Closed trip for ${techName}`)
}

async function closeTripWithAnalytics(
  tripId: string,
  techId: string,
  startedAt: string
): Promise<void> {
  const endedAt = new Date().toISOString()

  // Calcular métricas con PostGIS
  const analytics = await query<{
    distance_km: number
    max_speed_kmh: number
    avg_speed_kmh: number
    min_speed_kmh: number
    duration_min: number
    route_wkt: string | null
  }>(
    `SELECT
       ROUND((ST_Length(ST_MakeLine(location::geometry ORDER BY ts)::geography) / 1000)::numeric, 3)::float AS distance_km,
       ROUND((MAX(speed) * 3.6)::numeric, 1)::float AS max_speed_kmh,
       ROUND((AVG(speed) * 3.6)::numeric, 1)::float AS avg_speed_kmh,
       ROUND((MIN(CASE WHEN speed > 0 THEN speed END) * 3.6)::numeric, 1)::float AS min_speed_kmh,
       ROUND(EXTRACT(EPOCH FROM (MAX(ts) - MIN(ts))) / 60)::int AS duration_min,
       ST_AsText(ST_MakeLine(location::geometry ORDER BY ts)) AS route_wkt
     FROM location_events
     WHERE technician_id = $1
       AND ts BETWEEN $2 AND $3
       AND speed IS NOT NULL`,
    [techId, startedAt, endedAt]
  )

  const stats = analytics[0]
  if (!stats || !stats.route_wkt) {
    // Sin datos suficientes: eliminar el viaje vacío
    await supabase.from('trips').delete().eq('id', tripId)
    return
  }

  // Descartar viajes muy cortos
  if (stats.distance_km * 1000 < MIN_TRIP_DISTANCE_M) {
    await supabase.from('trips').delete().eq('id', tripId)
    return
  }

  // Contar eventos de movimiento brusco durante el viaje
  const motionCounts = await query<{
    event_type: string
    cnt: number
  }>(
    `SELECT event_type, COUNT(*)::int AS cnt
     FROM motion_events
     WHERE technician_id = $1
       AND ts BETWEEN $2 AND $3
     GROUP BY event_type`,
    [techId, startedAt, endedAt]
  )

  const countByType = (type: string) =>
    motionCounts.find((m) => m.event_type === type)?.cnt ?? 0

  await supabase.from('trips').update({
    ended_at:       endedAt,
    status:         'completed',
    distance_km:    stats.distance_km,
    max_speed_kmh:  stats.max_speed_kmh,
    avg_speed_kmh:  stats.avg_speed_kmh,
    min_speed_kmh:  stats.min_speed_kmh ?? 0,
    duration_min:   stats.duration_min,
    hard_brakes:    countByType('hard_brake'),
    rapid_accels:   countByType('rapid_accel'),
    harsh_turns:    countByType('harsh_turn'),
    accidents:      countByType('accident'),
    route:          `SRID=4326;${stats.route_wkt}`,
  }).eq('id', tripId)
}
