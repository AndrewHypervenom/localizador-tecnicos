import { useEffect, useState } from 'react'
import { Bell, BellRing, BellOff } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { enablePushNotifications, pushSupported, syncPushIfGranted } from '@/lib/push'
import { useI18n } from '@/lib/i18n/i18n'

type State = 'idle' | 'enabled' | 'denied' | 'unsupported' | 'working'

/** Botón para activar notificaciones push (alertas con el navegador cerrado). */
export function EnablePushButton({ className }: { className?: string }) {
  const { t } = useI18n()
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
      toast.success(t('push.enabled'), { description: t('push.enabledDesc') })
    } else if (result === 'denied') {
      setState('denied')
      toast.error(t('push.denied'), { description: t('push.deniedDesc') })
    } else if (result === 'no-key') {
      setState('idle')
      toast.error(t('push.noKey'))
    } else {
      setState('idle')
      toast.error(t('push.failed'))
    }
  }

  const enabled = state === 'enabled'
  const Icon = enabled ? BellRing : state === 'denied' ? BellOff : Bell

  return (
    <button
      onClick={handleClick}
      disabled={enabled || state === 'working'}
      title={
        enabled ? t('push.enabled')
          : state === 'denied' ? t('push.deniedTitle')
            : t('push.enableTitle')
      }
      className={cn(
        'flex items-center gap-1 text-xs px-1.5 py-1 rounded-lg transition-colors',
        enabled ? 'text-success' : 'text-text-muted hover:text-primary hover:bg-primary/10',
        className,
      )}
    >
      <Icon className="w-3.5 h-3.5" />
      {enabled ? t('push.alertsOn') : state === 'working' ? '…' : t('push.enableAlerts')}
    </button>
  )
}
