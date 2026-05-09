import { useEffect, useState } from 'react'
import { Users, Wrench, Route, AlertTriangle, RefreshCw, Shield, Activity } from 'lucide-react'
import api from '@/lib/api'
import { cn } from '@/lib/utils'

interface Stats {
  totalUsers: number
  totalTechnicians: number
  activeTechnicians: number
  tripsToday: number
  unacknowledgedAlerts: number
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
  sub,
}: {
  icon: React.ElementType
  label: string
  value: number | string
  color: string
  sub?: string
}) {
  return (
    <div className="bg-surface border border-border-soft rounded-2xl p-5 flex items-start gap-4">
      <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', color)}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-text-muted text-xs">{label}</p>
        <p className="text-text-primary text-2xl font-bold mt-0.5">{value}</p>
        {sub && <p className="text-text-muted text-xs mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

export function StatsOverview() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [backendOk, setBackendOk] = useState<boolean | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [statsRes, healthRes] = await Promise.allSettled([
        api.get<Stats>('/api/admin/stats'),
        api.get('/health'),
      ])

      if (statsRes.status === 'fulfilled') {
        setStats(statsRes.value.data)
      } else {
        throw new Error((statsRes.reason as any)?.response?.data?.error ?? 'Error al cargar estadísticas')
      }

      setBackendOk(healthRes.status === 'fulfilled')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-20">
        <p className="text-danger text-sm">{error}</p>
        <button
          onClick={load}
          className="text-xs text-text-muted hover:text-text-primary flex items-center gap-1.5 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Reintentar
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Estado del sistema */}
      <div className="flex items-center gap-3">
        <h2 className="text-text-primary font-semibold text-sm">Estado del Sistema</h2>
        <div className="flex items-center gap-2">
          <div className={cn(
            'flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border',
            backendOk
              ? 'bg-success/10 border-success/30 text-success'
              : 'bg-danger/10 border-danger/30 text-danger',
          )}>
            <Activity className="w-3 h-3" />
            Backend {backendOk ? 'online' : 'offline'}
          </div>
        </div>
        <button
          onClick={load}
          title="Actualizar"
          className="ml-auto text-text-muted hover:text-text-primary transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Cards de estadísticas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          icon={Shield}
          label="Usuarios del sitio"
          value={stats?.totalUsers ?? 0}
          color="bg-primary/10 text-primary"
        />
        <StatCard
          icon={Wrench}
          label="Técnicos activos ahora"
          value={stats?.activeTechnicians ?? 0}
          color="bg-success/10 text-success"
          sub={`de ${stats?.totalTechnicians ?? 0} registrados`}
        />
        <StatCard
          icon={Users}
          label="Total técnicos registrados"
          value={stats?.totalTechnicians ?? 0}
          color="bg-text-muted/10 text-text-muted"
        />
        <StatCard
          icon={Route}
          label="Viajes completados hoy"
          value={stats?.tripsToday ?? 0}
          color="bg-warning/10 text-warning"
        />
        <StatCard
          icon={AlertTriangle}
          label="Alertas sin reconocer (24h)"
          value={stats?.unacknowledgedAlerts ?? 0}
          color="bg-danger/10 text-danger"
        />
      </div>

      <p className="text-text-muted text-xs">
        Datos actualizados al cargar la página. Usa el botón de actualizar para refrescar.
      </p>
    </div>
  )
}
