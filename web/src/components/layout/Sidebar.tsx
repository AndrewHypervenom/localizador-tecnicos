import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { EyeOff, LogOut, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { EASE, SPRING, slideInLeft } from '@/lib/motion'
import { useI18n } from '@/lib/i18n/i18n'

export interface NavItem {
  id: string
  label: string
  icon: React.ElementType
  /** Si viene, el item navega. Si no, se resuelve con `onSelect`. */
  to?: string
  /** Contador que se pinta como pastilla ambar (p. ej. tecnicos sin vincular). */
  badge?: number
  /** Agrupa items bajo un titulo dentro del sidebar. */
  section?: string
}

interface SidebarProps {
  items: NavItem[]
  activeId: string
  onSelect: (id: string) => void
  collapsed: boolean
  onToggleCollapse: () => void
  /** Oculto por completo (ancho 0). Se recupera desde la barra superior. */
  hidden: boolean
  onToggleHidden: () => void
  /** Estado del drawer en movil — lo controla el shell. */
  mobileOpen: boolean
  onMobileClose: () => void
  onLogout: () => void
  footer?: ReactNode
  badgeLabel?: string
}

const COLLAPSED_KEY = 'sidebar:collapsed'
const HIDDEN_KEY = 'sidebar:hidden'

/** Etiqueta del atajo segun plataforma — en Mac se espera ⌘, no Ctrl. */
export const SHORTCUT_HINT =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
    ? '⌘B'
    : 'Ctrl+B'

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function writeFlag(key: string, v: boolean) {
  try {
    localStorage.setItem(key, v ? '1' : '0')
  } catch { /* localStorage no disponible */ }
}

/** Preferencias persistidas (el shell las usa como estado inicial). */
export const readCollapsedPref = () => readFlag(COLLAPSED_KEY)
export const writeCollapsedPref = (v: boolean) => writeFlag(COLLAPSED_KEY, v)
export const readHiddenPref = () => readFlag(HIDDEN_KEY)
export const writeHiddenPref = (v: boolean) => writeFlag(HIDDEN_KEY, v)

/* ── Item de navegacion ──────────────────────────────────────────────────── */

function NavButton({
  item,
  active,
  collapsed,
  onClick,
}: {
  item: NavItem
  active: boolean
  collapsed: boolean
  onClick: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const Icon = item.icon

  const inner = (
    <>
      {/*
       * Fondo activo compartido por todos los items via `layoutId`: framer lo
       * interpola de la posicion anterior a la nueva, asi que el resaltado
       * "viaja" entre items en vez de aparecer y desaparecer.
       */}
      {/*
       * OJO: nada de utilidades de transform (`-translate-y-1/2`, `scale-*`) en
       * un elemento con `layoutId`. Framer anima escribiendo `transform`, asi
       * que pisa la clase de Tailwind y el elemento acaba descolocado. Aqui se
       * centra con `inset-0`, que no usa transform.
       *
       * La pildora es el unico indicador de item activo: ya lo dice con fondo,
       * borde, resplandor, texto en blanco e icono verde. La barra que habia a
       * la izquierda caia justo sobre el borde de la pildora, asi que sumaba
       * ruido en vez de informacion.
       */}
      {active && (
        <motion.div
          layoutId="sidebar-active"
          transition={SPRING.snappy}
          className="absolute inset-0 rounded-xl bg-gradient-to-r from-primary/[0.18] to-primary/[0.04] border border-primary/25 shadow-glow-primary"
        />
      )}

      <span className="relative flex items-center justify-center w-5 h-5 flex-shrink-0">
        <Icon
          className={cn(
            'w-[18px] h-[18px] transition-colors duration-200',
            active ? 'text-primary' : 'text-text-muted group-hover:text-text-primary',
          )}
        />
        {/* Con el sidebar colapsado el numero no cabe: se reduce a un punto. */}
        {collapsed && !!item.badge && item.badge > 0 && (
          <span className="absolute -top-1 -right-1.5 w-2 h-2 rounded-full bg-amber-500 ring-2 ring-surface" />
        )}
      </span>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.span
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -6 }}
            transition={{ duration: 0.16, ease: EASE.out }}
            className={cn(
              'relative text-[13px] font-medium whitespace-nowrap min-w-0 flex-1 text-left transition-colors duration-200',
              active ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary',
            )}
          >
            {item.label}
          </motion.span>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {!collapsed && !!item.badge && item.badge > 0 && (
          <motion.span
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ duration: 0.2, ease: EASE.outBack }}
            className="relative flex-shrink-0 bg-amber-500/90 text-base text-[10px] font-bold min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center leading-none"
          >
            {item.badge > 99 ? '99+' : item.badge}
          </motion.span>
        )}
      </AnimatePresence>
    </>
  )

  const className = cn(
    'group relative flex items-center gap-3 rounded-xl outline-none',
    'transition-colors duration-200',
    collapsed ? 'px-3 py-2.5 justify-center' : 'px-3 py-2.5',
    !active && 'hover:bg-surface-raised/70',
  )

  return (
    <div
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {item.to ? (
        <Link to={item.to} className={className} onClick={onClick} aria-current={active ? 'page' : undefined}>
          {inner}
        </Link>
      ) : (
        <button type="button" onClick={onClick} className={cn(className, 'w-full')} aria-current={active ? 'page' : undefined}>
          {inner}
        </button>
      )}

      {/*
       * Tooltip: unica forma de saber que es cada icono cuando esta colapsado.
       *
       * El centrado vertical va en `y: '-50%'` y NO en `-translate-y-1/2`:
       * framer anima `x`/`scale` escribiendo `transform`, asi que pisaria la
       * clase de Tailwind y el tooltip saldria medio alto por debajo.
       */}
      <AnimatePresence>
        {collapsed && hovered && (
          <motion.div
            initial={{ opacity: 0, x: -6, y: '-50%', scale: 0.96 }}
            animate={{ opacity: 1, x: 0, y: '-50%', scale: 1 }}
            exit={{ opacity: 0, x: -6, y: '-50%', scale: 0.96 }}
            transition={{ duration: 0.15, ease: EASE.out }}
            className="pointer-events-none absolute left-full top-1/2 ml-3 z-50 glass-strong border border-border-soft rounded-lg px-2.5 py-1.5 shadow-elev-3 whitespace-nowrap"
          >
            <span className="text-xs font-medium text-text-primary">{item.label}</span>
            {!!item.badge && item.badge > 0 && (
              <span className="ml-1.5 text-[10px] font-bold text-amber-400">({item.badge})</span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ── Contenido del sidebar (compartido por escritorio y drawer movil) ─────── */

function SidebarBody({
  items,
  activeId,
  onSelect,
  collapsed,
  onLogout,
  footer,
  badgeLabel,
  onToggleCollapse,
  onToggleHidden,
  isMobile,
  onMobileClose,
}: Omit<SidebarProps, 'mobileOpen'> & { isMobile: boolean }) {
  const { t } = useI18n()

  // Agrupa por `section` conservando el orden de aparicion.
  const groups: { section?: string; items: NavItem[] }[] = []
  for (const item of items) {
    const last = groups[groups.length - 1]
    if (last && last.section === item.section) last.items.push(item)
    else groups.push({ section: item.section, items: [item] })
  }

  return (
    <div className="relative flex flex-col h-full bg-surface/95 border-r border-border-soft overflow-hidden">
      {/* Aurora de marca detras del sidebar — movimiento lento, casi subliminal. */}
      <div aria-hidden className="pointer-events-none absolute -top-24 -left-16 w-64 h-64 rounded-full bg-primary/10 blur-3xl animate-aurora" />
      <div aria-hidden className="pointer-events-none absolute bottom-0 -right-20 w-56 h-56 rounded-full bg-accent/10 blur-3xl animate-aurora [animation-delay:-8s]" />

      {/*
       * Cabecera. Colapsado, el logo ES el boton para abrir: al pasar el cursor
       * cambia a una flecha, asi que el sitio donde ya se hace clic por instinto
       * es el que abre el menu. Expandido, el control pasa a un boton propio a la
       * derecha, siempre visible (no aparece solo al hacer hover) para que se
       * pueda cerrar sin tener que descubrirlo.
       */}
      <div className={cn('relative flex items-center gap-2.5 px-4 h-topbar flex-shrink-0 border-b border-border-soft', collapsed && !isMobile && 'px-0 justify-center')}>
        {collapsed && !isMobile ? (
          <motion.button
            onClick={onToggleCollapse}
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.94 }}
            transition={SPRING.bouncy}
            title={`${t('nav.expand')} (${SHORTCUT_HINT})`}
            aria-label={t('nav.expand')}
            aria-expanded={false}
            className="group/logo relative w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
          >
            <span className="absolute inset-0.5 rounded-lg overflow-hidden ring-1 ring-primary/25 shadow-glow-primary transition-opacity duration-200 group-hover/logo:opacity-0">
              <img src="/favicon.png" alt="PositivoS+" className="w-full h-full object-cover" />
            </span>
            <span className="absolute inset-0.5 rounded-lg flex items-center justify-center bg-primary/15 border border-primary/40 opacity-0 transition-opacity duration-200 group-hover/logo:opacity-100">
              <PanelLeftOpen className="w-4 h-4 text-primary" />
            </span>
          </motion.button>
        ) : (
          <>
            <div className="w-8 h-8 rounded-lg overflow-hidden flex-shrink-0 ring-1 ring-primary/25 shadow-glow-primary">
              <img src="/favicon.png" alt="PositivoS+" className="w-full h-full object-cover" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold text-text-primary leading-tight truncate">Localizador</p>
              <p className="text-[11px] text-gradient-primary font-semibold leading-tight">PositivoS+</p>
            </div>

            {isMobile ? (
              <button
                onClick={onMobileClose}
                className="flex-shrink-0 text-text-muted hover:text-text-primary transition-colors p-1.5 rounded-lg hover:bg-surface-raised"
                aria-label={t('nav.closeMenu')}
              >
                <X className="w-4 h-4" />
              </button>
            ) : (
              <motion.button
                onClick={onToggleCollapse}
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.92 }}
                transition={SPRING.snappy}
                className="flex-shrink-0 p-1.5 rounded-lg text-text-muted hover:text-primary hover:bg-primary/10 transition-colors duration-200"
                title={`${t('nav.collapse')} (${SHORTCUT_HINT})`}
                aria-label={t('nav.collapse')}
                aria-expanded
              >
                <PanelLeftClose className="w-4 h-4" />
              </motion.button>
            )}
          </>
        )}
      </div>

      {/* Insignia de rol */}
      <AnimatePresence initial={false}>
        {(!collapsed || isMobile) && badgeLabel && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: EASE.out }}
            className="relative px-4 pt-3 overflow-hidden flex-shrink-0"
          >
            <div className="flex items-center gap-1.5 bg-primary/10 border border-primary/20 text-primary text-[11px] px-2.5 py-1.5 rounded-lg font-semibold">
              <span className="relative flex w-1.5 h-1.5 flex-shrink-0">
                <span className="absolute inset-0 rounded-full bg-primary animate-ping opacity-75" />
                <span className="relative w-1.5 h-1.5 rounded-full bg-primary" />
              </span>
              <span className="truncate">{badgeLabel}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Navegacion — scrollea sola si hay muchos items */}
      <nav className="relative flex-1 scroll-y scrollbar-none px-2.5 py-3 space-y-1">
        {groups.map((group, gi) => (
          <div key={group.section ?? gi} className={cn(gi > 0 && 'pt-3')}>
            <AnimatePresence initial={false}>
              {group.section && (!collapsed || isMobile) && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-text-muted/70"
                >
                  {group.section}
                </motion.p>
              )}
            </AnimatePresence>
            {group.section && collapsed && !isMobile && gi > 0 && (
              <div className="mx-3 mb-2 h-px bg-border-soft" />
            )}
            <div className="space-y-1">
              {group.items.map(item => (
                <NavButton
                  key={item.id}
                  item={item}
                  active={activeId === item.id}
                  collapsed={collapsed && !isMobile}
                  onClick={() => {
                    onSelect(item.id)
                    if (isMobile) onMobileClose()
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Pie: acciones extra + cerrar sesion */}
      <div className="relative flex-shrink-0 border-t border-border-soft p-2.5 space-y-1">
        {footer}
        <button
          onClick={onLogout}
          className={cn(
            'group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium',
            'text-text-muted hover:text-danger hover:bg-danger/10 transition-colors duration-200',
            collapsed && !isMobile && 'justify-center',
          )}
        >
          <LogOut className="w-[18px] h-[18px] flex-shrink-0 transition-transform duration-200 group-hover:-translate-x-0.5" />
          <AnimatePresence initial={false}>
            {(!collapsed || isMobile) && (
              <motion.span
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -6 }}
                transition={{ duration: 0.16, ease: EASE.out }}
                className="whitespace-nowrap"
              >
                {t('common.logout')}
              </motion.span>
            )}
          </AnimatePresence>
        </button>

        {/*
         * Ocultar del todo. Es la unica accion del pie porque colapsar ya vive
         * en el asa del borde y en la cabecera: antes habia dos botones
         * parecidos aca y no se distinguia cual hacia que.
         */}
        {!isMobile && (
          <button
            onClick={onToggleHidden}
            className={cn(
              'group/hide w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[12px] font-medium',
              'text-text-muted/70 hover:text-text-secondary hover:bg-surface-raised/70 transition-colors duration-200',
              collapsed && 'justify-center',
            )}
            title={`${t('nav.hide')} (${SHORTCUT_HINT})`}
            aria-label={t('nav.hide')}
          >
            <EyeOff className="w-4 h-4 flex-shrink-0" />
            <AnimatePresence initial={false}>
              {!collapsed && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="whitespace-nowrap flex-1 text-left"
                >
                  {t('nav.hide')}
                </motion.span>
              )}
            </AnimatePresence>
            {/* Pista del atajo — se aprende sin tener que buscarlo. */}
            {!collapsed && (
              <kbd className="flex-shrink-0 text-[10px] font-mono text-text-muted/50 border border-border-soft rounded px-1.5 py-0.5 group-hover/hide:border-border group-hover/hide:text-text-muted transition-colors">
                {SHORTCUT_HINT}
              </kbd>
            )}
          </button>
        )}
      </div>
    </div>
  )
}

/* ── Sidebar ─────────────────────────────────────────────────────────────── */

export function Sidebar(props: SidebarProps) {
  const { collapsed, hidden, mobileOpen, onMobileClose } = props

  // Cierra el drawer con Escape.
  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onMobileClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobileOpen, onMobileClose])

  return (
    <>
      {/*
       * Escritorio: columna fija que anima su ancho.
       * Tres anchos posibles: oculto (0), rail de iconos y expandido. El cambio
       * siempre viene de un clic o del atajo — nunca de pasar el cursor.
       */}
      <motion.aside
        initial={false}
        animate={{ width: hidden ? 0 : collapsed ? '4.5rem' : '17rem' }}
        transition={SPRING.layout}
        className="hidden lg:block relative flex-shrink-0 h-full z-30 overflow-hidden"
        // Oculto tambien para lectores de pantalla y para el cursor.
        aria-hidden={hidden}
        style={{ pointerEvents: hidden ? 'none' : undefined }}
      >
        <SidebarBody {...props} isMobile={false} />
      </motion.aside>

      {/* Movil/tablet: drawer sobre el contenido. */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={onMobileClose}
              className="lg:hidden fixed inset-0 z-[900] bg-base/70 backdrop-blur-sm"
            />
            <motion.aside
              variants={slideInLeft}
              initial="hidden"
              animate="visible"
              exit="exit"
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={{ left: 0.4, right: 0 }}
              onDragEnd={(_, info) => { if (info.offset.x < -60) onMobileClose() }}
              className="lg:hidden fixed inset-y-0 left-0 z-[901] w-[17rem] max-w-[82vw] shadow-elev-4"
            >
              {/* En el drawer nunca va colapsado: no hay espacio que ganar. */}
              <SidebarBody {...props} collapsed={false} isMobile />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
