import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { supabase } from '@/lib/supabase'
import { getRoleFromSession } from '@/lib/roles'
import { Eye, EyeOff, Loader2, KeyRound } from 'lucide-react'
import { cn } from '@/lib/utils'

export function ChangePassword() {
  const navigate = useNavigate()
  const [password, setPassword]   = useState('')
  const [confirm, setConfirm]     = useState('')
  const [showPwd, setShowPwd]     = useState(false)
  const [showConf, setShowConf]   = useState(false)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [userEmail, setUserEmail] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { navigate('/login', { replace: true }); return }
      setUserEmail(session.user.email ?? null)
    })
  }, [navigate])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      setError('Las contraseñas no coinciden')
      return
    }
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres')
      return
    }
    setError(null)
    setLoading(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password,
        data: { must_change_password: false },
      })
      if (updateError) throw updateError

      const { data: { session } } = await supabase.auth.getSession()
      const role = getRoleFromSession(session)
      navigate(role === 'superadmin' ? '/admin' : '/', { replace: true })
    } catch (err: any) {
      setError(err.message ?? 'Error al cambiar la contraseña')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-base flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-success/5 rounded-full blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="relative w-full max-w-sm"
      >
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl overflow-hidden mx-auto mb-4 shadow-lg shadow-primary/30">
            <img src="/favicon.png" alt="PositivoS+" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-2xl font-bold text-text-primary">Crear contraseña</h1>
          <p className="text-text-muted text-sm mt-1">
            {userEmail ? `Bienvenido, ${userEmail}` : 'Primer inicio de sesión'}
          </p>
        </div>

        <div className="bg-surface border border-border-soft rounded-2xl p-6 shadow-2xl">
          <div className="flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-xl px-3 py-2.5 mb-5">
            <KeyRound className="w-4 h-4 text-primary shrink-0" />
            <p className="text-xs text-primary">
              Por seguridad, debes crear tu propia contraseña antes de continuar.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                Nueva contraseña
              </label>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  autoFocus
                  minLength={8}
                  placeholder="Mínimo 8 caracteres"
                  className={cn(
                    'w-full bg-surface-raised border border-border rounded-xl px-3.5 py-2.5 pr-10',
                    'text-text-primary text-sm placeholder-text-muted',
                    'focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30',
                    'transition-colors'
                  )}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(!showPwd)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
                >
                  {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                Confirmar contraseña
              </label>
              <div className="relative">
                <input
                  type={showConf ? 'text' : 'password'}
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  required
                  minLength={8}
                  placeholder="Repetir contraseña"
                  className={cn(
                    'w-full bg-surface-raised border border-border rounded-xl px-3.5 py-2.5 pr-10',
                    'text-text-primary text-sm placeholder-text-muted',
                    'focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30',
                    'transition-colors'
                  )}
                />
                <button
                  type="button"
                  onClick={() => setShowConf(!showConf)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
                >
                  {showConf ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-danger/10 border border-danger/30 text-danger text-xs rounded-xl px-3 py-2"
              >
                {error}
              </motion.div>
            )}

            <button
              type="submit"
              disabled={loading}
              className={cn(
                'w-full bg-primary hover:bg-primary-hover text-white font-semibold',
                'py-2.5 px-4 rounded-xl text-sm transition-all',
                'focus:outline-none focus:ring-2 focus:ring-primary/30',
                'disabled:opacity-70 disabled:cursor-not-allowed',
                'shadow-lg shadow-primary/20 hover:shadow-primary/30'
              )}
            >
              {loading ? (
                <div className="flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Guardando...
                </div>
              ) : 'Guardar y continuar'}
            </button>
          </form>
        </div>
      </motion.div>
    </div>
  )
}
