import { Router, Request, Response } from 'express'
import { randomBytes } from 'crypto'
import { supabase } from '../config/supabase'
import { query } from '../config/db'
import { requireSuperAdmin } from '../middleware/requireSuperAdmin'

function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$'
  const bytes = randomBytes(12)
  return Array.from(bytes, b => chars[b % chars.length]).join('')
}

const router = Router()
router.use(requireSuperAdmin)

async function logActivity(
  actorId: string,
  actorEmail: string,
  action: string,
  targetType?: string,
  targetId?: string,
  details?: Record<string, unknown>,
) {
  const { error } = await supabase.from('activity_logs').insert({
    user_id: actorId,
    user_email: actorEmail,
    action,
    target_type: targetType,
    target_id: targetId,
    details,
  })
  if (error) console.error('[logActivity]', error.message)
}

// GET /api/admin/users
router.get('/users', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 })
    if (error) throw error
    res.json(data.users.map(u => ({
      id: u.id,
      email: u.email,
      role: (u.app_metadata?.role as string) ?? 'user',
      createdAt: u.created_at,
      lastSignIn: u.last_sign_in_at,
      mustChangePassword: u.user_metadata?.must_change_password === true,
    })))
  } catch (err) {
    console.error('[admin/users GET]', err)
    res.status(500).json({ error: 'Error al obtener usuarios' })
  }
})

// POST /api/admin/users
router.post('/users', async (req: Request, res: Response) => {
  const { email, role } = req.body as { email: string; role: string }
  if (!email) {
    res.status(400).json({ error: 'El email es requerido' })
    return
  }
  const assignedRole = ['superadmin', 'leader'].includes(role) ? role : 'user'
  const tempPassword = generateTempPassword()

  try {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: tempPassword,
      app_metadata: { role: assignedRole },
      user_metadata: { must_change_password: true },
      email_confirm: true,
    })
    if (error) throw error

    logActivity(req.adminUser!.id, req.adminUser!.email, 'create_user', 'user', data.user.id, {
      newEmail: email,
      newRole: assignedRole,
    })

    res.status(201).json({ id: data.user.id, email: data.user.email, role: assignedRole, tempPassword })
  } catch (err: any) {
    console.error('[admin/users POST]', err)
    res.status(500).json({ error: err.message ?? 'Error al crear usuario' })
  }
})

// POST /api/admin/users/:id/reset-password
router.post('/users/:id/reset-password', async (req: Request, res: Response) => {
  const { id } = req.params
  const tempPassword = generateTempPassword()

  try {
    const { data, error } = await supabase.auth.admin.updateUserById(id, {
      password: tempPassword,
      user_metadata: { must_change_password: true },
    })
    if (error) throw error

    logActivity(req.adminUser!.id, req.adminUser!.email, 'reset_password', 'user', id, {
      targetEmail: data.user.email,
    })

    res.json({ email: data.user.email, tempPassword })
  } catch (err: any) {
    console.error('[admin/users reset-password]', err)
    res.status(500).json({ error: err.message ?? 'Error al resetear contraseña' })
  }
})

// PATCH /api/admin/users/:id/role
router.patch('/users/:id/role', async (req: Request, res: Response) => {
  const { id } = req.params
  const { role } = req.body as { role: string }
  if (!['superadmin', 'leader', 'user'].includes(role)) {
    res.status(400).json({ error: 'Rol inválido' })
    return
  }

  try {
    const { data, error } = await supabase.auth.admin.updateUserById(id, {
      app_metadata: { role },
    })
    if (error) throw error

    logActivity(req.adminUser!.id, req.adminUser!.email, 'change_role', 'user', id, {
      targetEmail: data.user.email,
      newRole: role,
    })

    res.json({ id, role })
  } catch (err: any) {
    console.error('[admin/users PATCH]', err)
    res.status(500).json({ error: err.message ?? 'Error al cambiar rol' })
  }
})

// DELETE /api/admin/users/:id
router.delete('/users/:id', async (req: Request, res: Response) => {
  const { id } = req.params
  if (id === req.adminUser!.id) {
    res.status(400).json({ error: 'No puedes eliminar tu propio usuario' })
    return
  }

  try {
    const { data: userData } = await supabase.auth.admin.getUserById(id)
    const targetEmail = userData.user?.email ?? ''

    const { error } = await supabase.auth.admin.deleteUser(id)
    if (error) throw error

    logActivity(req.adminUser!.id, req.adminUser!.email, 'delete_user', 'user', id, {
      deletedEmail: targetEmail,
    })

    res.json({ success: true })
  } catch (err: any) {
    console.error('[admin/users DELETE]', err)
    res.status(500).json({ error: err.message ?? 'Error al eliminar usuario' })
  }
})

// GET /api/admin/stats
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const [usersResult, techsResult, tripsResult, alertsResult] = await Promise.all([
      supabase.auth.admin.listUsers({ perPage: 1000 }),
      query<{ total: number; active: number }>(`
        SELECT
          count(*)::int AS total,
          count(*) FILTER (
            WHERE cs.status IS NOT NULL AND cs.status != 'offline'
          )::int AS active
        FROM technicians t
        LEFT JOIN technician_current_status cs ON cs.id = t.id
        WHERE t.active = true
      `),
      query<{ total: number }>(`
        SELECT count(*)::int AS total
        FROM trips tr
        JOIN technicians t ON t.id = tr.technician_id
        WHERE tr.status = 'completed'
          AND (tr.ended_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date
            = (NOW() AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date
      `),
      query<{ total: number }>(`
        SELECT count(*)::int AS total
        FROM motion_events
        WHERE acknowledged = false
          AND ts > NOW() - INTERVAL '1 day'
      `),
    ])

    res.json({
      totalUsers: usersResult.data?.users?.filter(u => u.email).length ?? 0,
      totalTechnicians: techsResult[0]?.total ?? 0,
      activeTechnicians: techsResult[0]?.active ?? 0,
      tripsToday: tripsResult[0]?.total ?? 0,
      unacknowledgedAlerts: alertsResult[0]?.total ?? 0,
    })
  } catch (err) {
    console.error('[admin/stats]', err)
    res.status(500).json({ error: 'Error al obtener estadísticas' })
  }
})

// GET /api/admin/companies — all companies with leader info and stats
router.get('/companies', async (_req: Request, res: Response) => {
  try {
    const { data: companies, error } = await supabase
      .from('companies')
      .select('id, name, created_by, created_at, work_start_hour, work_end_hour, work_skip_weekends, work_tz')
      .order('created_at', { ascending: false })
    if (error) throw error

    const { data: campaigns } = await supabase
      .from('campaigns')
      .select('id, name, company_id, is_active')
    const { data: technicians } = await supabase
      .from('technicians')
      .select('id, company_id')

    const { data: authUsers } = await supabase.auth.admin.listUsers({ perPage: 1000 })
    const userMap = new Map(authUsers?.users?.map(u => [u.id, u.email]) ?? [])

    const result = (companies ?? []).map(co => ({
      id: co.id,
      name: co.name,
      createdAt: co.created_at,
      leaderId: co.created_by,
      leaderEmail: userMap.get(co.created_by ?? '') ?? null,
      workStartHour: (co as any).work_start_hour ?? 8,
      workEndHour: (co as any).work_end_hour ?? 17,
      workSkipWeekends: (co as any).work_skip_weekends ?? true,
      workTz: (co as any).work_tz ?? 'America/Bogota',
      campaignCount: (campaigns ?? []).filter(c => c.company_id === co.id).length,
      activeCampaignCount: (campaigns ?? []).filter(c => c.company_id === co.id && c.is_active).length,
      technicianCount: (technicians ?? []).filter(t => t.company_id === co.id).length,
      campaigns: (campaigns ?? []).filter(c => c.company_id === co.id).map(c => ({ id: c.id, name: c.name, is_active: c.is_active })),
    }))

    res.json(result)
  } catch (err) {
    console.error('[admin/companies GET]', err)
    res.status(500).json({ error: 'Error al obtener empresas' })
  }
})

// POST /api/admin/companies — create company assigned to a specific leader
router.post('/companies', async (req: Request, res: Response) => {
  const { name, leaderId, workStartHour, workEndHour, workSkipWeekends, workTz } = req.body as {
    name: string; leaderId: string
    workStartHour?: number; workEndHour?: number; workSkipWeekends?: boolean; workTz?: string
  }
  if (!name?.trim()) { res.status(400).json({ error: 'El nombre es requerido' }); return }
  if (!leaderId)       { res.status(400).json({ error: 'El líder es requerido' }); return }

  try {
    const { data, error } = await supabase
      .from('companies')
      .insert({
        name: name.trim(),
        created_by: leaderId,
        work_start_hour: workStartHour ?? 8,
        work_end_hour: workEndHour ?? 17,
        work_skip_weekends: workSkipWeekends ?? true,
        work_tz: workTz ?? 'America/Bogota',
      })
      .select('id, name, created_by, created_at')
      .single()
    if (error) throw error

    logActivity(req.adminUser!.id, req.adminUser!.email, 'create_company', 'company', data.id, { name: data.name, leaderId })

    res.status(201).json(data)
  } catch (err: any) {
    console.error('[admin/companies POST]', err)
    res.status(500).json({ error: err.message ?? 'Error al crear empresa' })
  }
})

// PATCH /api/admin/companies/:id — rename or reassign
router.patch('/companies/:id', async (req: Request, res: Response) => {
  const { id } = req.params
  const { name, leaderId, workStartHour, workEndHour, workSkipWeekends, workTz } = req.body as {
    name?: string; leaderId?: string
    workStartHour?: number; workEndHour?: number; workSkipWeekends?: boolean; workTz?: string
  }

  const updates: Record<string, unknown> = {}
  if (name?.trim()) updates.name = name.trim()
  if (leaderId)     updates.created_by = leaderId
  if (workStartHour    !== undefined) updates.work_start_hour    = workStartHour
  if (workEndHour      !== undefined) updates.work_end_hour      = workEndHour
  if (workSkipWeekends !== undefined) updates.work_skip_weekends = workSkipWeekends
  if (workTz           !== undefined) updates.work_tz            = workTz
  if (!Object.keys(updates).length) { res.status(400).json({ error: 'Nada que actualizar' }); return }

  try {
    const { data, error } = await supabase
      .from('companies')
      .update(updates)
      .eq('id', id)
      .select('id, name, created_by')
      .single()
    if (error) throw error

    logActivity(req.adminUser!.id, req.adminUser!.email, 'update_company', 'company', id, updates)
    res.json(data)
  } catch (err: any) {
    console.error('[admin/companies PATCH]', err)
    res.status(500).json({ error: err.message ?? 'Error al actualizar empresa' })
  }
})

// DELETE /api/admin/companies/:id
router.delete('/companies/:id', async (req: Request, res: Response) => {
  const { id } = req.params
  try {
    const { data: co } = await supabase.from('companies').select('name').eq('id', id).single()
    const { error } = await supabase.from('companies').delete().eq('id', id)
    if (error) throw error

    logActivity(req.adminUser!.id, req.adminUser!.email, 'delete_company', 'company', id, { name: co?.name })
    res.json({ success: true })
  } catch (err: any) {
    console.error('[admin/companies DELETE]', err)
    res.status(500).json({ error: err.message ?? 'Error al eliminar empresa' })
  }
})

// GET /api/admin/leaders — users with role=leader (for assign dropdown)
router.get('/leaders', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 })
    if (error) throw error
    const leaders = data.users
      .filter(u => u.app_metadata?.role === 'leader' || u.app_metadata?.role === 'superadmin')
      .map(u => ({ id: u.id, email: u.email, role: u.app_metadata?.role }))
    res.json(leaders)
  } catch (err) {
    console.error('[admin/leaders GET]', err)
    res.status(500).json({ error: 'Error al obtener líderes' })
  }
})

// GET /api/admin/logs
router.get('/logs', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('activity_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200)

    if (error) throw error
    res.json(data)
  } catch (err) {
    console.error('[admin/logs GET]', err)
    res.status(500).json({ error: 'Error al obtener registros de actividad' })
  }
})

export default router
