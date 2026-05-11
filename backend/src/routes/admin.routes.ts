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
  const assignedRole = role === 'superadmin' ? 'superadmin' : 'user'
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
  if (!['superadmin', 'user'].includes(role)) {
    res.status(400).json({ error: 'Rol inválido. Use "superadmin" o "user"' })
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
        FROM trips
        WHERE status = 'completed'
          AND started_at > NOW() - INTERVAL '1 day'
      `),
      query<{ total: number }>(`
        SELECT count(*)::int AS total
        FROM motion_events
        WHERE acknowledged = false
          AND ts > NOW() - INTERVAL '1 day'
      `),
    ])

    res.json({
      totalUsers: usersResult.data?.users?.length ?? 0,
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
