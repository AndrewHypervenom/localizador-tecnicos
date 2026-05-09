import { useEffect, useState } from 'react'
import { RefreshCw, Filter } from 'lucide-react'
import api from '@/lib/api'
import { cn } from '@/lib/utils'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'

interface LogEntry {
  id: string
  user_id: string | null
  user_email: string
  action: string
  target_type: string | null
  target_id: string | null
  details: Record<string, unknown> | null
  created_at: string
}

const ACTION_LABELS: Record<string, string> = {
  create_user: 'Crear usuario',
  delete_user: 'Eliminar usuario',
  change_role: 'Cambiar rol',
  register_technician: 'Registrar técnico',
  login: 'Inicio de sesión',
}

const ACTION_COLORS: Record<string, string> = {
  create_user:          'bg-success/10 text-success border-success/20',
  delete_user:          'bg-danger/10 text-danger border-danger/20',
  change_role:          'bg-warning/10 text-warning border-warning/20',
  register_technician:  'bg-primary/10 text-primary border-primary/20',
  login:                'bg-text-muted/10 text-text-muted border-border',
}

function getActionLabel(action: string) {
  return ACTION_LABELS[action] ?? action
}

function getActionColor(action: string) {
  return ACTION_COLORS[action] ?? 'bg-text-muted/10 text-text-muted border-border'
}

function getDetails(entry: LogEntry): string {
  if (!entry.details) return ''
  const d = entry.details
  if (entry.action === 'create_user') return `${d.newEmail} · ${d.newRole}`
  if (entry.action === 'delete_user') return `${d.deletedEmail}`
  if (entry.action === 'change_role') return `${d.targetEmail} → ${d.newRole}`
  return JSON.stringify(d)
}

const ALL_ACTIONS = ['create_user', 'delete_user', 'change_role', 'register_technician', 'login']

export function ActivityLog() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterAction, setFilterAction] = useState<string>('all')

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const { data } = await api.get<LogEntry[]>('/api/admin/logs')
      setLogs(data)
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Error al cargar registros')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const filtered = filterAction === 'all'
    ? logs
    : logs.filter(l => l.action === filterAction)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-text-primary font-semibold text-sm">Registro de Actividad</h2>
        <div className="flex items-center gap-1.5 ml-auto">
          <Filter className="w-3.5 h-3.5 text-text-muted" />
          <select
            value={filterAction}
            onChange={e => setFilterAction(e.target.value)}
            className="bg-surface-raised border border-border rounded-lg px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-primary"
          >
            <option value="all">Todas las acciones</option>
            {ALL_ACTIONS.map(a => (
              <option key={a} value={a}>{getActionLabel(a)}</option>
            ))}
          </select>
          <button
            onClick={load}
            title="Actualizar"
            className="text-text-muted hover:text-text-primary transition-colors ml-1"
          >
            <RefreshCw className="w-4 h-4" />
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
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-text-muted text-sm">
          No hay registros de actividad
        </div>
      ) : (
        <div className="bg-surface border border-border-soft rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-soft">
                <th className="text-left text-xs text-text-muted font-medium px-4 py-3">Fecha y hora</th>
                <th className="text-left text-xs text-text-muted font-medium px-4 py-3">Usuario</th>
                <th className="text-left text-xs text-text-muted font-medium px-4 py-3">Acción</th>
                <th className="text-left text-xs text-text-muted font-medium px-4 py-3">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry, i) => (
                <tr
                  key={entry.id}
                  className={cn(
                    'border-b border-border-soft last:border-0 hover:bg-surface-raised transition-colors',
                    i % 2 === 0 ? '' : 'bg-base/30',
                  )}
                >
                  <td className="px-4 py-3 text-text-muted text-xs whitespace-nowrap">
                    {format(parseISO(entry.created_at), "dd MMM yyyy HH:mm", { locale: es })}
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-xs">
                    {entry.user_email || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      'text-xs px-2 py-0.5 rounded-full border font-medium',
                      getActionColor(entry.action),
                    )}>
                      {getActionLabel(entry.action)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-text-muted text-xs">
                    {getDetails(entry) || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-2 border-t border-border-soft">
            <p className="text-text-muted text-xs">
              Mostrando {filtered.length} de {logs.length} entradas (máximo 200)
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
