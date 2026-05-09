import { Router, Request, Response } from 'express'
import { query } from '../config/db'
import { supabase } from '../config/supabase'

const router = Router()

// GET /api/analytics/technicians/:id/heatmap
// Devuelve puntos GPS con velocidad para renderizar el heatmap en Leaflet
router.get('/technicians/:id/heatmap', async (req: Request, res: Response) => {
  const { id } = req.params
  const { from, to } = req.query

  const fromDate = (from as string) || new Date(Date.now() - 24 * 3600_000).toISOString()
  const toDate   = (to as string)   || new Date().toISOString()

  try {
    const rows = await query<{
      lat: number; lng: number; speed_kmh: number; ts: string
    }>(
      `SELECT
         AVG(ST_Y(location::geometry))          AS lat,
         AVG(ST_X(location::geometry))          AS lng,
         ROUND(AVG(speed * 3.6)::numeric, 1)::float AS speed_kmh,
         date_trunc('minute', ts)::text         AS ts
       FROM location_events
       WHERE technician_id = $1
         AND ts BETWEEN $2 AND $3
         AND speed IS NOT NULL
       GROUP BY date_trunc('minute', ts)
       ORDER BY ts ASC`,
      [id, fromDate, toDate]
    )
    res.json(rows)
  } catch (err) {
    console.error('[heatmap]', err)
    res.status(500).json({ error: 'Error al obtener datos de heatmap' })
  }
})

// GET /api/analytics/trips/:id/route
// Devuelve puntos de la ruta coloreados por velocidad (para el mapa de analítica)
router.get('/trips/:id/route', async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    const { data: trip, error } = await supabase
      .from('trips')
      .select('technician_id, started_at, ended_at')
      .eq('id', id)
      .single()

    if (error || !trip) {
      return res.status(404).json({ error: 'Viaje no encontrado' })
    }

    let rows: any[]

    const tsTo = trip.ended_at ?? new Date().toISOString()
    rows = await query(
      `SELECT
         to_timestamp(floor(extract(epoch from ts) / 5) * 5)::text  AS ts,
         ROUND(AVG(ST_Y(location::geometry))::numeric, 6)::float AS lat,
         ROUND(AVG(ST_X(location::geometry))::numeric, 6)::float AS lng,
         ROUND(AVG(speed * 3.6)::numeric, 1)::float              AS speed_kmh,
         ROUND(COALESCE(AVG(altitude), 0)::numeric, 1)::float    AS altitude,
         ROUND(COALESCE(AVG(bearing),  0)::numeric, 1)::float    AS bearing,
         CASE
           WHEN MAX(speed * 3.6) < 30 THEN 'low'
           WHEN MAX(speed * 3.6) < 60 THEN 'medium'
           ELSE 'high'
         END                                                      AS speed_band
       FROM location_events
       WHERE technician_id = $1
         AND ts BETWEEN $2 AND $3
         AND (accuracy IS NULL OR accuracy < 30)
       GROUP BY to_timestamp(floor(extract(epoch from ts) / 5) * 5)
       ORDER BY ts ASC`,
      [trip.technician_id, trip.started_at, tsTo]
    )

    res.json(rows)
  } catch (err) {
    console.error('[trip/route]', err)
    res.status(500).json({ error: 'Error al obtener ruta del viaje' })
  }
})

// GET /api/analytics/trips/:id/stats
// Métricas completas del viaje con PostGIS
router.get('/trips/:id/stats', async (req: Request, res: Response) => {
  const { id } = req.params
  try {
    const rows = await query(
      `SELECT get_trip_analytics($1)::json AS analytics`,
      [id]
    )
    if (!rows[0]?.analytics) {
      return res.status(404).json({ error: 'Viaje no encontrado' })
    }
    res.json(rows[0].analytics)
  } catch (err) {
    console.error('[trip/stats]', err)
    res.status(500).json({ error: 'Error al obtener estadísticas del viaje' })
  }
})

// GET /api/analytics/technicians/:id/elevation
// Perfil de elevación del día actual
router.get('/technicians/:id/elevation', async (req: Request, res: Response) => {
  const { id } = req.params
  const { from, to } = req.query

  const fromDate = (from as string) || new Date(Date.now() - 24 * 3600_000).toISOString()
  const toDate   = (to as string)   || new Date().toISOString()

  try {
    const rows = await query<{
      ts: string
      altitude: number
      distance_m: number
      speed_kmh: number
    }>(
      `WITH minute_agg AS (
         SELECT
           date_trunc('minute', ts)                    AS minute,
           AVG(altitude)                               AS altitude,
           AVG(speed * 3.6)                            AS speed_kmh,
           AVG(ST_X(location::geometry))               AS avg_x,
           AVG(ST_Y(location::geometry))               AS avg_y,
           ROW_NUMBER() OVER (ORDER BY date_trunc('minute', ts)) AS rn
         FROM location_events
         WHERE technician_id = $1
           AND ts BETWEEN $2 AND $3
           AND altitude IS NOT NULL
         GROUP BY date_trunc('minute', ts)
       ),
       with_distance AS (
         SELECT
           p.minute::text                              AS ts,
           ROUND(p.altitude::numeric, 1)::float        AS altitude,
           ROUND(p.speed_kmh::numeric, 1)::float       AS speed_kmh,
           COALESCE(SUM(
             ST_Distance(
               ST_MakePoint(p.avg_x, p.avg_y),
               ST_MakePoint(prev.avg_x, prev.avg_y)
             )
           ) OVER (ORDER BY p.rn), 0)::float           AS distance_m
         FROM minute_agg p
         LEFT JOIN minute_agg prev ON prev.rn = p.rn - 1
       )
       SELECT ts, altitude, distance_m, speed_kmh FROM with_distance`,
      [id, fromDate, toDate]
    )
    res.json(rows)
  } catch (err) {
    console.error('[elevation]', err)
    res.status(500).json({ error: 'Error al obtener perfil de elevación' })
  }
})

// GET /api/analytics/technicians/:id/track
// Rastro GPS completo de un día (muestreado cada 30 segundos)
router.get('/technicians/:id/track', async (req: Request, res: Response) => {
  const { id } = req.params
  const { date } = req.query

  const targetDate = (date as string) || new Date().toISOString().slice(0, 10)
  const fromDate = `${targetDate}T00:00:00Z`
  const toDate   = `${targetDate}T23:59:59Z`

  try {
    const rows = await query<{
      ts: string
      lat: number
      lng: number
      speed_kmh: number
      altitude: number
      bearing: number
      speed_band: string
    }>(
      `SELECT
         to_timestamp(floor(extract(epoch from ts) / 30) * 30)::text AS ts,
         ROUND(AVG(ST_Y(location::geometry))::numeric, 6)::float  AS lat,
         ROUND(AVG(ST_X(location::geometry))::numeric, 6)::float  AS lng,
         ROUND(AVG(speed * 3.6)::numeric, 1)::float               AS speed_kmh,
         ROUND(COALESCE(AVG(altitude), 0)::numeric, 1)::float     AS altitude,
         ROUND(COALESCE(AVG(bearing), 0)::numeric, 1)::float      AS bearing,
         CASE
           WHEN MAX(speed * 3.6) < 30 THEN 'low'
           WHEN MAX(speed * 3.6) < 60 THEN 'medium'
           ELSE 'high'
         END                                                       AS speed_band
       FROM location_events
       WHERE technician_id = $1
         AND ts BETWEEN $2 AND $3
       GROUP BY to_timestamp(floor(extract(epoch from ts) / 30) * 30)
       ORDER BY ts ASC`,
      [id, fromDate, toDate]
    )
    res.json(rows)
  } catch (err) {
    console.error('[track]', err)
    res.status(500).json({ error: 'Error al obtener rastro GPS' })
  }
})

// GET /api/analytics/fleet/summary
// Resumen de todos los técnicos activos (para el panel admin)
router.get('/fleet/summary', async (_req: Request, res: Response) => {
  try {
    const rows = await query(
      `SELECT
         t.id,
         t.name,
         cs.last_seen,
         cs.lat,
         cs.lng,
         cs.last_speed,
         cs.battery,
         cs.status,
         COUNT(DISTINCT tr.id) FILTER (WHERE tr.started_at > NOW() - INTERVAL '24h') AS trips_today,
         COUNT(me.id)          FILTER (WHERE me.ts > NOW() - INTERVAL '24h' AND me.event_type = 'accident') AS accidents_today
       FROM technicians t
       LEFT JOIN technician_current_status cs ON cs.id = t.id
       LEFT JOIN trips tr ON tr.technician_id = t.id
       LEFT JOIN motion_events me ON me.technician_id = t.id
       WHERE t.active = true
       GROUP BY t.id, t.name, cs.last_seen, cs.lat, cs.lng, cs.last_speed, cs.battery, cs.status`
    )
    res.json(rows)
  } catch (err) {
    console.error('[fleet/summary]', err)
    res.status(500).json({ error: 'Error al obtener resumen de flota' })
  }
})

export default router
