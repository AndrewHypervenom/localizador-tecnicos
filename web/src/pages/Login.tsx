import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { supabase } from '@/lib/supabase'
import { getRoleFromSession } from '@/lib/roles'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n/i18n'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'

export function Login() {
  const navigate = useNavigate()
  const { t } = useI18n()

  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd]   = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password })
      if (authError) throw authError
      if (data.session?.user?.user_metadata?.must_change_password) {
        navigate('/change-password', { replace: true })
        return
      }
      const role = getRoleFromSession(data.session)
      navigate(role === 'superadmin' ? '/admin' : role === 'leader' ? '/leader' : '/')
    } catch (err: any) {
      setError(err.message === 'Invalid login credentials'
        ? t('login.badCredentials')
        : err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-base flex items-center justify-center p-4">
      {/* Background decorativo */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-success/5 rounded-full blur-3xl" />
      </div>

      <div className="absolute top-4 right-4 z-10">
        <LanguageSwitcher />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="relative w-full max-w-sm"
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl overflow-hidden mx-auto mb-4 shadow-lg shadow-primary/30">
            <img src="/favicon.png" alt="PositivoS+" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-2xl font-bold text-text-primary">Localizador <span className="text-primary">PositivoS+</span></h1>
          <p className="text-text-muted text-sm mt-1">{t('login.subtitle')}</p>
        </div>

        {/* Card de login */}
        <div className="bg-surface border border-border-soft rounded-2xl p-6 shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                {t('login.email')}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="admin@empresa.com"
                className={cn(
                  'w-full bg-surface-raised border border-border rounded-xl px-3.5 py-2.5',
                  'text-text-primary text-sm placeholder-text-muted',
                  'focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30',
                  'transition-colors'
                )}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                {t('login.password')}
              </label>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
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
                  {t('login.submitting')}
                </div>
              ) : t('login.submit')}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-text-muted mt-4">
          {t('login.footer')}
        </p>
      </motion.div>
    </div>
  )
}
