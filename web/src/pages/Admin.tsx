import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Sparkles } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { SPRING } from '@/lib/motion'
import { StatsOverview } from '@/components/admin/StatsOverview'
import { UserManagement } from '@/components/admin/UserManagement'
import { TechnicianManagement } from '@/components/admin/TechnicianManagement'
import { ActivityLog } from '@/components/admin/ActivityLog'
import { ProjectsOverview } from '@/components/admin/ProjectsOverview'
import { AdminHistory } from '@/components/admin/AdminHistory'
import { CompaniesManagement } from '@/components/admin/CompaniesManagement'
import { OnboardingWizard } from '@/components/admin/OnboardingWizard'
import { AppShell } from '@/components/layout/AppShell'
import {
  ADMIN_SUBTITLE_KEY, ADMIN_TITLE_KEY, buildAdminNav, isAdminTab, type AdminTab,
} from '@/components/layout/adminNav'
import { useI18n } from '@/lib/i18n/i18n'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'

/** El historial trae su propio split pane de alto completo; no debe scrollear el shell. */
const FULL_BLEED: ReadonlySet<AdminTab> = new Set<AdminTab>(['history'])

export function Admin() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  // La pestana vive en la URL para poder volver del mapa a la vista exacta
  // y para que recargar no devuelva siempre al resumen.
  const tabParam = searchParams.get('tab')
  const activeTab: AdminTab = isAdminTab(tabParam) ? tabParam : 'stats'

  const [wizardOpen, setWizardOpen] = useState(false)
  const [unlinkedCount, setUnlinkedCount] = useState(0)

  const setActiveTab = useCallback((id: string) => {
    if (id === 'map') { navigate('/admin/map'); return }
    if (!isAdminTab(id)) return
    // `replace` para no llenar el historial del navegador de pestanas.
    setSearchParams(id === 'stats' ? {} : { tab: id }, { replace: true })
  }, [navigate, setSearchParams])

  useEffect(() => {
    supabase
      .from('technicians')
      .select('id', { count: 'exact', head: true })
      .then(({ count }) => { if ((count ?? 1) === 0) setWizardOpen(true) })
    supabase
      .from('technicians')
      .select('id', { count: 'exact', head: true })
      .eq('active', true)
      .is('device_id', null)
      .then(({ count }) => setUnlinkedCount(count ?? 0))
  }, [])

  const handleLogout = async () => { await supabase.auth.signOut() }

  const navItems = buildAdminNav(t, { unlinkedCount })

  return (
    <>
      <AppShell
        items={navItems}
        activeId={activeTab}
        onSelect={setActiveTab}
        onLogout={handleLogout}
        badgeLabel={t('admin.badge')}
        title={t(ADMIN_TITLE_KEY[activeTab])}
        subtitle={t(ADMIN_SUBTITLE_KEY[activeTab])}
        fullBleed={FULL_BLEED.has(activeTab)}
        topbarActions={
          <>
            <motion.button
              whileHover={{ scale: 1.03, y: -1 }}
              whileTap={{ scale: 0.97 }}
              transition={SPRING.snappy}
              onClick={() => setWizardOpen(true)}
              className="hidden sm:flex items-center gap-1.5 bg-primary hover:bg-primary-hover text-base text-xs font-semibold px-3.5 py-2 rounded-xl shadow-glow-primary transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {t('admin.newProject')}
            </motion.button>
            <LanguageSwitcher />
          </>
        }
      >
        {activeTab === 'stats'       && <StatsOverview />}
        {activeTab === 'users'       && <UserManagement />}
        {activeTab === 'technicians' && <TechnicianManagement onOpenWizard={() => setWizardOpen(true)} />}
        {activeTab === 'companies'   && <CompaniesManagement />}
        {activeTab === 'activity'    && <ActivityLog />}
        {activeTab === 'projects'    && <ProjectsOverview onOpenWizard={() => setWizardOpen(true)} />}
        {activeTab === 'history'     && <AdminHistory />}
      </AppShell>

      <OnboardingWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onComplete={() => setWizardOpen(false)}
      />
    </>
  )
}
