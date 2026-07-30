import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useScroll, useSpring } from 'framer-motion'
import { Menu, PanelLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { EASE, SPRING, pageTransition } from '@/lib/motion'
import { useI18n } from '@/lib/i18n/i18n'
import {
  Sidebar, SHORTCUT_HINT, readCollapsedPref, readHiddenPref,
  writeCollapsedPref, writeHiddenPref, type NavItem,
} from './Sidebar'

interface AppShellProps {
  items: NavItem[]
  activeId: string
  onSelect: (id: string) => void
  onLogout: () => void
  /** Insignia de rol dentro del sidebar (p. ej. "Panel de Administración"). */
  badgeLabel?: string
  /** Titulo de la vista actual, a la izquierda de la barra superior. */
  title?: ReactNode
  subtitle?: ReactNode
  /** Acciones de la barra superior (botones, selector de idioma). */
  topbarActions?: ReactNode
  /** Extra al pie del sidebar. */
  sidebarFooter?: ReactNode
  /**
   * `true` para vistas que gestionan su propio alto (mapas, split panes):
   * el contenido recibe el alto exacto disponible y NO scrollea el contenedor.
   */
  fullBleed?: boolean
  children: ReactNode
}

/* ── Shell ───────────────────────────────────────────────────────────────── */

export function AppShell({
  items,
  activeId,
  onSelect,
  onLogout,
  badgeLabel,
  title,
  subtitle,
  topbarActions,
  sidebarFooter,
  fullBleed = false,
  children,
}: AppShellProps) {
  const { t } = useI18n()
  const [collapsed, setCollapsed] = useState(readCollapsedPref)
  const [hidden, setHidden] = useState(readHiddenPref)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [canScroll, setCanScroll] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Barra de progreso de lectura: da sensacion de continuidad en vistas largas.
  const { scrollYProgress } = useScroll({ container: scrollRef })
  const progress = useSpring(scrollYProgress, { stiffness: 180, damping: 30, mass: 0.4 })

  /*
   * La barra solo se pinta si de verdad hay algo que scrollear. Sin esto, en una
   * vista corta el progreso se queda en 1 y se ve una linea de color permanente
   * cruzando la barra superior, como si la pagina estuviera al final.
   */
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setCanScroll(el.scrollHeight > el.clientHeight + 4)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    // Los hijos cambian de alto al cargar datos, no solo el contenedor.
    for (const child of Array.from(el.children)) ro.observe(child)
    return () => ro.disconnect()
  }, [activeId, fullBleed, children])

  function toggleCollapse() {
    setCollapsed(v => {
      writeCollapsedPref(!v)
      return !v
    })
  }

  function toggleHidden() {
    setHidden(v => {
      writeHiddenPref(!v)
      return !v
    })
  }

  // Al cambiar de vista el scroll vuelve arriba; si no, la vista nueva aparece
  // a media altura y se lee como si faltara contenido.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'auto' })
  }, [activeId])

  /*
   * Ctrl/Cmd+B muestra u oculta el menu — el atajo habitual para esto. En movil
   * el equivalente es el drawer, asi que ahi alternamos ese en su lugar.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'b' && e.key !== 'B') return
      if (!e.ctrlKey && !e.metaKey) return
      // No robamos el atajo si el foco esta escribiendo en un campo.
      const el = document.activeElement
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement)?.isContentEditable) return
      e.preventDefault()
      if (window.matchMedia('(min-width: 1024px)').matches) toggleHidden()
      else setMobileOpen(v => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    // `relative` ancla el asa del borde, que se posiciona respecto al shell.
    <div className="relative h-full w-full flex bg-base overflow-hidden">
      <Sidebar
        items={items}
        activeId={activeId}
        onSelect={onSelect}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
        hidden={hidden}
        onToggleHidden={toggleHidden}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
        onLogout={onLogout}
        footer={sidebarFooter}
        badgeLabel={badgeLabel}
      />

      {/* Columna de contenido. `min-w-0` es lo que permite que las tablas
          anchas scrolleen dentro en vez de estirar el layout entero. */}
      <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden">
        {/* Barra superior */}
        <header className="relative flex-shrink-0 h-topbar flex items-center gap-3 px-3 sm:px-5 border-b border-border-soft glass z-20">
          <button
            onClick={() => setMobileOpen(true)}
            className="lg:hidden text-text-secondary hover:text-text-primary transition-colors p-2 -ml-1 rounded-lg hover:bg-surface-raised"
            aria-label={t('nav.openMenu')}
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Con el menu oculto, este boton es la via principal para traerlo. */}
          <AnimatePresence initial={false}>
            {hidden && (
              <motion.button
                initial={{ opacity: 0, width: 0, marginRight: 0 }}
                animate={{ opacity: 1, width: 'auto', marginRight: 0 }}
                exit={{ opacity: 0, width: 0 }}
                transition={SPRING.snappy}
                onClick={toggleHidden}
                className="hidden lg:flex flex-shrink-0 overflow-hidden items-center justify-center text-text-secondary hover:text-primary transition-colors p-2 -ml-1 rounded-lg hover:bg-primary/10"
                title={`${t('nav.showMenu')} (${SHORTCUT_HINT})`}
                aria-label={t('nav.showMenu')}
              >
                <PanelLeft className="w-5 h-5" />
              </motion.button>
            )}
          </AnimatePresence>

          <div className="min-w-0 flex-1">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={activeId}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.22, ease: EASE.out }}
                className="min-w-0"
              >
                {title && (
                  <h1 className="text-sm font-bold text-text-primary tracking-tight truncate leading-tight">
                    {title}
                  </h1>
                )}
                {subtitle && (
                  <p className="text-[11px] text-text-muted truncate leading-tight mt-px">{subtitle}</p>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {topbarActions && (
            <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">{topbarActions}</div>
          )}

          {/* Progreso de scroll pegado al borde inferior de la barra. */}
          {!fullBleed && canScroll && (
            <motion.div
              aria-hidden
              style={{ scaleX: progress }}
              className="absolute bottom-0 left-0 right-0 h-[2px] origin-left bg-gradient-to-r from-primary via-primary-light to-accent"
            />
          )}
        </header>

        {/*
         * Unico contenedor de scroll de la app. En `fullBleed` se apaga el
         * scroll para que mapas y paneles divididos reciban el alto exacto.
         */}
        <main
          ref={scrollRef}
          className={cn(
            'flex-1 min-h-0 relative',
            fullBleed ? 'overflow-hidden' : 'scroll-y',
          )}
        >
          {/* Textura de fondo — se queda quieta mientras el contenido scrollea. */}
          <div aria-hidden className="pointer-events-none fixed inset-0 grid-bg opacity-[0.35]" />

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={activeId}
              variants={pageTransition}
              initial="hidden"
              animate="visible"
              exit="exit"
              className={cn(
                'relative',
                fullBleed ? 'h-full' : 'px-4 sm:px-6 py-5 sm:py-6 max-w-[1600px] mx-auto w-full',
              )}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

    </div>
  )
}
