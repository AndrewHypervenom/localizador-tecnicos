import { supabase } from './supabase'

export async function getLeaderScope(): Promise<{
  userId: string
  companyIds: string[]
  /** Técnicos activos de las empresas del líder. Para marcadores del mapa. */
  technicianIds: string[]
  /** Todos los técnicos (activos e inactivos) de las empresas del líder.
   *  Para acotar rutas/zonas/alertas sin perder datos históricos de técnicos
   *  desactivados. */
  allTechnicianIds: string[]
}> {
  const { data: { session } } = await supabase.auth.getSession()
  const userId = session?.user?.id ?? ''

  const { data: companies } = await supabase
    .from('companies')
    .select('id')
    .eq('created_by', userId)
  const companyIds = (companies ?? []).map((c: any) => c.id)

  if (companyIds.length === 0) {
    return { userId, companyIds: [], technicianIds: [], allTechnicianIds: [] }
  }

  const { data: techs } = await supabase
    .from('technicians')
    .select('id, active')
    .in('company_id', companyIds)
  const allTechnicianIds = (techs ?? []).map((t: any) => t.id)
  const technicianIds = (techs ?? []).filter((t: any) => t.active).map((t: any) => t.id)

  return { userId, companyIds, technicianIds, allTechnicianIds }
}
