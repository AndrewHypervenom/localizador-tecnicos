import api from './api'

export type PushResult = 'enabled' | 'denied' | 'unsupported' | 'no-key' | 'error'

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalized)
  const arr = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

/**
 * Registra el service worker, pide permiso y suscribe al usuario a Web Push,
 * enviando la suscripción al backend. Debe llamarse desde un gesto del usuario.
 */
export async function enablePushNotifications(): Promise<PushResult> {
  if (!pushSupported()) return 'unsupported'

  try {
    const reg = await navigator.serviceWorker.register('/sw.js')

    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return 'denied'

    const { data } = await api.get('/api/notifications/vapid-public-key')
    const key: string | undefined = data?.key
    if (!key) return 'no-key'

    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      })
    }

    await api.post('/api/notifications/subscribe', { subscription: sub.toJSON() })
    return 'enabled'
  } catch (e) {
    console.error('[push] enable falló:', e)
    return 'error'
  }
}

/** Re-sincroniza la suscripción en silencio si el permiso ya está concedido. */
export async function syncPushIfGranted(): Promise<void> {
  if (!pushSupported() || Notification.permission !== 'granted') return
  await enablePushNotifications().catch(() => {})
}

export async function disablePushNotifications(): Promise<void> {
  if (!pushSupported()) return
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (sub) {
    await api.post('/api/notifications/unsubscribe', { endpoint: sub.endpoint }).catch(() => {})
    await sub.unsubscribe().catch(() => {})
  }
}
