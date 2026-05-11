import { Request, Response, NextFunction } from 'express'
import { supabase } from '../config/supabase'

declare global {
  namespace Express {
    interface Request {
      authUser?: { id: string; email: string; role: string }
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
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
  req.authUser = {
    id: user.id,
    email: user.email ?? '',
    role: (user.app_metadata?.role as string) ?? 'user',
  }
  next()
}
