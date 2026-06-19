import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useI18n } from '@/lib/i18n/i18n'

// Auto-actualización del sitio: detecta despliegues nuevos comparando el
// __APP_VERSION__ con el que arrancó la app contra /version.json (emitido en
// cada build). Recarga de forma DISCRETA y SEGURA: nunca corta una interacción
// en curso — espera a que el usuario esté inactivo o cambie de pestaña.

const VERSION_URL = '/version.json'
const POLL_MS = 5 * 60_000   // revisar cada 5 min
const IDLE_MS = 60_000       // recargar tras 60 s sin actividad

export function useAppUpdate() {
  const { t } = useI18n()
  const current = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : null

  const updateReadyRef = useRef(false)
  const notifiedRef    = useRef(false)
  const idleTimerRef   = useRef<number>()

  useEffect(() => {
    if (!current) return
    let cancelled = false

    const reloadNow = () => {
      if (updateReadyRef.current) window.location.reload()
    }

    const scheduleIdleReload = () => {
      window.clearTimeout(idleTimerRef.current)
      idleTimerRef.current = window.setTimeout(() => {
        // Solo si sigue visible (si está oculta, ya recarga visibilitychange)
        if (updateReadyRef.current && !document.hidden) reloadNow()
      }, IDLE_MS)
    }

    const onActivity = () => {
      if (updateReadyRef.current) scheduleIdleReload()
    }

    const check = async () => {
      try {
        const res = await fetch(`${VERSION_URL}?ts=${Date.now()}`, { cache: 'no-store' })
        if (!res.ok || cancelled) return
        const data = await res.json().catch(() => null)
        const latest = data?.version as string | undefined
        if (!latest || cancelled) return

        if (latest !== current && !updateReadyRef.current) {
          updateReadyRef.current = true
          if (!notifiedRef.current) {
            notifiedRef.current = true
            toast.info(t('update.available'), { duration: 6000 })
          }
          // Si ahora mismo está en otra pestaña, recargar ya (verá fresco al volver).
          if (document.hidden) reloadNow()
          else scheduleIdleReload()
        }
      } catch {
        /* sin red o entorno dev sin version.json: ignorar */
      }
    }

    const onVisibility = () => {
      if (document.hidden) {
        if (updateReadyRef.current) reloadNow()
      } else {
        check()
      }
    }

    const poll = window.setInterval(check, POLL_MS)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pointerdown', onActivity, { passive: true })
    window.addEventListener('keydown', onActivity)

    check() // comprobación inicial

    return () => {
      cancelled = true
      window.clearInterval(poll)
      window.clearTimeout(idleTimerRef.current)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pointerdown', onActivity)
      window.removeEventListener('keydown', onActivity)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current])
}
