import { query } from '../config/db'

/**
 * Retorna los company_ids que pertenecen al usuario.
 * Si es superadmin retorna null (sin restricción).
 */
export async function getUserCompanyIds(
  userId: string,
  role: string,
): Promise<string[] | null> {
  if (role === 'superadmin') return null
  const rows = await query<{ id: string }>(
    `SELECT id FROM companies WHERE created_by = $1`,
    [userId],
  )
  return rows.map(r => r.id)
}

/** Retorna el company_id de un técnico, o null si no existe. */
export async function getTechnicianCompanyId(
  technicianId: string,
): Promise<string | null> {
  const rows = await query<{ company_id: string }>(
    `SELECT company_id FROM technicians WHERE id = $1`,
    [technicianId],
  )
  return rows[0]?.company_id ?? null
}

/** Retorna el technician_id de un viaje, o null si no existe. */
export async function getTripTechnicianId(
  tripId: string,
): Promise<string | null> {
  const rows = await query<{ technician_id: string }>(
    `SELECT technician_id FROM trips WHERE id = $1`,
    [tripId],
  )
  return rows[0]?.technician_id ?? null
}

/**
 * Verifica que el técnico pertenezca al scope del usuario.
 * companyIds = null significa superadmin (siempre permitido).
 * Lanza un error con status 403 si está fuera de scope.
 */
export function assertTechnicianInScope(
  techCompanyId: string | null,
  companyIds: string[] | null,
): void {
  if (companyIds === null) return
  if (!techCompanyId || !companyIds.includes(techCompanyId)) {
    const err = new Error('Acceso denegado: técnico fuera de scope') as any
    err.status = 403
    throw err
  }
}
