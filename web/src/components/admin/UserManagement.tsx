import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Trash2, RefreshCw, X, Shield, User, Loader2, ChevronDown, Copy, Check, KeyRound, Building2 } from 'lucide-react'
import api from '@/lib/api'
import { cn } from '@/lib/utils'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { supabase } from '@/lib/supabase'

interface WebUser {
  id: string
  email: string
  role: 'superadmin' | 'leader' | 'user'
  createdAt: string
  lastSignIn: string | null
  mustChangePassword: boolean
}

interface CompanyInfo {
  id: string
  name: string
  leaderId: string
}

const ROLE_CYCLE: Record<string, 'user' | 'leader' | 'superadmin'> = {
  user: 'leader',
  leader: 'superadmin',
  superadmin: 'user',
}

const ROLE_LABELS = { user: 'Usuario', leader: 'Líder', superadmin: 'Superadmin' }
const ROLE_NEXT_LABELS = { user: 'Hacer Líder', leader: 'Hacer Superadmin', superadmin: 'Hacer Usuario' }

function RoleBadge({ role }: { role: string }) {
  if (role === 'superadmin') return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium bg-primary/10 text-primary border-primary/20">
      <Shield className="w-3 h-3" /> Superadmin
    </span>
  )
  if (role === 'leader') return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium bg-warning/10 text-warning border-warning/20">
      <Building2 className="w-3 h-3" /> Líder
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium bg-text-muted/10 text-text-secondary border-border">
      <User className="w-3 h-3" /> Usuario
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
  const [role, setRole]     = useState<'user' | 'leader' | 'superadmin'>('user')
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
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }} />
      <div
        style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: '400px', margin: '0 16px', maxHeight: '90vh', overflowY: 'auto' }}
        className="bg-surface border border-border-soft rounded-2xl shadow-2xl"
      >
        {credentials ? (
          <>
            {/* Header — credenciales */}
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border-soft sticky top-0 bg-surface rounded-t-2xl z-10">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center">
                  <KeyRound className="w-4 h-4 text-success" />
                </div>
                <div>
                  <p className="font-bold text-text-primary text-sm leading-none">Credenciales generadas</p>
                  <p className="text-xs text-text-muted mt-0.5">Copia y envía al usuario</p>
                </div>
              </div>
            </div>
            <div className="px-6 py-5 space-y-4">
              <p className="text-text-muted text-xs">
                Al primer inicio de sesión se le pedirá que cree su propia contraseña.
              </p>
              <div className="space-y-3">
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
              <div className="flex gap-2 pt-1">
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
                  className="flex-1 bg-primary hover:bg-primary-hover text-base font-semibold text-sm rounded-xl py-2.5 transition-colors"
                >
                  Listo
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Header — formulario */}
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border-soft sticky top-0 bg-surface rounded-t-2xl z-10">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Plus className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="font-bold text-text-primary text-sm leading-none">Nuevo usuario</p>
                  <p className="text-xs text-text-muted mt-0.5">Se generará una contraseña temporal</p>
                </div>
              </div>
              <button onClick={handleClose} className="text-text-muted hover:text-text-primary transition-colors rounded-lg p-1.5 hover:bg-surface-raised">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-1 h-4 bg-primary rounded-full" />
                  <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Datos del usuario</p>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-text-muted font-medium mb-1.5">
                      Correo electrónico <span className="text-danger">*</span>
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      required
                      autoFocus
                      placeholder="usuario@empresa.com"
                      className="w-full bg-base border border-border-soft rounded-xl px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-text-muted font-medium mb-1.5">Rol</label>
                    <div className="relative">
                      <select
                        value={role}
                        onChange={e => setRole(e.target.value as 'user' | 'leader' | 'superadmin')}
                        className="w-full appearance-none bg-base border border-border-soft rounded-xl px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors pr-8"
                      >
                        <option value="user">Usuario (acceso al dashboard)</option>
                        <option value="leader">Líder (carga rutas y gestiona técnicos)</option>
                        <option value="superadmin">Superadmin (acceso total)</option>
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
                    </div>
                  </div>
                </div>
              </div>

              {error && (
                <div className="bg-danger/10 border border-danger/30 text-danger text-xs rounded-xl px-3 py-2.5">
                  {error}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button type="button" onClick={handleClose}
                  className="flex-1 border border-border-soft text-text-secondary hover:text-text-primary text-sm font-medium rounded-xl py-2.5 transition-colors hover:bg-surface-raised">
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 bg-primary hover:bg-primary-hover text-base font-semibold text-sm rounded-xl py-2.5 transition-colors flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  {loading ? 'Creando…' : 'Crear usuario'}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}

// ── Modal de credenciales (reset) ─────────────────────────────────────────────
function CredentialsModal({
  credentials,
  onClose,
}: {
  credentials: { email: string; password: string } | null
  onClose: () => void
}) {
  const [allCopied, setAllCopied] = useState(false)

  function handleCopyAll() {
    navigator.clipboard.writeText(`Email: ${credentials!.email}\nContraseña temporal: ${credentials!.password}`)
    setAllCopied(true)
    setTimeout(() => setAllCopied(false), 2000)
  }

  if (!credentials) return null

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }} />
      <div
        style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: '400px', margin: '0 16px', maxHeight: '90vh', overflowY: 'auto' }}
        className="bg-surface border border-border-soft rounded-2xl shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border-soft sticky top-0 bg-surface rounded-t-2xl z-10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-warning/10 flex items-center justify-center">
              <KeyRound className="w-4 h-4 text-warning" />
            </div>
            <div>
              <p className="font-bold text-text-primary text-sm leading-none">Contraseña reseteada</p>
              <p className="text-xs text-text-muted mt-0.5">Envía estas credenciales al usuario</p>
            </div>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors rounded-lg p-1.5 hover:bg-surface-raised">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <p className="text-text-muted text-xs">
            Al ingresar se le pedirá que cree su propia contraseña.
          </p>
          <div className="space-y-3">
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
          <div className="flex gap-2 pt-1">
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
              onClick={onClose}
              className="flex-1 bg-primary hover:bg-primary-hover text-base font-semibold text-sm rounded-xl py-2.5 transition-colors"
            >
              Listo
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ── Componente principal ──────────────────────────────────────────────────────
export function UserManagement() {
  const [users, setUsers]           = useState<WebUser[]>([])
  const [companies, setCompanies]   = useState<CompanyInfo[]>([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [createOpen, setCreateOpen]       = useState(false)
  const [deletingId, setDeletingId]       = useState<string | null>(null)
  const [changingId, setChangingId]       = useState<string | null>(null)
  const [resettingId, setResettingId]     = useState<string | null>(null)
  const [resetCredentials, setResetCredentials] = useState<{ email: string; password: string } | null>(null)
  const [currentId, setCurrentId]         = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setCurrentId(session?.user?.id ?? null)
    })
  }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [{ data: userData }, { data: compData }] = await Promise.all([
        api.get<WebUser[]>('/api/admin/users'),
        api.get<{ id: string; name: string; leaderId: string }[]>('/api/admin/companies'),
      ])
      setUsers(userData.filter(u => u.email))
      setCompanies(compData.map(c => ({ id: c.id, name: c.name, leaderId: c.leaderId })))
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Error al cargar usuarios')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleChangeRole(user: WebUser) {
    const newRole = ROLE_CYCLE[user.role] ?? 'user'
    const confirmed = window.confirm(
      `¿Cambiar rol de "${user.email}" a ${ROLE_LABELS[newRole]}?`,
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

  async function handleResetPassword(user: WebUser) {
    const confirmed = window.confirm(
      `¿Resetear la contraseña de "${user.email}"?\nSe generará una nueva contraseña temporal.`,
    )
    if (!confirmed) return
    setResettingId(user.id)
    try {
      const { data } = await api.post<{ email: string; tempPassword: string }>(`/api/admin/users/${user.id}/reset-password`)
      setResetCredentials({ email: data.email, password: data.tempPassword })
    } catch (err: any) {
      alert(err?.response?.data?.error ?? 'Error al resetear contraseña')
    } finally {
      setResettingId(null)
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
                <th className="text-left text-xs text-text-muted font-medium px-4 py-3 hidden md:table-cell">Empresa</th>
                <th className="text-left text-xs text-text-muted font-medium px-4 py-3 hidden lg:table-cell">Creado</th>
                <th className="text-left text-xs text-text-muted font-medium px-4 py-3 hidden lg:table-cell">Último acceso</th>
                <th className="text-right text-xs text-text-muted font-medium px-4 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => {
                const isSelf = user.id === currentId
                const isChanging = changingId === user.id
                const isDeleting = deletingId === user.id
                const isResetting = resettingId === user.id
                const userCompanies = companies.filter(c => c.leaderId === user.id)
                return (
                  <tr key={user.id} className="border-b border-border-soft last:border-0 hover:bg-surface-raised transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-text-primary text-xs font-mono">{user.email}</span>
                        {isSelf && <span className="text-xs text-primary">(tú)</span>}
                        {user.mustChangePassword && (
                          <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full bg-warning/10 border border-warning/30 text-warning font-medium" title="Debe cambiar su contraseña en el próximo inicio de sesión">
                            <KeyRound className="w-2.5 h-2.5" /> clave pendiente
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <RoleBadge role={user.role} />
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      {userCompanies.length > 0 ? (
                        <div className="flex flex-col gap-0.5">
                          {userCompanies.slice(0, 2).map(c => (
                            <span key={c.id} className="text-xs text-text-muted truncate max-w-[140px]">{c.name}</span>
                          ))}
                          {userCompanies.length > 2 && (
                            <span className="text-xs text-text-muted/50">+{userCompanies.length - 2} más</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-text-muted/40">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-text-muted text-xs hidden lg:table-cell">
                      {format(parseISO(user.createdAt), 'dd MMM yyyy', { locale: es })}
                    </td>
                    <td className="px-4 py-3 text-text-muted text-xs hidden lg:table-cell">
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
                              disabled={isChanging || isDeleting || isResetting}
                              title={ROLE_NEXT_LABELS[user.role]}
                              className="text-xs text-text-muted hover:text-primary transition-colors px-2 py-1 rounded-lg hover:bg-primary/10 disabled:opacity-40 whitespace-nowrap"
                            >
                              {isChanging
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : ROLE_NEXT_LABELS[user.role]}
                            </button>
                            <button
                              onClick={() => handleResetPassword(user)}
                              disabled={isResetting || isChanging || isDeleting}
                              title="Resetear contraseña"
                              className="text-text-muted hover:text-warning transition-colors p-1 rounded-lg hover:bg-warning/10 disabled:opacity-40"
                            >
                              {isResetting
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : <KeyRound className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              onClick={() => handleDelete(user)}
                              disabled={isDeleting || isChanging || isResetting}
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
      <CredentialsModal
        credentials={resetCredentials}
        onClose={() => setResetCredentials(null)}
      />
    </div>
  )
}
