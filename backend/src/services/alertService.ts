import { query } from '../config/db'
import { dispatchToCompany, type AlertPayload } from './pushService'

// ── Umbrales ──────────────────────────────────────────────────────────────────
const OFFLINE_THRESHOLD_MIN = 10   // sin enviar ubicación
const OFFLINE_RECENT_HOURS  = 24   // solo técnicos con actividad reciente
const OFFLINE_DEDUP_MIN     = 30   // no repetir alerta offline dentro de este lapso
const BATTERY_LOW_PCT       = 20
const BATTERY_DEDUP_HOURS   = 6
const ESCALATE_AFTER_MIN    = 5    // accidente/SOS sin acuse
const ESCALATE_MAX_AGE_MIN  = 120  // no escalar eventos demasiado viejos

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
}

const CRITICAL = new Set(['accident', 'sos'])

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
  const inserted = await query<{ id: string }>(
    `INSERT INTO motion_events (technician_id, ts, event_type, severity, location)
     SELECT t.id, now(), 'offline', 50, NULL
       FROM technicians t
       JOIN technician_current_status s ON s.id = t.id
      WHERE t.active = true
        AND s.last_seen < now() - ($1 || ' minutes')::interval
        AND s.last_seen > now() - ($2 || ' hours')::interval
        AND NOT EXISTS (
          SELECT 1 FROM motion_events m
           WHERE m.technician_id = t.id
             AND m.event_type = 'offline'
             AND m.ts > now() - ($3 || ' minutes')::interval
        )
     RETURNING id`,
    [OFFLINE_THRESHOLD_MIN, OFFLINE_RECENT_HOURS, OFFLINE_DEDUP_MIN],
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
      WHERE t.active = true
        AND s.battery IS NOT NULL
        AND s.battery < $1
        AND s.last_seen > now() - interval '30 minutes'
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
  try { await escalateUnacknowledged() }   catch (e) { console.error('[alerts] escalate:', e) }
}
