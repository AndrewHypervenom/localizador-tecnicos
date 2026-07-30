import { useRef, type ReactNode } from 'react'
import { motion, useMotionTemplate, useMotionValue, type HTMLMotionProps } from 'framer-motion'
import { cn } from '@/lib/utils'
import { fadeUp, SPRING } from '@/lib/motion'

type CardProps = {
  children: ReactNode
  className?: string
  /** Luz que sigue al cursor. Reservalo para tarjetas destacadas. */
  spotlight?: boolean
  /** Eleva la tarjeta al pasar el cursor (para tarjetas clicables). */
  interactive?: boolean
  /** Participa del stagger del contenedor padre. */
  animate?: boolean
} & Omit<HTMLMotionProps<'div'>, 'children' | 'className'>

/**
 * Superficie base de la app.
 *
 * `spotlight` pinta un degradado radial que sigue al cursor usando valores de
 * movimiento en vez de estado de React: el gradiente se actualiza en el
 * compositor sin re-render, asi que se puede tener una rejilla entera con
 * spotlight sin costo perceptible.
 */
export function Card({
  children,
  className,
  spotlight = false,
  interactive = false,
  animate = true,
  ...rest
}: CardProps) {
  const ref = useRef<HTMLDivElement>(null)
  const mouseX = useMotionValue(-999)
  const mouseY = useMotionValue(-999)

  const background = useMotionTemplate`radial-gradient(340px circle at ${mouseX}px ${mouseY}px, rgba(0,214,50,0.09), transparent 72%)`

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!spotlight || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    mouseX.set(e.clientX - rect.left)
    mouseY.set(e.clientY - rect.top)
  }

  function handleMouseLeave() {
    if (!spotlight) return
    mouseX.set(-999)
    mouseY.set(-999)
  }

  return (
    <motion.div
      ref={ref}
      variants={animate ? fadeUp : undefined}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      whileHover={interactive ? { y: -3, transition: SPRING.snappy } : undefined}
      className={cn(
        'group relative bg-surface border border-border-soft rounded-2xl',
        'transition-colors duration-300',
        interactive && 'cursor-pointer hover:border-border hover:shadow-elev-3',
        spotlight && 'overflow-hidden',
        className,
      )}
      {...rest}
    >
      {spotlight && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{ background }}
        />
      )}
      {/* Brillo sutil en el borde superior — da volumen sin sumar markup. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/[0.07] to-transparent" />
      {children}
    </motion.div>
  )
}

/**
 * Encabezado de seccion dentro de una Card.
 * Sticky opcional para tablas largas — se pega al tope del contenedor scrolleable.
 */
export function CardHeader({
  children,
  className,
  sticky = false,
}: {
  children: ReactNode
  className?: string
  sticky?: boolean
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 px-5 py-4 border-b border-border-soft',
        // z-20 lo deja por encima de las filas pero por debajo de modales (z-50+).
        sticky && 'sticky top-0 z-20 glass rounded-t-2xl',
        className,
      )}
    >
      {children}
    </div>
  )
}
