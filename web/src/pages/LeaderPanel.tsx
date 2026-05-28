import { useState, useEffect } from 'react'
import { LogOut, Users2, X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '@/lib/supabase'
import { useTrackingStore } from '@/store/trackingStore'
import { LeaderMap } from '@/components/leader/LeaderMap'
import { LeaderOnboarding } from '@/components/leader/LeaderOnboarding'
import { LeaderStats } from '@/components/leader/LeaderStats'
import { RouteUpload } from '@/components/leader/RouteUpload'
import { RoutesView } from '@/components/leader/RoutesView'
import { LeaderTechnicians } from '@/components/leader/LeaderTechnicians'
import { LeaderCampaigns } from '@/components/leader/LeaderCampaigns'
import { LeaderHistory } from '@/components/leader/LeaderHistory'
import { LeaderReports } from '@/components/leader/LeaderReports'
import { LeaderAlerts } from '@/components/leader/LeaderAlerts'
import { FleetLocationsManagement } from '@/components/admin/FleetLocationsManagement'
import { useFleetLocations } from '@/hooks/useFleetLocations'

export type LeaderPanelView =
  | 'stats' | 'upload' | 'routes' | 'technicians'
  | 'campaigns' | 'fleet'
  | 'history' | 'reports' | 'alerts'
  | null

const PANEL_TITLES: Record<NonNullable<LeaderPanelView>, string> = {
  stats:       'Resumen del día',
  upload:      'Cargar rutas',
  routes:      'Ver rutas',
  technicians: 'Técnicos',
  campaigns:   'Campañas',
  fleet:       'Ubicaciones',
  history:     'Historial de viajes',
  reports:     'Reportes',
  alerts:      'Centro de alertas',
}

export function LeaderPanel() {
  useFleetLocations()
  const [openPanel, setOpenPanel]             = useState<LeaderPanelView>(null)
  const [userEmail, setUserEmail]             = useState('')
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null)

  const unreadAlertsCount = useTrackingStore(
    s => s.alerts.filter(a => !a.acknowledged).length +
         s.zoneAlerts.filter(a => !a.acknowledged).length
  )

  useEffect(() => {
    async function check() {
      const { data: { session } } = await supabase.auth.getSession()
      setUserEmail(session?.user?.email ?? '')
      const { count } = await supabase
        .from('companies')
        .select('id', { count: 'exact', head: true })
        .eq('created_by', session?.user?.id)
      setNeedsOnboarding((count ?? 0) === 0)
    }
    check()
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
  }

  if (needsOnboarding === null) {
    return (
      <div className="min-h-screen bg-base flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const isFullScreen = openPanel === 'upload'
  const isDrawer     = openPanel !== null && !isFullScreen

  return (
    <div className="h-screen bg-base flex flex-col overflow-hidden">
      {needsOnboarding && (
        <LeaderOnboarding onComplete={() => {
          setNeedsOnboarding(false)
          setOpenPanel('upload')
        }} />
      )}

      {/* Header — minimal, no tabs */}
      <header className="bg-surface border-b border-border-soft flex-shrink-0 z-40">
        <div className="px-4 py-3 flex items-center gap-3">
          <div className="flex items-center gap-2.5 flex-shrink-0">
            <div className="w-8 h-8 rounded-lg overflow-hidden">
              <img src="/favicon.png" alt="PositivoS+" className="w-full h-full object-cover" />
            </div>
            <div>
              <p className="text-xs font-bold text-text-primary leading-none">Localizador</p>
              <p className="text-xs text-primary font-semibold leading-none">PositivoS+</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 bg-warning/10 border border-warning/20 text-warning text-xs px-2.5 py-1 rounded-full font-medium flex-shrink-0">
            <Users2 className="w-3 h-3" />
            Panel de Líder
          </div>

          <div className="flex items-center gap-2 ml-auto">
            {userEmail && (
              <span className="hidden lg:block text-text-muted text-xs truncate max-w-48">{userEmail}</span>
            )}
            <button
              onClick={handleLogout}
              className="text-text-muted hover:text-danger transition-colors p-1.5 rounded-lg hover:bg-danger/10"
              title="Cerrar sesión"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Map workspace — always visible, always full */}
      <div className="flex-1 overflow-hidden relative">
        <LeaderMap onOpenPanel={setOpenPanel} unreadAlertsCount={unreadAlertsCount} />
      </div>

      {/* Full-screen overlay — RouteUpload */}
      <AnimatePresence>
        {isFullScreen && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 bg-base z-[950] flex flex-col"
          >
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border-soft bg-surface flex-shrink-0">
              <button
                onClick={() => setOpenPanel(null)}
                className="text-text-muted hover:text-text-primary transition-colors p-1.5 rounded-lg hover:bg-surface-raised"
              >
                <X className="w-4 h-4" />
              </button>
              <h2 className="font-semibold text-text-primary text-sm">
                {openPanel ? PANEL_TITLES[openPanel] : ''}
              </h2>
            </div>
            <div className="flex-1 overflow-y-auto">
              <div className="max-w-7xl mx-auto w-full px-4 py-6">
                <RouteUpload onUploaded={() => setOpenPanel('routes')} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Right drawer — all other panels */}
      <AnimatePresence>
        {isDrawer && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => setOpenPanel(null)}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[940]"
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className={`fixed right-0 top-0 bottom-0 w-full bg-surface z-[941] flex flex-col shadow-2xl border-l border-border-soft ${openPanel === 'history' ? 'max-w-5xl' : 'max-w-2xl'}`}
            >
              <div className="flex items-center gap-3 px-4 py-3 border-b border-border-soft flex-shrink-0">
                <button
                  onClick={() => setOpenPanel(null)}
                  className="text-text-muted hover:text-text-primary transition-colors p-1.5 rounded-lg hover:bg-surface-raised"
                >
                  <X className="w-4 h-4" />
                </button>
                <h2 className="font-semibold text-text-primary text-sm">
                  {openPanel ? PANEL_TITLES[openPanel] : ''}
                </h2>
              </div>
              <div className="flex-1 overflow-y-auto">
                <div className="p-4">
                  {openPanel === 'stats'       && <LeaderStats />}
                  {openPanel === 'routes'      && <RoutesView />}
                  {openPanel === 'technicians' && <LeaderTechnicians />}
                  {openPanel === 'fleet'       && <FleetLocationsManagement />}
                  {openPanel === 'campaigns'   && <LeaderCampaigns />}
                  {openPanel === 'history'     && <LeaderHistory />}
                  {openPanel === 'reports'     && <LeaderReports />}
                  {openPanel === 'alerts'      && <LeaderAlerts />}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
