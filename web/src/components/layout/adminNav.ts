import {
  Activity, BarChart2, Building2, FolderOpen, History, Map, Users, Wrench,
} from 'lucide-react'
import type { TFunc } from '@/lib/i18n/i18n'
import type { NavItem } from './Sidebar'

/** Vistas del panel de administracion que viven como pestanas en /admin. */
export type AdminTab = 'stats' | 'users' | 'technicians' | 'companies' | 'activity' | 'projects' | 'history'

/** `map` no es una pestana: es su propia ruta, pero comparte el sidebar. */
export type AdminNavId = AdminTab | 'map'

export const ADMIN_TABS: readonly AdminTab[] = [
  'stats', 'users', 'technicians', 'companies', 'activity', 'projects', 'history',
]

export function isAdminTab(v: string | null | undefined): v is AdminTab {
  return !!v && (ADMIN_TABS as readonly string[]).includes(v)
}

const DEFS: { id: AdminNavId; icon: React.ElementType; sectionKey: string; to?: string }[] = [
  { id: 'stats',       icon: BarChart2,  sectionKey: 'admin.section.overview' },
  { id: 'map',         icon: Map,        sectionKey: 'admin.section.overview', to: '/admin/map' },
  { id: 'users',       icon: Users,      sectionKey: 'admin.section.manage' },
  { id: 'technicians', icon: Wrench,     sectionKey: 'admin.section.manage' },
  { id: 'companies',   icon: Building2,  sectionKey: 'admin.section.manage' },
  { id: 'projects',    icon: FolderOpen, sectionKey: 'admin.section.ops' },
  { id: 'history',     icon: History,    sectionKey: 'admin.section.ops' },
  { id: 'activity',    icon: Activity,   sectionKey: 'admin.section.ops' },
]

/** Titulo de cada vista, para la barra superior. */
export const ADMIN_TITLE_KEY: Record<AdminNavId, string> = {
  stats:       'admin.tab.stats',
  map:         'admin.tab.map',
  users:       'admin.tab.users',
  technicians: 'admin.tab.technicians',
  companies:   'admin.tab.companies',
  activity:    'admin.tab.activity',
  projects:    'admin.tab.projects',
  history:     'admin.tab.history',
}

/** Subtitulo descriptivo por vista. */
export const ADMIN_SUBTITLE_KEY: Record<AdminNavId, string> = {
  stats:       'admin.sub.stats',
  map:         'admin.sub.map',
  users:       'admin.sub.users',
  technicians: 'admin.sub.technicians',
  companies:   'admin.sub.companies',
  activity:    'admin.sub.activity',
  projects:    'admin.sub.projects',
  history:     'admin.sub.history',
}

/**
 * Construye los items del sidebar.
 *
 * `fromMapRoute` hace que las pestanas naveguen a `/admin?tab=x` en vez de solo
 * cambiar estado, para poder saltar del mapa a cualquier vista en un clic.
 */
export function buildAdminNav(
  t: TFunc,
  opts: { unlinkedCount?: number; fromMapRoute?: boolean } = {},
): NavItem[] {
  const { unlinkedCount = 0, fromMapRoute = false } = opts
  return DEFS.map(def => ({
    id: def.id,
    label: t(ADMIN_TITLE_KEY[def.id]),
    icon: def.icon,
    section: t(def.sectionKey),
    badge: def.id === 'technicians' ? unlinkedCount : undefined,
    to: def.to ?? (fromMapRoute ? `/admin?tab=${def.id}` : undefined),
  }))
}
