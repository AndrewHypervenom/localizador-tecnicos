import { Router, Request, Response } from 'express'
import { query } from '../config/db'
import { requireAuth } from '../middleware/requireAuth'

const router = Router()
router.use(requireAuth)

// GET /api/reports/technicians  — lista con metadata para selector y filtros
router.get('/technicians', async (_req: Request, res: Response) => {
  try {
    const rows = await query<{
      id: string; name: string; phone: string
      client: string | null; project: string | null; country: string | null
    }>(`
      SELECT id, name,
        COALESCE(phone, '')   AS phone,
        client, project, country
      FROM technicians
      WHERE active = true
      ORDER BY name ASC
    `)
    res.json(rows)
  } catch (err) {
    console.error('[reports/technicians]', err)
    res.status(500).json({ error: 'Error al obtener técnicos' })
  }
})

// GET /api/reports/fleet?from=&to=&country=&client=&project=
router.get('/fleet', async (req: Request, res: Response) => {
  const from    = (req.query.from     as string) || daysAgo(7)
  const to      = (req.query.to       as string) || today()
  const country = (req.query.country  as string) || null
  const client  = (req.query.client   as string) || null
  const project = (req.query.project  as string) || null

  try {
    const rows = await query<{
      id: string; name: string; phone: string
      client: string | null; project: string | null; country: string | null
      total_trips: number; total_km: number
      avg_speed_kmh: number; max_speed_kmh: number
      hard_brakes: number; rapid_accels: number; harsh_turns: number; accidents: number
      total_min: number
    }>(`
      SELECT
        t.id,
        t.name,
        COALESCE(t.phone, '')    AS phone,
        t.client,
        t.project,
        t.country,
        COUNT(DISTINCT tr.id)::int                                   AS total_trips,
        COALESCE(ROUND(SUM(tr.distance_km)::numeric, 1), 0)::float   AS total_km,
        COALESCE(ROUND(AVG(tr.avg_speed_kmh)::numeric, 1), 0)::float AS avg_speed_kmh,
        COALESCE(ROUND(MAX(tr.max_speed_kmh)::numeric, 1), 0)::float AS max_speed_kmh,
        COALESCE(SUM(tr.hard_brakes), 0)::int                        AS hard_brakes,
        COALESCE(SUM(tr.rapid_accels), 0)::int                       AS rapid_accels,
        COALESCE(SUM(tr.harsh_turns), 0)::int                        AS harsh_turns,
        COALESCE(SUM(tr.accidents), 0)::int                          AS accidents,
        COALESCE(SUM(tr.duration_min), 0)::int                       AS total_min
      FROM technicians t
      LEFT JOIN trips tr ON tr.technician_id = t.id
        AND tr.status = 'completed'
        AND tr.started_at::date BETWEEN $1 AND $2
      WHERE t.active = true
        AND ($3::text IS NULL OR t.country = $3)
        AND ($4::text IS NULL OR t.client  = $4)
        AND ($5::text IS NULL OR t.project = $5)
      GROUP BY t.id, t.name, t.phone, t.client, t.project, t.country
      ORDER BY total_km DESC NULLS LAST
    `, [from, to, country, client, project])

    res.json({ from, to, country, client, project, technicians: rows })
  } catch (err) {
    console.error('[reports/fleet]', err)
    res.status(500).json({ error: 'Error al generar reporte de flota' })
  }
})

// GET /api/reports/technician/:id?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/technician/:id', async (req: Request, res: Response) => {
  const { id } = req.params
  const from = (req.query.from as string) || daysAgo(7)
  const to   = (req.query.to   as string) || today()

  try {
    const [techRows, summaryRows, dailyRows, tripRows] = await Promise.all([
      query<{ name: string; phone: string; client: string | null; project: string | null; country: string | null }>(`
        SELECT name, COALESCE(phone, '') AS phone, client, project, country
        FROM technicians WHERE id = $1
      `, [id]),

      query<{
        total_trips: number; total_km: number
        avg_speed_kmh: number; max_speed_kmh: number
        hard_brakes: number; rapid_accels: number; harsh_turns: number; accidents: number
        total_min: number
      }>(`
        SELECT
          COUNT(*)::int                                               AS total_trips,
          COALESCE(ROUND(SUM(distance_km)::numeric, 1), 0)::float    AS total_km,
          COALESCE(ROUND(AVG(avg_speed_kmh)::numeric, 1), 0)::float  AS avg_speed_kmh,
          COALESCE(ROUND(MAX(max_speed_kmh)::numeric, 1), 0)::float  AS max_speed_kmh,
          COALESCE(SUM(hard_brakes), 0)::int                         AS hard_brakes,
          COALESCE(SUM(rapid_accels), 0)::int                        AS rapid_accels,
          COALESCE(SUM(harsh_turns), 0)::int                         AS harsh_turns,
          COALESCE(SUM(accidents), 0)::int                           AS accidents,
          COALESCE(SUM(duration_min), 0)::int                        AS total_min
        FROM trips
        WHERE technician_id = $1
          AND status = 'completed'
          AND started_at::date BETWEEN $2 AND $3
      `, [id, from, to]),

      query<{ date: string; trips: number; km: number; incidents: number }>(`
        SELECT
          (started_at::date)::text                                   AS date,
          COUNT(*)::int                                              AS trips,
          COALESCE(ROUND(SUM(distance_km)::numeric, 1), 0)::float   AS km,
          COALESCE(SUM(hard_brakes + rapid_accels + harsh_turns + accidents), 0)::int AS incidents
        FROM trips
        WHERE technician_id = $1
          AND status = 'completed'
          AND started_at::date BETWEEN $2 AND $3
        GROUP BY started_at::date
        ORDER BY date ASC
      `, [id, from, to]),

      query<{
        id: string; started_at: string; ended_at: string | null
        distance_km: number; avg_speed_kmh: number; max_speed_kmh: number
        duration_min: number | null
        hard_brakes: number; rapid_accels: number; harsh_turns: number; accidents: number
      }>(`
        SELECT
          id, started_at, ended_at,
          COALESCE(ROUND(distance_km::numeric, 1), 0)::float      AS distance_km,
          COALESCE(ROUND(avg_speed_kmh::numeric, 1), 0)::float    AS avg_speed_kmh,
          COALESCE(ROUND(max_speed_kmh::numeric, 1), 0)::float    AS max_speed_kmh,
          duration_min,
          COALESCE(hard_brakes, 0)::int  AS hard_brakes,
          COALESCE(rapid_accels, 0)::int AS rapid_accels,
          COALESCE(harsh_turns, 0)::int  AS harsh_turns,
          COALESCE(accidents, 0)::int    AS accidents
        FROM trips
        WHERE technician_id = $1
          AND status = 'completed'
          AND started_at::date BETWEEN $2 AND $3
        ORDER BY started_at DESC
        LIMIT 200
      `, [id, from, to]),
    ])

    if (!techRows[0]) {
      res.status(404).json({ error: 'Técnico no encontrado' })
      return
    }

    res.json({
      from,
      to,
      technician: techRows[0],
      summary: summaryRows[0] ?? null,
      daily: dailyRows,
      trips: tripRows,
    })
  } catch (err) {
    console.error('[reports/technician]', err)
    res.status(500).json({ error: 'Error al generar reporte de técnico' })
  }
})

function today() { return new Date().toISOString().slice(0, 10) }
function daysAgo(n: number) { return new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10) }

export default router
