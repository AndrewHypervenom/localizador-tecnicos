import { useEffect, useState } from 'react'
import { Bell, BellRing, BellOff } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { enablePushNotifications, pushSupported, syncPushIfGranted } from '@/lib/push'

type State = 'idle' | 'enabled' | 'denied' | 'unsupported' | 'working'

/** Botón para activar notificaciones push (alertas con el navegador cerrado). */
export function EnablePushButton({ className }: { className?: string }) {
  const [state, setState] = useState<State>('idle')

  useEffect(() => {
    if (!pushSupported()) { setState('unsupported'); return }
    if (Notification.permission === 'granted') {
      setState('enabled')
      void syncPushIfGranted()
    } else if (Notification.permission === 'denied') {
      setState('denied')
    }
  }, [])

  if (state === 'unsupported') return null

  const handleClick = async () => {
    setState('working')
    const result = await enablePushNotifications()
    if (result === 'enabled') {
      setState('enabled')
      toast.success('Notificaciones activadas', { description: 'Recibirás alertas aunque cierres el navegador.' })
    } else if (result === 'denied') {
      setState('denied')
      toast.error('Permiso denegado', { description: 'Habilita las notificaciones del sitio en el navegador.' })
    } else if (result === 'no-key') {
      setState('idle')
      toast.error('Falta configuración VAPID en el servidor.')
    } else {
      setState('idle')
      toast.error('No se pudieron activar las notificaciones.')
    }
  }

  const enabled = state === 'enabled'
  const Icon = enabled ? BellRing : state === 'denied' ? BellOff : Bell

  return (
    <button
      onClick={handleClick}
      disabled={enabled || state === 'working'}
      title={
        enabled ? 'Notificaciones activadas'
          : state === 'denied' ? 'Permiso denegado — habilítalo en el navegador'
            : 'Activar notificaciones push'
      }
      className={cn(
        'flex items-center gap-1 text-xs px-1.5 py-1 rounded-lg transition-colors',
        enabled ? 'text-success' : 'text-text-muted hover:text-primary hover:bg-primary/10',
        className,
      )}
    >
      <Icon className="w-3.5 h-3.5" />
      {enabled ? 'Alertas on' : state === 'working' ? '…' : 'Activar alertas'}
    </button>
  )
}
