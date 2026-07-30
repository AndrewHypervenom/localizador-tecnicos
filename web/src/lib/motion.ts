import type { Transition, Variants } from 'framer-motion'

/**
 * Tokens de movimiento compartidos.
 *
 * Todo el sitio anima con estos valores para que las transiciones se sientan
 * como un solo sistema y no como efectos sueltos por componente. Si hay que
 * ajustar el "peso" de la interfaz, se ajusta aca y no en 30 archivos.
 */

/** Curvas. `easeOutExpo` es la de salida por defecto: arranca rapido y frena suave. */
export const EASE = {
  out:     [0.16, 1, 0.3, 1] as const,   // easeOutExpo — entradas
  inOut:   [0.65, 0, 0.35, 1] as const,  // simetrica — movimientos de ida y vuelta
  outBack: [0.34, 1.56, 0.64, 1] as const, // leve sobrepaso — badges, iconos
}

/** Resortes. `snappy` para UI que responde al cursor, `soft` para layout. */
export const SPRING = {
  snappy: { type: 'spring', stiffness: 420, damping: 34, mass: 0.7 } satisfies Transition,
  soft:   { type: 'spring', stiffness: 260, damping: 30, mass: 0.9 } satisfies Transition,
  bouncy: { type: 'spring', stiffness: 380, damping: 22, mass: 0.8 } satisfies Transition,
  /** Para el ancho del sidebar y otros cambios de layout grandes. */
  layout: { type: 'spring', stiffness: 300, damping: 32, mass: 0.8 } satisfies Transition,
}

export const DUR = { fast: 0.18, base: 0.32, slow: 0.55 }

/* ── Variantes reutilizables ─────────────────────────────────────────────── */

/** Entrada desde abajo. La usan cards, filas de tabla y bloques de contenido. */
export const fadeUp: Variants = {
  hidden:  { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: DUR.base, ease: EASE.out } },
  exit:    { opacity: 0, y: -8, transition: { duration: DUR.fast, ease: EASE.out } },
}

export const fadeIn: Variants = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1, transition: { duration: DUR.base, ease: EASE.out } },
  exit:    { opacity: 0, transition: { duration: DUR.fast } },
}

/** Entrada con escala — para modales, popovers y tarjetas destacadas. */
export const scaleIn: Variants = {
  hidden:  { opacity: 0, scale: 0.96, y: 8 },
  visible: { opacity: 1, scale: 1, y: 0, transition: SPRING.snappy },
  exit:    { opacity: 0, scale: 0.97, y: 4, transition: { duration: DUR.fast, ease: EASE.out } },
}

/**
 * Contenedor que escalona a sus hijos.
 *
 * `delayChildren` evita que el primer hijo arranque junto con el contenedor,
 * que es lo que hace que un stagger se lea como cascada y no como un salto.
 */
export function stagger(step = 0.045, delayChildren = 0.04): Variants {
  return {
    hidden:  {},
    visible: { transition: { staggerChildren: step, delayChildren } },
    exit:    { transition: { staggerChildren: 0.02, staggerDirection: -1 } },
  }
}

/** Transicion de pagina/tab: la saliente se va antes de que entre la nueva. */
export const pageTransition: Variants = {
  hidden:  { opacity: 0, y: 12, filter: 'blur(4px)' },
  visible: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.38, ease: EASE.out } },
  exit:    { opacity: 0, y: -10, filter: 'blur(4px)', transition: { duration: 0.2, ease: EASE.out } },
}

/** Deslizamiento lateral — drawer movil y paneles laterales. */
export const slideInLeft: Variants = {
  hidden:  { x: '-100%' },
  visible: { x: 0, transition: SPRING.layout },
  exit:    { x: '-100%', transition: { duration: 0.22, ease: EASE.out } },
}

/** Colapso vertical de alto real (secciones expandibles). */
export const collapse: Variants = {
  hidden:  { height: 0, opacity: 0 },
  visible: { height: 'auto', opacity: 1, transition: { height: SPRING.soft, opacity: { duration: DUR.fast, delay: 0.05 } } },
  exit:    { height: 0, opacity: 0, transition: { height: { duration: 0.22, ease: EASE.out }, opacity: { duration: 0.12 } } },
}

/** Interacciones tactiles estandar para botones y cards clicables. */
export const tap = { scale: 0.97 }
export const liftHover = { y: -3, transition: SPRING.snappy }
