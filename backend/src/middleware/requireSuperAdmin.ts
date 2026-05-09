import { Request, Response, NextFunction } from 'express'
import { supabase } from '../config/supabase'

declare global {
  namespace Express {
    interface Request {
      adminUser?: { id: string; email: string }
    }
  }
}

export async function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) {
    res.status(401).json({ error: 'No autorizado' })
    return
  }

  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) {
    res.status(401).json({ error: 'Token inválido' })
    return
  }
  if (user.app_metadata?.role !== 'superadmin') {
    res.status(403).json({ error: 'Acceso denegado: se requiere rol superadmin' })
    return
  }

  req.adminUser = { id: user.id, email: user.email ?? '' }
  next()
}
