import { supabase } from './supabase'
import { getViewAs } from './viewAs'
import type { Session } from '@supabase/supabase-js'

export type UserRole = 'superadmin' | 'leader' | 'user'

export function getRoleFromSession(session: Session | null): UserRole | null {
  if (!session) return null
  return (session.user.app_metadata?.role as UserRole) ?? 'user'
}

export async function getUserRole(): Promise<UserRole | null> {
  const { data: { session } } = await supabase.auth.getSession()
  return getRoleFromSession(session)
}

/**
 * Rol con el que debe comportarse la interfaz.
 *
 * Igual al real, salvo cuando un superadmin activó "ver como empresa": ahí
 * vale `leader`, y así todos los `role !== 'superadmin'` acotan los datos a esa
 * empresa en vez de mostrar la plataforma entera. Usa este en las vistas;
 * `getRoleFromSession` solo donde importe el permiso de verdad (rutas, escritura
 * contra el backend).
 */
export function getEffectiveRoleFromSession(session: Session | null): UserRole | null {
  const role = getRoleFromSession(session)
  if (role === 'superadmin' && getViewAs()) return 'leader'
  return role
}

export async function getEffectiveRole(): Promise<UserRole | null> {
  const { data: { session } } = await supabase.auth.getSession()
  return getEffectiveRoleFromSession(session)
}
