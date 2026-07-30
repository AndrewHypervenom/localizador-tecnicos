import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { HelpCircle, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n/i18n'
import { LEGEND_TONES, TONE_STYLE } from '@/lib/technicianStatus'

/**
 * Leyenda desplegable de los colores de estado.
 *
 * Existe porque los técnicos no encontraban intuitivo el semáforo: un punto de
 * color sin explicación es adivinanza. Va colapsada para no robar espacio y se
 * recuerda abierta/cerrada solo durante la sesión de la vista.
 */
export function StatusLegend({ className, defaultOpen = false }: {
  className?: string
  defaultOpen?: boolean
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className={cn('bg-surface border border-border-soft rounded-xl overflow-hidden', className)}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-raised transition-colors"
      >
        <HelpCircle className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
        <span className="text-xs font-medium text-text-secondary flex-1">
          {t('techStatus.legend.title')}
        </span>
        {/* Muestra los 4 colores incluso colapsada: da una pista de qué hay dentro. */}
        <span className="flex items-center gap-1 flex-shrink-0">
          {LEGEND_TONES.map(({ tone }) => (
            <span key={tone} className={cn('w-1.5 h-1.5 rounded-full', TONE_STYLE[tone].dot)} />
          ))}
        </span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.15 }} className="flex-shrink-0">
          <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-1 space-y-2.5 border-t border-border-soft">
              {LEGEND_TONES.map(({ tone, labelKey, descKey }) => (
                <div key={tone} className="flex items-start gap-2.5">
                  <span className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1', TONE_STYLE[tone].dot)} />
                  <div className="min-w-0">
                    <p className={cn('text-xs font-semibold', TONE_STYLE[tone].text)}>{t(labelKey)}</p>
                    <p className="text-xs text-text-muted leading-relaxed mt-0.5">{t(descKey)}</p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
