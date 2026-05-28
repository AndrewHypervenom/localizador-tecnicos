import webpush from 'web-push'
import { query } from '../config/db'

// ── Configuración VAPID (claves en .env) ──────────────────────────────────────
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  ?? ''
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? ''
const VAPID_SUBJECT = process.env.VAPID_SUBJECT     ?? 'mailto:alertas@positivosmais.com'

let _configured = false
function ensureConfigured(): boolean {
  if (_configured) return true
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return false
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)
  _configured = true
  return true
}

export function getVapidPublicKey(): string {
  return VAPID_PUBLIC
}

// ── Interfaz de canales (Web Push hoy; WhatsApp/email/SMS se enchufan luego) ──
export interface AlertPayload {
  title: string
  body: string
  tag?: string
  critical?: boolean
  data?: Record<string, unknown>
}

interface SubRow { id: string; subscription: webpush.PushSubscription }

/**
 * Envía la alerta a los líderes con scope sobre la empresa indicada
 * (y a todos los superadmins). Limpia suscripciones caducadas (404/410).
 */
export async function dispatchToCompany(companyId: string | null, payload: AlertPayload): Promise<void> {
  if (!ensureConfigured()) {
    console.warn('[push] VAPID no configurado (VAPID_PUBLIC_KEY/PRIVATE_KEY); se omite envío')
    return
  }

  const subs = await query<SubRow>(
    `SELECT id, subscription FROM push_subscriptions
      WHERE role = 'superadmin'
         OR ($1::uuid IS NOT NULL AND $1 = ANY(company_ids))`,
    [companyId],
  )
  if (!subs.length) return

  const body = JSON.stringify(payload)
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(s.subscription, body, {
        urgency: payload.critical ? 'high' : 'normal',
        TTL:     payload.critical ? 0 : 600,
      })
    } catch (e: any) {
      const code = e?.statusCode
      if (code === 404 || code === 410) {
        await query(`DELETE FROM push_subscriptions WHERE id = $1`, [s.id]).catch(() => {})
      } else {
        console.error('[push] envío falló:', e?.message)
      }
    }
  }))
}

export async function saveSubscription(
  userId: string,
  role: string,
  companyIds: string[],
  subscription: webpush.PushSubscription,
): Promise<void> {
  const endpoint = (subscription as any)?.endpoint
  if (!endpoint) throw new Error('Suscripción inválida: falta endpoint')
  await query(
    `INSERT INTO push_subscriptions (user_id, endpoint, subscription, role, company_ids)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET
       user_id      = EXCLUDED.user_id,
       subscription = EXCLUDED.subscription,
       role         = EXCLUDED.role,
       company_ids  = EXCLUDED.company_ids`,
    [userId, endpoint, JSON.stringify(subscription), role, companyIds],
  )
}

export async function removeSubscription(endpoint: string): Promise<void> {
  await query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [endpoint])
}
