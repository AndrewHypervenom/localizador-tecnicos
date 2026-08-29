import { supabase } from './supabase'
import { getRoleFromSession } from './roles'
import { getViewAs } from './viewAs'

export interface LeaderScope {
  userId: string
  companyIds: string[]
  /** Técnicos activos de las empresas del líder. Para marcadores del mapa. */
  technicianIds: string[]
  /** Todos los técnicos (activos e inactivos) de las empresas del líder.
   *  Para acotar rutas/zonas/alertas sin perder datos históricos de técnicos
   *  desactivados. */
  allTechnicianIds: string[]
  /**
   * false → alguna consulta falló y las listas vienen vacías POR EL FALLO, no
   * porque el líder no tenga técnicos.
   *
   * La distinción no es teórica: el error se descartaba (`const { data } = await
   * …`, sin mirar `error`) y `data` llegaba null, así que un corte de red se
   * volvía indistinguible de "este líder no tiene ninguna empresa". El mapa
   * tomaba ese scope vacío, se lo pasaba a `useRealtimeTechnicians`, y ese hook
   * llama a `replaceTechnicians([])`: la flota entera desaparecía de la pantalla
   * del líder sin un solo aviso. Se observó en vivo con un `net::ERR_ABORTED`
   * sobre /companies.
   *
   * No se lanza la excepción porque hay ~25 sitios de llamada y varios usan
   * `.then()` pelado; convertirlo en throw cambiaría una lista vacía por un
   * rechazo sin capturar. Quien PINTE la flota debe mirar este campo y conservar
   * lo que ya tenía; a los demás no les cambia nada.
   */
  ok: boolean
}

export async function getLeaderScope(): Promise<LeaderScope> {
  const { data: { session } } = await supabase.auth.getSession()
  const userId = session?.user?.id ?? ''

  /*
   * Punto único por el que pasa todo el panel de líder, así que también es el
   * único sitio donde hay que redirigir el alcance cuando el superadmin está
   * "viendo como" una empresa: los doce componentes heredan el cambio.
   */
  const viewAs = getRoleFromSession(session) === 'superadmin' ? getViewAs() : null

  let companyIds: string[]
  if (viewAs) {
    companyIds = [viewAs.id]
  } else {
    const { data: companies, error } = await supabase
      .from('companies')
      .select('id')
      .eq('created_by', userId)
    if (error) {
      console.error('[LeaderScope] No se pudieron cargar las empresas:', error)
      return { userId, companyIds: [], technicianIds: [], allTechnicianIds: [], ok: false }
    }
    companyIds = (companies ?? []).map((c: any) => c.id)
  }

  if (companyIds.length === 0) {
    return { userId, companyIds: [], technicianIds: [], allTechnicianIds: [], ok: true }
  }

  const { data: techs, error: techErr } = await supabase
    .from('technicians')
    .select('id, active')
    .in('company_id', companyIds)
  if (techErr) {
    console.error('[LeaderScope] No se pudieron cargar los técnicos:', techErr)
    return { userId, companyIds, technicianIds: [], allTechnicianIds: [], ok: false }
  }
  const allTechnicianIds = (techs ?? []).map((t: any) => t.id)
  const technicianIds = (techs ?? []).filter((t: any) => t.active).map((t: any) => t.id)

  return { userId, companyIds, technicianIds, allTechnicianIds, ok: true }
}
