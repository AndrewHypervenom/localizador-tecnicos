import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Users, Wrench, Route, AlertTriangle, RefreshCw, Shield, Activity, Trash2, Loader2, Layers, Bell, ClipboardList } from 'lucide-react'
import { toast } from 'sonner'
import api from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n/i18n'
import { fadeUp, SPRING, stagger } from '@/lib/motion'
import { Card } from '@/components/ui/Card'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { SkeletonGrid } from '@/components/ui/Skeleton'

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
  accent,
}: {
  icon: React.ElementType
  label: string
  value: number
  color: string
  sub?: string
  /** Color del resplandor de fondo, a juego con el icono. */
  accent?: string
}) {
  return (
    <Card spotlight className="p-5 flex items-start gap-4 hover:border-border">
      {/* Resplandor difuso detras del icono — aparece al pasar el cursor. */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute -top-8 -left-8 w-32 h-32 rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500',
          accent ?? 'bg-primary/20',
        )}
      />
      <motion.div
        whileHover={{ scale: 1.08, rotate: -4 }}
        transition={SPRING.bouncy}
        className={cn('relative w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0', color)}
      >
        <Icon className="w-5 h-5" />
      </motion.div>
      <div className="relative min-w-0">
        <p className="text-text-muted text-xs">{label}</p>
        <p className="text-text-primary text-2xl font-bold mt-0.5 tracking-tight">
          <AnimatedNumber value={value} />
        </p>
        {sub && <p className="text-text-muted text-xs mt-0.5">{sub}</p>}
      </div>
    </Card>
  )
}

export function StatsOverview() {
  const { t } = useI18n()
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [backendOk, setBackendOk] = useState<boolean | null>(null)
  const [deletingZones, setDeletingZones] = useState(false)
  const [deletingAlerts, setDeletingAlerts] = useState(false)
  const [deletingRoutes, setDeletingRoutes] = useState(false)

  async function handleDeleteAllZones() {
    if (!window.confirm(t('adminStats.confirmZones'))) return
    setDeletingZones(true)
    try {
      const { error } = await supabase.from('zones').delete().neq('id', '00000000-0000-0000-0000-000000000000')
      if (error) throw error
      toast.success(t('adminStats.zonesDeleted'))
      load()
    } catch (err: any) {
      toast.error(err.message ?? t('adminStats.zonesError'))
    } finally {
      setDeletingZones(false)
    }
  }

  async function handleDeleteAllAlerts() {
    if (!window.confirm(t('adminStats.confirmAlerts'))) return
    setDeletingAlerts(true)
    try {
      const { error } = await supabase.from('motion_events').delete().neq('id', 0)
      if (error) throw error
      toast.success(t('adminStats.alertsDeleted'))
      load()
    } catch (err: any) {
      toast.error(err.message ?? t('adminStats.alertsError'))
    } finally {
      setDeletingAlerts(false)
    }
  }

  async function handleDeleteAllRoutes() {
    if (!window.confirm(t('adminStats.confirmRoutes'))) return
    setDeletingRoutes(true)
    try {
      // route_items tiene FK a technician_routes — borrar primero los items
      const { error: e1 } = await supabase.from('route_items').delete().neq('id', '00000000-0000-0000-0000-000000000000')
      if (e1) throw e1
      const { error: e2 } = await supabase.from('technician_routes').delete().neq('id', '00000000-0000-0000-0000-000000000000')
      if (e2) throw e2
      toast.success(t('adminStats.routesDeleted'))
      load()
    } catch (err: any) {
      toast.error(err.message ?? t('adminStats.routesError'))
    } finally {
      setDeletingRoutes(false)
    }
  }

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
        throw new Error((statsRes.reason as any)?.response?.data?.error ?? t('adminStats.loadError'))
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
      <div className="space-y-6">
        <div className="h-6 w-52 shimmer bg-surface-raised/70 rounded-lg" />
        <SkeletonGrid count={5} />
      </div>
    )
  }

  if (error) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={SPRING.snappy}
        className="flex flex-col items-center gap-3 py-20"
      >
        <div className="w-12 h-12 rounded-2xl bg-danger/10 border border-danger/25 flex items-center justify-center">
          <AlertTriangle className="w-5 h-5 text-danger" />
        </div>
        <p className="text-danger text-sm">{error}</p>
        <motion.button
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.96 }}
          onClick={load}
          className="text-xs text-text-muted hover:text-text-primary flex items-center gap-1.5 transition-colors border border-border-soft rounded-xl px-3 py-2 hover:bg-surface-raised"
        >
          <RefreshCw className="w-3.5 h-3.5" /> {t('common.retry')}
        </motion.button>
      </motion.div>
    )
  }

  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="visible" className="space-y-6">
      {/* Estado del sistema */}
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-text-primary font-semibold text-sm">{t('adminStats.systemStatus')}</h2>
        <div className={cn(
          'flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border',
          backendOk
            ? 'bg-success/10 border-success/30 text-success'
            : 'bg-danger/10 border-danger/30 text-danger',
        )}>
          {/* Punto latiente: comunica "en vivo" mejor que el texto solo. */}
          <span className="relative flex w-1.5 h-1.5">
            <span className={cn('absolute inset-0 rounded-full animate-ping opacity-75', backendOk ? 'bg-success' : 'bg-danger')} />
            <span className={cn('relative w-1.5 h-1.5 rounded-full', backendOk ? 'bg-success' : 'bg-danger')} />
          </span>
          <Activity className="w-3 h-3" />
          {backendOk ? t('adminStats.backendOnline') : t('adminStats.backendOffline')}
        </div>
        <motion.button
          whileHover={{ rotate: 90 }}
          whileTap={{ scale: 0.9 }}
          transition={SPRING.snappy}
          onClick={load}
          title={t('common.refresh')}
          className="ml-auto text-text-muted hover:text-primary transition-colors p-1.5 rounded-lg hover:bg-surface-raised"
        >
          <RefreshCw className="w-4 h-4" />
        </motion.button>
      </div>

      {/* Cards de estadísticas */}
      <motion.div variants={stagger(0.05)} className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <StatCard
          icon={Shield}
          label={t('adminStats.totalUsers')}
          value={stats?.totalUsers ?? 0}
          color="bg-primary/10 text-primary"
          accent="bg-primary/20"
        />
        <StatCard
          icon={Wrench}
          label={t('adminStats.activeTechs')}
          value={stats?.activeTechnicians ?? 0}
          color="bg-success/10 text-success"
          accent="bg-success/20"
          sub={t('adminStats.ofRegistered', { n: stats?.totalTechnicians ?? 0 })}
        />
        <StatCard
          icon={Users}
          label={t('adminStats.totalTechs')}
          value={stats?.totalTechnicians ?? 0}
          color="bg-text-muted/10 text-text-muted"
          accent="bg-text-muted/20"
        />
        <StatCard
          icon={Route}
          label={t('adminStats.tripsToday')}
          value={stats?.tripsToday ?? 0}
          color="bg-warning/10 text-warning"
          accent="bg-warning/20"
        />
        <StatCard
          icon={AlertTriangle}
          label={t('adminStats.unackAlerts')}
          value={stats?.unacknowledgedAlerts ?? 0}
          color="bg-danger/10 text-danger"
          accent="bg-danger/20"
        />
      </motion.div>

      <p className="text-text-muted text-xs">
        {t('adminStats.dataNote')}
      </p>

      {/* Zona de peligro — limpieza de pruebas */}
      <motion.div variants={fadeUp} className="border border-danger/25 rounded-2xl overflow-hidden">
        <div className="bg-danger/5 px-4 py-3 border-b border-danger/20 flex items-center gap-2">
          <Trash2 className="w-4 h-4 text-danger" />
          <p className="text-sm font-semibold text-danger">{t('adminStats.cleanup')}</p>
          <span className="text-xs text-text-muted ml-1">{t('adminStats.cleanupNote')}</span>
        </div>
        <div className="p-4 flex flex-wrap gap-3">
          <button
            onClick={handleDeleteAllZones}
            disabled={deletingZones || deletingAlerts || deletingRoutes}
            className="flex items-center gap-2 text-xs bg-danger/10 hover:bg-danger/20 text-danger border border-danger/30 font-semibold px-4 py-2 rounded-xl transition-colors disabled:opacity-60"
          >
            {deletingZones ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Layers className="w-3.5 h-3.5" />}
            {t('adminStats.btnZones')}
          </button>
          <button
            onClick={handleDeleteAllAlerts}
            disabled={deletingZones || deletingAlerts || deletingRoutes}
            className="flex items-center gap-2 text-xs bg-danger/10 hover:bg-danger/20 text-danger border border-danger/30 font-semibold px-4 py-2 rounded-xl transition-colors disabled:opacity-60"
          >
            {deletingAlerts ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bell className="w-3.5 h-3.5" />}
            {t('adminStats.btnAlerts')}
          </button>
          <button
            onClick={handleDeleteAllRoutes}
            disabled={deletingZones || deletingAlerts || deletingRoutes}
            className="flex items-center gap-2 text-xs bg-danger/10 hover:bg-danger/20 text-danger border border-danger/30 font-semibold px-4 py-2 rounded-xl transition-colors disabled:opacity-60"
          >
            {deletingRoutes ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ClipboardList className="w-3.5 h-3.5" />}
            {t('adminStats.btnRoutes')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
