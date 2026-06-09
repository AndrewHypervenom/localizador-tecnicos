import { query } from '../config/db'
import { dispatchToCompany, type AlertPayload } from './pushService'

// ── Umbrales ──────────────────────────────────────────────────────────────────
const OFFLINE_THRESHOLD_MIN = 15   // sin enviar ubicación (estado "sin señal")
const OFFLINE_RECENT_HOURS  = 24   // solo técnicos con actividad reciente
const OFFLINE_DEDUP_MIN     = 30   // no repetir alerta offline dentro de este lapso
// Tolerancia del latido (heartbeat): si la app sigue latiendo dentro de este
// lapso, NO está "desconectada" aunque no envíe puntos GPS (está viva sin señal
// GPS). Mayor que el intervalo del watchdog (~15 min) para no marcar offline a
// quien sí late. Si NO hay latido reciente, sí es una desconexión real.
const HEARTBEAT_STALE_MIN   = 20
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
  // Bitácora de dispositivo (sabotaje del rastreo)
  gps_off:             '📍 Apagó el GPS',
  net_off:             '📵 Apagó datos / Wi-Fi',
  mock_on:             '👻 Ubicación falsa (Fake GPS)',
  battery_restricted:  '🪫 Restringió la batería de la app',
  tracking_killed:     '✖️ Cerró la app a la fuerza',
  perm_revoked:        '🚫 Quitó "Permitir siempre"',
  clock_skew:          '🕐 Reloj del teléfono alterado',
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

// Eventos de la bitácora del dispositivo que EXPLICAN un silencio: si alguno
// ocurrió poco antes de quedarse sin señal, el hueco tiene causa declarada por el
// propio teléfono (el técnico apagó GPS/datos, usó Fake GPS, restringió batería o
// detuvo el rastreo). Si NO hay ninguno, el silencio es "sin causa declarada":
// la firma típica de force-stop / borrar la app de recientes para que deje de
// rastrear y luego decir "la app no sirve".
const OFFLINE_CAUSE_TYPES = [
  'gps_off', 'net_off', 'mock_on', 'battery_restricted', 'tracking_stop', 'tracking_killed',
  'perm_revoked',
]
// Ventana hacia atrás para buscar la causa (algo mayor que el umbral de silencio
// para cubrir el desfase entre el último fix y la detección del cron).
const OFFLINE_CAUSE_LOOKBACK_MIN = OFFLINE_THRESHOLD_MIN + 10

/**
 * Inserta alerta 'offline' SOLO para técnicos que de verdad se desconectaron:
 * dejaron de enviar puntos GPS Y dejaron de latir (heartbeat). Si la app sigue
 * latiendo (viva, aunque sin señal GPS) NO se genera 'offline' — eso ya no es
 * una desconexión, es "app activa sin señal" y el front lo pinta en amarillo a
 * partir del heartbeat. Así se elimina el falso "desconectado" que aparecía
 * cuando el técnico estaba en un túnel/edificio o con el GPS apagado.
 *
 * Compatibilidad: si el técnico no tiene fila de heartbeat (APK antigua sin el
 * latido), se comporta como antes (la condición de heartbeat se cumple con NULL).
 */
export async function detectOfflineTechnicians(): Promise<void> {
  await query(
    `INSERT INTO motion_events (technician_id, ts, event_type, severity, location)
     SELECT t.id, now(), 'offline',
            -- severidad 50 = silencio con causa declarada (GPS/datos off, etc.);
            -- 70 = SIN causa declarada (probable force-stop / app cerrada a mano).
            CASE WHEN EXISTS (
              SELECT 1 FROM motion_events mc
               WHERE mc.technician_id = t.id
                 AND mc.event_type = ANY($4::text[])
                 AND mc.ts > now() - ($5 || ' minutes')::interval
            ) THEN 50 ELSE 70 END,
            NULL
       FROM technicians t
       JOIN technician_current_status s ON s.id = t.id
       LEFT JOIN companies c ON c.id = t.company_id
       LEFT JOIN technician_heartbeat h ON h.technician_id = t.id
      WHERE t.active = true
        AND s.last_seen < now() - ($1 || ' minutes')::interval
        AND s.last_seen > now() - ($2 || ' hours')::interval${WITHIN_COMPANY_HOURS}
        -- La app dejó de latir (o nunca latió → APK antigua): desconexión real.
        AND (h.last_heartbeat IS NULL OR h.last_heartbeat < now() - ($6 || ' minutes')::interval)
        AND NOT EXISTS (
          SELECT 1 FROM motion_events m
           WHERE m.technician_id = t.id
             AND m.event_type = 'offline'
             AND m.ts > now() - ($3 || ' minutes')::interval
        )
     RETURNING id`,
    [OFFLINE_THRESHOLD_MIN, OFFLINE_RECENT_HOURS, OFFLINE_DEDUP_MIN,
     OFFLINE_CAUSE_TYPES, OFFLINE_CAUSE_LOOKBACK_MIN, HEARTBEAT_STALE_MIN],
  )
  // No se despacha push: 'offline' es silencioso (ver SILENT_PUSH_TYPES). Los
  // registros quedan en motion_events para el panel/historial del líder, donde la
  // severidad distingue "sin causa declarada" (sabotaje probable) del normal.
}

// ── Reloj manipulado ──────────────────────────────────────────────────────────
// El dispositivo manda `ts` (su reloj); el servidor guarda `received_at = now()`
// al insertar. Si `ts` viene en el FUTURO respecto a received_at, el reloj del
// teléfono está adelantado a propósito (truco para falsear horas de trabajo).
// Solo detectamos el adelanto: un `ts` muy en el pasado es ambiguo (puede ser
// backlog offline legítimo que se envió tarde), así que no se marca.
const CLOCK_SKEW_MIN          = 5    // ts adelantado más de esto = manipulado
const CLOCK_SKEW_LOOKBACK_MIN = 10   // solo inserciones recientes
const CLOCK_SKEW_DEDUP_HOURS  = 6

/** Inserta 'clock_skew' para técnicos cuyo reloj envía timestamps futuros. */
export async function detectClockSkew(): Promise<void> {
  const inserted = await query<{ id: string }>(
    `INSERT INTO motion_events (technician_id, ts, event_type, severity, location)
     SELECT DISTINCT le.technician_id, now(), 'clock_skew', 60, NULL
       FROM location_events le
       JOIN technicians t ON t.id = le.technician_id
      WHERE t.active = true
        -- Filtro por ts (clave de partición) para que el planner pode a la
        -- partición del mes actual: un reloj adelantado da ts en el futuro, así
        -- que el evento siempre cae en ts > now() - margen. Evita escanear todas
        -- las particiones aunque no exista índice sobre received_at.
        AND le.ts > now() - interval '1 hour'
        AND le.received_at > now() - ($1 || ' minutes')::interval
        AND le.ts > le.received_at + ($2 || ' minutes')::interval
        AND NOT EXISTS (
          SELECT 1 FROM motion_events m
           WHERE m.technician_id = le.technician_id
             AND m.event_type = 'clock_skew'
             AND m.ts > now() - ($3 || ' hours')::interval
        )
     RETURNING id`,
    [CLOCK_SKEW_LOOKBACK_MIN, CLOCK_SKEW_MIN, CLOCK_SKEW_DEDUP_HOURS],
  )
  for (const r of inserted) await dispatchMotionEvent(r.id)
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
  try { await detectClockSkew() }          catch (e) { console.error('[alerts] clock_skew:', e) }
  try { await detectLowBattery() }         catch (e) { console.error('[alerts] battery:', e) }
  try { await detectHomeTransitions() }    catch (e) { console.error('[alerts] home:', e) }
  try { await escalateUnacknowledged() }   catch (e) { console.error('[alerts] escalate:', e) }
}
