import { query } from '../config/db'
import { dispatchToCompany, type AlertPayload } from './pushService'

// ── Umbrales ──────────────────────────────────────────────────────────────────
const OFFLINE_THRESHOLD_MIN = 15   // sin enviar ubicación (estado "sin señal")
const OFFLINE_RECENT_HOURS  = 24   // solo técnicos con actividad reciente
const OFFLINE_DEDUP_MIN     = 30   // no repetir alerta offline dentro de este lapso
const BATTERY_LOW_PCT       = 20
const BATTERY_DEDUP_HOURS   = 6
const ESCALATE_AFTER_MIN    = 5    // accidente/SOS sin acuse
const ESCALATE_MAX_AGE_MIN  = 120  // no escalar eventos demasiado viejos

// ── Horario laboral (por empresa) ────────────────────────────────────────────────
// Fuera del horario de SU empresa es NORMAL que el técnico se desconecte (terminó el
// turno), así que NO generamos "sin señal" ni "batería baja" — eso evita la lluvia
// de alertas de 5pm a 8am. Las emergencias (accidente/SOS) sí se escalan 24/7.
// El horario se configura por empresa desde el sitio (columnas en la tabla
// `companies`); aquí solo se filtra en SQL con la hora LOCAL de cada empresa, en
// una sola consulta (escala sin bucles). `now() AT TIME ZONE c.work_tz` da la hora
// de pared de esa empresa; en EXTRACT(DOW ...) 0=domingo y 6=sábado.
const WITHIN_COMPANY_HOURS = `
        AND EXTRACT(HOUR FROM (now() AT TIME ZONE COALESCE(c.work_tz, 'America/Bogota')))
              >= COALESCE(c.work_start_hour, 8)
        AND EXTRACT(HOUR FROM (now() AT TIME ZONE COALESCE(c.work_tz, 'America/Bogota')))
              <  COALESCE(c.work_end_hour, 17)
        AND (COALESCE(c.work_skip_weekends, true) = false
             OR EXTRACT(DOW FROM (now() AT TIME ZONE COALESCE(c.work_tz, 'America/Bogota'))) NOT IN (0, 6))`

interface MotionEventRow {
  id: string
  technician_id: string
  event_type: string
  severity: number | null
  ts: string
  acknowledged: boolean
  notified_at: string | null
  company_id: string | null
  tech_name: string | null
}

const LABELS: Record<string, string> = {
  accident:    '🚨 Accidente detectado',
  sos:         '🆘 SOS — Emergencia',
  hard_brake:  '⚠️ Frenada brusca',
  rapid_accel: '⚡ Aceleración rápida',
  harsh_turn:  '↩️ Giro brusco',
  offline:     '📡 Técnico sin señal',
  battery_low: '🔋 Batería baja',
  home_enter:  '🏠 Llegó a casa',
  home_exit:   '🚪 Salió de casa',
}

const CRITICAL = new Set(['accident', 'sos'])

// Eventos que se REGISTRAN (para el panel/historial) pero nunca disparan push.
// "offline" (sin señal) es un estado, no una emergencia: perder GPS unos minutos
// es normal (edificios, túneles, ahorro de batería) y no debe notificar por
// técnico — con muchos técnicos sería spam y no escala.
const SILENT_PUSH_TYPES = new Set(['offline'])

function buildPayload(ev: MotionEventRow, escalation = false): AlertPayload {
  const label = LABELS[ev.event_type] ?? 'Evento de conducción'
  const name  = ev.tech_name ?? 'Técnico'
  return {
    title:    escalation ? `${label} (sin atender)` : label,
    body:     escalation ? `${name} — nadie ha reconocido la alerta` : name,
    tag:      `motion-${ev.id}`,
    critical: CRITICAL.has(ev.event_type),
    data:     { eventId: ev.id, technicianId: ev.technician_id, type: ev.event_type, ts: ev.ts },
  }
}

async function loadEvent(eventId: string): Promise<MotionEventRow | null> {
  const rows = await query<MotionEventRow>(
    `SELECT m.id, m.technician_id, m.event_type, m.severity, m.ts, m.acknowledged,
            m.notified_at, t.company_id, t.name AS tech_name
       FROM motion_events m
       JOIN technicians t ON t.id = m.technician_id
      WHERE m.id = $1`,
    [eventId],
  )
  return rows[0] ?? null
}

/**
 * Despacha la notificación de un motion_event. Idempotente: si ya fue
 * notificado no reenvía (salvo escalamiento). Lo llaman el webhook de
 * Supabase (inserts nuevos) y el cron de generación.
 */
export async function dispatchMotionEvent(eventId: string, escalation = false): Promise<void> {
  const ev = await loadEvent(eventId)
  if (!ev) return
  if (!escalation && ev.notified_at) return // ya notificado por otro disparador

  // Estado silencioso (sin señal): se marca como atendido y NO se envía push.
  // Este es el único punto por el que pasan el cron y el webhook de Supabase,
  // así que silenciar aquí cubre ambos caminos.
  if (SILENT_PUSH_TYPES.has(ev.event_type)) {
    if (!ev.notified_at) await query(`UPDATE motion_events SET notified_at = now() WHERE id = $1`, [eventId])
    return
  }

  await dispatchToCompany(ev.company_id, buildPayload(ev, escalation))

  if (escalation) {
    await query(`UPDATE motion_events SET escalated_at = now() WHERE id = $1`, [eventId])
  } else {
    await query(`UPDATE motion_events SET notified_at = now() WHERE id = $1`, [eventId])
  }
}

// ── Generación de alertas del lado servidor (cron) ────────────────────────────

/** Inserta alerta 'offline' para técnicos activos que dejaron de enviar. */
export async function detectOfflineTechnicians(): Promise<void> {
  await query(
    `INSERT INTO motion_events (technician_id, ts, event_type, severity, location)
     SELECT t.id, now(), 'offline', 50, NULL
       FROM technicians t
       JOIN technician_current_status s ON s.id = t.id
       LEFT JOIN companies c ON c.id = t.company_id
      WHERE t.active = true
        AND s.last_seen < now() - ($1 || ' minutes')::interval
        AND s.last_seen > now() - ($2 || ' hours')::interval${WITHIN_COMPANY_HOURS}
        AND NOT EXISTS (
          SELECT 1 FROM motion_events m
           WHERE m.technician_id = t.id
             AND m.event_type = 'offline'
             AND m.ts > now() - ($3 || ' minutes')::interval
        )
     RETURNING id`,
    [OFFLINE_THRESHOLD_MIN, OFFLINE_RECENT_HOURS, OFFLINE_DEDUP_MIN],
  )
  // No se despacha push: 'offline' es silencioso (ver SILENT_PUSH_TYPES). Los
  // registros quedan en motion_events para el panel/historial del líder.
}

/** Inserta alerta 'battery_low' cuando la batería del último punto cae bajo el umbral. */
export async function detectLowBattery(): Promise<void> {
  const inserted = await query<{ id: string }>(
    `INSERT INTO motion_events (technician_id, ts, event_type, severity, location)
     SELECT t.id, now(), 'battery_low', 30, NULL
       FROM technicians t
       JOIN technician_current_status s ON s.id = t.id
       LEFT JOIN companies c ON c.id = t.company_id
      WHERE t.active = true
        AND s.battery IS NOT NULL
        AND s.battery < $1
        AND s.last_seen > now() - interval '30 minutes'${WITHIN_COMPANY_HOURS}
        AND NOT EXISTS (
          SELECT 1 FROM motion_events m
           WHERE m.technician_id = t.id
             AND m.event_type = 'battery_low'
             AND m.ts > now() - ($2 || ' hours')::interval
        )
     RETURNING id`,
    [BATTERY_LOW_PCT, BATTERY_DEDUP_HOURS],
  )
  for (const r of inserted) await dispatchMotionEvent(r.id)
}

/**
 * Inserta home_enter / home_exit comparando la última posición conocida de cada
 * técnico con su casa asignada (home_lat/home_lng + home_radius). Funciona por
 * transición: solo registra el evento cuando el estado cambia respecto al último
 * evento de casa, así no repite "entró" mientras siga dentro ni "salió" mientras
 * siga fuera.
 *
 * - Si está DENTRO y el último evento no fue 'home_enter' (o no hay ninguno) → 'home_enter'.
 * - Si está FUERA y el último evento fue 'home_enter'                        → 'home_exit'.
 *   (No registramos "salió" si nunca hubo un "entró": evita ruido al arrancar.)
 *
 * Es una sola consulta basada en conjuntos (escala sin bucles). Cada técnico
 * pertenece a una empresa (t.company_id), así que el push se reparte por tenant
 * en dispatchMotionEvent → dispatchToCompany. Se ejecuta 24/7: entrar/salir de
 * casa marca el inicio/fin de jornada y es relevante a cualquier hora.
 */
export async function detectHomeTransitions(): Promise<void> {
  const inserted = await query<{ id: string }>(
    `WITH last_home_evt AS (
       SELECT DISTINCT ON (technician_id) technician_id, event_type
         FROM motion_events
        WHERE event_type IN ('home_enter', 'home_exit')
        ORDER BY technician_id, ts DESC
     )
     INSERT INTO motion_events (technician_id, ts, event_type, severity, location)
     SELECT t.id, now(),
            CASE WHEN d.inside THEN 'home_enter' ELSE 'home_exit' END,
            10,
            NULL
       FROM technicians t
       JOIN technician_current_status s ON s.id = t.id
       LEFT JOIN last_home_evt e ON e.technician_id = t.id
       CROSS JOIN LATERAL (
         SELECT ST_DWithin(
                  ST_SetSRID(ST_MakePoint(s.lng, s.lat),           4326)::geography,
                  ST_SetSRID(ST_MakePoint(t.home_lng, t.home_lat), 4326)::geography,
                  COALESCE(t.home_radius, 100)
                ) AS inside
       ) d
      WHERE t.active = true
        AND t.home_lat IS NOT NULL AND t.home_lng IS NOT NULL
        AND s.lat IS NOT NULL AND s.lng IS NOT NULL
        AND s.last_seen > now() - interval '15 minutes'
        AND (
              (d.inside     AND e.event_type IS DISTINCT FROM 'home_enter')
           OR (NOT d.inside AND e.event_type = 'home_enter')
        )
     RETURNING id`,
  )
  for (const r of inserted) await dispatchMotionEvent(r.id)
}

/** Re-notifica accidentes/SOS críticos sin acuse pasados unos minutos. */
export async function escalateUnacknowledged(): Promise<void> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM motion_events
      WHERE event_type IN ('accident','sos')
        AND acknowledged = false
        AND escalated_at IS NULL
        AND ts < now() - ($1 || ' minutes')::interval
        AND ts > now() - ($2 || ' minutes')::interval`,
    [ESCALATE_AFTER_MIN, ESCALATE_MAX_AGE_MIN],
  )
  for (const r of rows) await dispatchMotionEvent(r.id, true)
}

/** Ejecuta todas las comprobaciones del cron de alertas. */
export async function runAlertChecks(): Promise<void> {
  try { await detectOfflineTechnicians() } catch (e) { console.error('[alerts] offline:', e) }
  try { await detectLowBattery() }         catch (e) { console.error('[alerts] battery:', e) }
  try { await detectHomeTransitions() }    catch (e) { console.error('[alerts] home:', e) }
  try { await escalateUnacknowledged() }   catch (e) { console.error('[alerts] escalate:', e) }
}
