import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { EASE } from '@/lib/motion'

/**
 * Titulo de seccion con subtitulo y acciones a la derecha.
 * Se anima como una unidad para que cada vista abra igual.
 */
export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  actions,
  className,
}: {
  icon?: React.ElementType
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE.out }}
      className={cn('flex items-start gap-4 flex-wrap', className)}
    >
      {Icon && (
        <motion.div
          initial={{ scale: 0.8, rotate: -8 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ duration: 0.45, ease: EASE.outBack }}
          className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/20 to-accent/10 border border-primary/25 flex items-center justify-center flex-shrink-0 shadow-glow-primary"
        >
          <Icon className="w-5 h-5 text-primary" />
        </motion.div>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="text-lg font-bold text-text-primary tracking-tight truncate">{title}</h1>
        {subtitle && <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </motion.div>
  )
}

/** Estado vacio ilustrado — reemplaza los "Sin datos" sueltos. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: React.ElementType
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: EASE.out }}
      className={cn('flex flex-col items-center justify-center text-center py-16 px-6', className)}
    >
      <div className="relative mb-4">
        {/* Anillos que respiran detras del icono. */}
        <div aria-hidden className="absolute inset-0 rounded-full bg-primary/10 animate-ring-expand" />
        <div className="relative w-14 h-14 rounded-2xl bg-surface-raised border border-border-soft flex items-center justify-center animate-float">
          <Icon className="w-6 h-6 text-text-muted" />
        </div>
      </div>
      <p className="text-sm font-semibold text-text-secondary">{title}</p>
      {description && <p className="text-xs text-text-muted mt-1.5 max-w-sm">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </motion.div>
  )
}
