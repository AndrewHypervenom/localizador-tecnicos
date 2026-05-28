import { Router, Request, Response } from 'express'
import { requireAuth } from '../middleware/requireAuth'
import { getUserCompanyIds } from '../lib/scopeUtils'
import { getVapidPublicKey, saveSubscription, removeSubscription } from '../services/pushService'
import { dispatchMotionEvent } from '../services/alertService'

const router = Router()

// Clave pública VAPID para que el navegador genere la suscripción.
router.get('/vapid-public-key', (_req: Request, res: Response) => {
  res.json({ key: getVapidPublicKey() })
})

// Webhook de Supabase: se llama en cada INSERT de motion_events.
// Seguridad: cabecera x-webhook-secret == ALERTS_WEBHOOK_SECRET.
router.post('/dispatch', async (req: Request, res: Response) => {
  const secret = process.env.ALERTS_WEBHOOK_SECRET
  if (!secret || req.headers['x-webhook-secret'] !== secret) {
    res.status(401).json({ error: 'No autorizado' })
    return
  }
  // Supabase DB Webhook → { type, table, record, ... }
  const record = (req.body?.record ?? req.body) as { id?: string }
  if (!record?.id) { res.status(400).json({ error: 'Falta record.id' }); return }

  // Responder rápido; despachar sin bloquear el webhook.
  res.json({ ok: true })
  dispatchMotionEvent(record.id).catch(e => console.error('[notifications/dispatch]', e?.message))
})

// Registrar / actualizar la suscripción Web Push del usuario autenticado.
router.post('/subscribe', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.authUser!
    const subscription = req.body?.subscription
    if (!subscription?.endpoint) { res.status(400).json({ error: 'Suscripción inválida' }); return }

    const ids = await getUserCompanyIds(user.id, user.role) // null = superadmin
    await saveSubscription(user.id, user.role, ids ?? [], subscription)
    res.json({ ok: true })
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'Error al guardar suscripción' })
  }
})

// Cancelar la suscripción (al desactivar notificaciones o cerrar sesión).
router.post('/unsubscribe', requireAuth, async (req: Request, res: Response) => {
  try {
    const endpoint = req.body?.endpoint
    if (!endpoint) { res.status(400).json({ error: 'Falta endpoint' }); return }
    await removeSubscription(endpoint)
    res.json({ ok: true })
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'Error al cancelar suscripción' })
  }
})

export default router
