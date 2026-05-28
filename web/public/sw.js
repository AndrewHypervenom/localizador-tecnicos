/* Service Worker — Web Push para alertas de líderes.
   Recibe el payload JSON enviado por el backend (pushService) y muestra la
   notificación del sistema aunque el navegador esté cerrado o en segundo plano. */

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { title: 'Localizador PositivoS+', body: event.data ? event.data.text() : '' }
  }

  const title = payload.title || 'Localizador PositivoS+'
  const options = {
    body:               payload.body || '',
    tag:                payload.tag,
    renotify:           !!payload.critical,
    requireInteraction: !!payload.critical,
    vibrate:            payload.critical ? [200, 100, 200, 100, 200] : [100],
    data:               payload.data || {},
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) return w.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow('/')
    }),
  )
})
