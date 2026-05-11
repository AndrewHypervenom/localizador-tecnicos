import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Trash2, RefreshCw, X, Shield, User, Loader2, ChevronDown, Copy, Check, KeyRound } from 'lucide-react'
import api from '@/lib/api'
import { cn } from '@/lib/utils'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { supabase } from '@/lib/supabase'

interface WebUser {
  id: string
  email: string
  role: 'superadmin' | 'user'
  createdAt: string
  lastSignIn: string | null
}

function RoleBadge({ role }: { role: string }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium',
      role === 'superadmin'
        ? 'bg-primary/10 text-primary border-primary/20'
        : 'bg-text-muted/10 text-text-secondary border-border',
    )}>
      {role === 'superadmin' ? <Shield className="w-3 h-3" /> : <User className="w-3 h-3" />}
      {role === 'superadmin' ? 'Superadmin' : 'Usuario'}
    </span>
  )
}

// ── Modal para crear usuario ──────────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  function handleCopy() {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="text-text-muted hover:text-primary transition-colors p-1 rounded"
      title="Copiar"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  )
}

function CreateUserModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const [email, setEmail]   = useState('')
  const [role, setRole]     = useState<'user' | 'superadmin'>('user')
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null)
  const [allCopied, setAllCopied] = useState(false)

  function reset() {
    setEmail(''); setRole('user'); setError(null); setCredentials(null); setAllCopied(false)
  }

  function handleClose() { reset(); onClose() }

  function handleDone() {
    reset()
    onCreated()
    onClose()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const { data } = await api.post<{ email: string; tempPassword: string }>('/api/admin/users', { email, role })
      setCredentials({ email: data.email, password: data.tempPassword })
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Error al crear usuario')
    } finally {
      setLoading(false)
    }
  }

  function handleCopyAll() {
    navigator.clipboard.writeText(`Email: ${credentials!.email}\nContraseña temporal: ${credentials!.password}`)
    setAllCopied(true)
    setTimeout(() => setAllCopied(false), 2000)
  }

  if (!open) return null

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget && !credentials) handleClose() }}
    >
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)' }} />
      <div
        style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: '400px', margin: '0 16px' }}
        className="bg-surface border border-border-soft rounded-2xl shadow-2xl p-6"
      >
        {credentials ? (
          <>
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-text-primary text-base flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-success" /> Credenciales generadas
              </h3>
            </div>
            <p className="text-text-muted text-xs mb-4">
              Copia y envía estas credenciales al usuario. Al primer inicio de sesión se le pedirá que cree su propia contraseña.
            </p>
            <div className="space-y-3 mb-5">
              <div className="bg-base border border-border-soft rounded-xl px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-text-muted mb-0.5">Email</p>
                    <p className="text-sm text-text-primary font-mono">{credentials.email}</p>
                  </div>
                  <CopyButton text={credentials.email} />
                </div>
              </div>
              <div className="bg-base border border-border-soft rounded-xl px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-text-muted mb-0.5">Contraseña temporal</p>
                    <p className="text-sm text-text-primary font-mono tracking-widest">{credentials.password}</p>
                  </div>
                  <CopyButton text={credentials.password} />
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCopyAll}
                className="flex-1 flex items-center justify-center gap-2 border border-border-soft text-text-secondary hover:text-text-primary text-sm font-medium rounded-xl py-2.5 transition-colors hover:bg-surface-raised"
              >
                {allCopied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                {allCopied ? 'Copiado' : 'Copiar todo'}
              </button>
              <button
                type="button"
                onClick={handleDone}
                className="flex-1 bg-primary hover:bg-primary/90 text-white font-semibold text-sm rounded-xl py-2.5 transition-colors"
              >
                Listo
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-text-primary text-base flex items-center gap-2">
                <Plus className="w-4 h-4 text-primary" /> Nuevo Usuario
              </h3>
              <button onClick={handleClose} className="text-text-muted hover:text-text-primary transition-colors rounded-lg p-1 hover:bg-surface-raised">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-text-muted text-xs mb-4">
              Se generará una contraseña temporal que podrás copiar y enviar al usuario.
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs text-text-muted uppercase tracking-wider mb-1.5">
                  Correo electrónico *
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoFocus
                  placeholder="usuario@empresa.com"
                  className="w-full bg-base border border-border-soft rounded-xl px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs text-text-muted uppercase tracking-wider mb-1.5">
                  Rol
                </label>
                <div className="relative">
                  <select
                    value={role}
                    onChange={e => setRole(e.target.value as 'user' | 'superadmin')}
                    className="w-full appearance-none bg-base border border-border-soft rounded-xl px-3.5 py-2.5 text-sm text-text-primary focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors pr-8"
                  >
                    <option value="user">Usuario (acceso al dashboard)</option>
                    <option value="superadmin">Superadmin (acceso total)</option>
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
                </div>
              </div>

              {error && (
                <div className="bg-danger/10 border border-danger/30 text-danger text-xs rounded-xl px-3 py-2">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-primary hover:bg-primary/90 text-white font-semibold text-sm rounded-xl py-2.5 transition-colors flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                {loading ? 'Creando…' : 'Crear usuario'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}

// ── Componente principal ──────────────────────────────────────────────────────
export function UserManagement() {
  const [users, setUsers]           = useState<WebUser[]>([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [changingId, setChangingId] = useState<string | null>(null)
  const [currentId, setCurrentId]   = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setCurrentId(session?.user?.id ?? null)
    })
  }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const { data } = await api.get<WebUser[]>('/api/admin/users')
      setUsers(data.filter(u => u.email))
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Error al cargar usuarios')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleChangeRole(user: WebUser) {
    const newRole = user.role === 'superadmin' ? 'user' : 'superadmin'
    const confirmed = window.confirm(
      `¿Cambiar rol de "${user.email}" a ${newRole === 'superadmin' ? 'Superadmin' : 'Usuario'}?`,
    )
    if (!confirmed) return
    setChangingId(user.id)
    try {
      await api.patch(`/api/admin/users/${user.id}/role`, { role: newRole })
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, role: newRole } : u))
    } catch (err: any) {
      alert(err?.response?.data?.error ?? 'Error al cambiar rol')
    } finally {
      setChangingId(null)
    }
  }

  async function handleDelete(user: WebUser) {
    const confirmed = window.confirm(
      `¿Eliminar el usuario "${user.email}"?\nEsta acción no se puede deshacer.`,
    )
    if (!confirmed) return
    setDeletingId(user.id)
    try {
      await api.delete(`/api/admin/users/${user.id}`)
      setUsers(prev => prev.filter(u => u.id !== user.id))
    } catch (err: any) {
      alert(err?.response?.data?.error ?? 'Error al eliminar usuario')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-text-primary font-semibold text-sm">
          Usuarios del Sitio
          {!loading && <span className="text-text-muted font-normal ml-2">({users.length})</span>}
        </h2>
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={load}
            title="Actualizar"
            className="text-text-muted hover:text-text-primary transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 bg-primary hover:bg-primary/90 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Nuevo usuario
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="bg-danger/10 border border-danger/30 text-danger text-sm rounded-xl px-4 py-3">
          {error}
        </div>
      ) : users.length === 0 ? (
        <div className="text-center py-16 text-text-muted text-sm">No hay usuarios</div>
      ) : (
        <div className="bg-surface border border-border-soft rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-soft">
                <th className="text-left text-xs text-text-muted font-medium px-4 py-3">Email</th>
                <th className="text-left text-xs text-text-muted font-medium px-4 py-3">Rol</th>
                <th className="text-left text-xs text-text-muted font-medium px-4 py-3">Creado</th>
                <th className="text-left text-xs text-text-muted font-medium px-4 py-3">Último acceso</th>
                <th className="text-right text-xs text-text-muted font-medium px-4 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => {
                const isSelf = user.id === currentId
                const isChanging = changingId === user.id
                const isDeleting = deletingId === user.id
                return (
                  <tr key={user.id} className="border-b border-border-soft last:border-0 hover:bg-surface-raised transition-colors">
                    <td className="px-4 py-3">
                      <span className="text-text-primary text-xs font-mono">{user.email}</span>
                      {isSelf && (
                        <span className="ml-2 text-xs text-primary">(tú)</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <RoleBadge role={user.role} />
                    </td>
                    <td className="px-4 py-3 text-text-muted text-xs">
                      {format(parseISO(user.createdAt), 'dd MMM yyyy', { locale: es })}
                    </td>
                    <td className="px-4 py-3 text-text-muted text-xs">
                      {user.lastSignIn
                        ? format(parseISO(user.lastSignIn), 'dd MMM yyyy HH:mm', { locale: es })
                        : 'Nunca'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {!isSelf && (
                          <>
                            <button
                              onClick={() => handleChangeRole(user)}
                              disabled={isChanging || isDeleting}
                              title={user.role === 'superadmin' ? 'Quitar superadmin' : 'Hacer superadmin'}
                              className="text-xs text-text-muted hover:text-primary transition-colors px-2 py-1 rounded-lg hover:bg-primary/10 disabled:opacity-40"
                            >
                              {isChanging
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : user.role === 'superadmin' ? 'Quitar admin' : 'Hacer admin'}
                            </button>
                            <button
                              onClick={() => handleDelete(user)}
                              disabled={isDeleting || isChanging}
                              title="Eliminar usuario"
                              className="text-text-muted hover:text-danger transition-colors p-1 rounded-lg hover:bg-danger/10 disabled:opacity-40"
                            >
                              {isDeleting
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : <Trash2 className="w-3.5 h-3.5" />}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <CreateUserModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={load}
      />
    </div>
  )
}
