import { supabase } from './supabase'
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
