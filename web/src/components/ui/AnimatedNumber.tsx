import { useEffect, useRef, useState } from 'react'
import { useInView, useMotionValue, useSpring } from 'framer-motion'
import { cn } from '@/lib/utils'

interface AnimatedNumberProps {
  value: number
  /** Decimales a mostrar. Por defecto entero. */
  decimals?: number
  /** Texto antes/despues de la cifra (p. ej. "%", " km"). */
  prefix?: string
  suffix?: string
  className?: string
  /** Separador de miles con `toLocaleString`. */
  locale?: string
}

/**
 * Cifra que cuenta hasta su valor cuando entra en pantalla.
 *
 * Escribe el texto por `ref` en vez de por estado para no re-renderizar el
 * componente en cada frame del resorte: con 6+ tarjetas contando a la vez, ir
 * por estado provoca decenas de renders por segundo y se nota en el scroll.
 */
export function AnimatedNumber({
  value,
  decimals = 0,
  prefix = '',
  suffix = '',
  className,
  locale = 'es-CO',
}: AnimatedNumberProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: '-40px' })
  const motionValue = useMotionValue(0)
  const spring = useSpring(motionValue, { stiffness: 90, damping: 24, mass: 0.9 })

  useEffect(() => {
    // Solo arranca cuando es visible; si el valor cambia despues (refresh de
    // datos) el resorte lo persigue desde donde iba.
    if (inView) motionValue.set(value)
  }, [inView, value, motionValue])

  useEffect(() => {
    const unsubscribe = spring.on('change', latest => {
      if (!ref.current) return
      const n = decimals > 0 ? latest : Math.round(latest)
      ref.current.textContent =
        prefix +
        n.toLocaleString(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) +
        suffix
    })
    return unsubscribe
  }, [spring, decimals, prefix, suffix, locale])

  return (
    <span ref={ref} className={cn('tabular', className)}>
      {/* Valor inicial para SSR/primer paint y para lectores de pantalla. */}
      {prefix}
      {(0).toLocaleString(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </span>
  )
}

/**
 * Variante para cifras que pueden venir nulas de la base (speed, altitude).
 * Muestra un guion en vez de animar hacia cero, que seria un dato falso.
 */
export function AnimatedMetric({
  value,
  dash = '—',
  ...rest
}: Omit<AnimatedNumberProps, 'value'> & { value: number | null | undefined; dash?: string }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return <span className={cn('tabular', rest.className)}>{dash}</span>
  }
  // Antes de montar no animamos para evitar un salto visible en hidratacion.
  if (!mounted) {
    return (
      <span className={cn('tabular', rest.className)}>
        {(rest.prefix ?? '') + value.toFixed(rest.decimals ?? 0) + (rest.suffix ?? '')}
      </span>
    )
  }
  return <AnimatedNumber value={value} {...rest} />
}
