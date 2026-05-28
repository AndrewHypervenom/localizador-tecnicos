import { supabase } from './supabase'

export async function getLeaderScope(): Promise<{
  userId: string
  companyIds: string[]
  technicianIds: string[]
}> {
  const { data: { session } } = await supabase.auth.getSession()
  const userId = session?.user?.id ?? ''

  const { data: companies } = await supabase
    .from('companies')
    .select('id')
    .eq('created_by', userId)
  const companyIds = (companies ?? []).map((c: any) => c.id)

  if (companyIds.length === 0) {
    return { userId, companyIds: [], technicianIds: [] }
  }

  const { data: techs } = await supabase
    .from('technicians')
    .select('id')
    .in('company_id', companyIds)
    .eq('active', true)
  const technicianIds = (techs ?? []).map((t: any) => t.id)

  return { userId, companyIds, technicianIds }
}
