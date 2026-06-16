import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { LayoutDashboard, Users, Wrench, Activity, BarChart2, LogOut, Shield, FolderOpen, History, Building2, Sparkles } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { StatsOverview } from '@/components/admin/StatsOverview'
import { UserManagement } from '@/components/admin/UserManagement'
import { TechnicianManagement } from '@/components/admin/TechnicianManagement'
import { ActivityLog } from '@/components/admin/ActivityLog'
import { ProjectsOverview } from '@/components/admin/ProjectsOverview'
import { AdminHistory } from '@/components/admin/AdminHistory'
import { CompaniesManagement } from '@/components/admin/CompaniesManagement'
import { OnboardingWizard } from '@/components/admin/OnboardingWizard'
import { useI18n } from '@/lib/i18n/i18n'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'

type AdminTab = 'stats' | 'users' | 'technicians' | 'activity' | 'projects' | 'companies' | 'history'

const TABS: { id: AdminTab; labelKey: string; icon: React.ElementType }[] = [
  { id: 'stats',       labelKey: 'admin.tab.stats',       icon: BarChart2   },
  { id: 'users',       labelKey: 'admin.tab.users',       icon: Users       },
  { id: 'technicians', labelKey: 'admin.tab.technicians', icon: Wrench      },
  { id: 'companies',   labelKey: 'admin.tab.companies',   icon: Building2   },
  { id: 'activity',    labelKey: 'admin.tab.activity',    icon: Activity    },
  { id: 'projects',    labelKey: 'admin.tab.projects',    icon: FolderOpen  },
  { id: 'history',     labelKey: 'admin.tab.history',     icon: History     },
]

export function Admin() {
  const { t } = useI18n()
  const [activeTab, setActiveTab]     = useState<AdminTab>('stats')
  const [wizardOpen, setWizardOpen]   = useState(false)
  const [unlinkedCount, setUnlinkedCount] = useState(0)

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

  const handleLogout = async () => {
    await supabase.auth.signOut()
  }

  return (
    <div className="min-h-screen bg-base flex flex-col">
      {/* Header */}
      <header className="bg-surface border-b border-border-soft sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-4">
          {/* Marca */}
          <div className="flex items-center gap-2.5 flex-shrink-0">
            <div className="w-8 h-8 rounded-lg overflow-hidden">
              <img src="/favicon.png" alt="PositivoS+" className="w-full h-full object-cover" />
            </div>
            <div>
              <p className="text-xs font-bold text-text-primary leading-none">Localizador</p>
              <p className="text-xs text-primary font-semibold leading-none">PositivoS+</p>
            </div>
          </div>

          {/* Badge de admin */}
          <div className="flex items-center gap-1.5 bg-primary/10 border border-primary/20 text-primary text-xs px-2.5 py-1 rounded-full font-medium">
            <Shield className="w-3 h-3" />
            {t('admin.badge')}
          </div>

          {/* Navegación de tabs */}
          <nav className="hidden md:flex items-center gap-1 ml-4 overflow-x-auto scrollbar-none">
            {TABS.map(tab => {
              const Icon = tab.icon
              const hasBadge = tab.id === 'technicians' && unlinkedCount > 0
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors relative whitespace-nowrap flex-shrink-0',
                    activeTab === tab.id
                      ? 'bg-primary/10 text-primary'
                      : 'text-text-muted hover:text-text-primary hover:bg-surface-raised',
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {t(tab.labelKey)}
                  {hasBadge && (
                    <span className="bg-amber-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center leading-none">
                      {unlinkedCount > 9 ? '9+' : unlinkedCount}
                    </span>
                  )}
                </button>
              )
            })}
          </nav>

          {/* Acciones de la derecha */}
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={() => setWizardOpen(true)}
              className="hidden sm:flex items-center gap-1.5 bg-primary hover:bg-primary-hover text-base text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {t('admin.newProject')}
            </button>
            <Link
              to="/map"
              className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary transition-colors px-2.5 py-1.5 rounded-lg hover:bg-surface-raised"
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t('admin.map')}</span>
            </Link>
            <LanguageSwitcher />
            <button
              onClick={handleLogout}
              className="text-text-muted hover:text-danger transition-colors p-1.5 rounded-lg hover:bg-danger/10"
              title={t('common.logout')}
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tabs móvil */}
        <div className="md:hidden flex overflow-x-auto border-t border-border-soft">
          {TABS.map(tab => {
            const Icon = tab.icon
            const hasBadge = tab.id === 'technicians' && unlinkedCount > 0
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex-shrink-0 min-w-[62px] flex flex-col items-center gap-1 py-2 px-2 text-xs transition-colors relative whitespace-nowrap',
                  activeTab === tab.id
                    ? 'text-primary border-b-2 border-primary'
                    : 'text-text-muted hover:text-text-primary',
                )}
              >
                <div className="relative">
                  <Icon className="w-4 h-4" />
                  {hasBadge && (
                    <span className="absolute -top-1 -right-1.5 bg-amber-500 text-white text-[8px] font-bold w-3 h-3 rounded-full flex items-center justify-center leading-none">
                      {unlinkedCount > 9 ? '9+' : unlinkedCount}
                    </span>
                  )}
                </div>
                {t(tab.labelKey)}
              </button>
            )
          })}
        </div>
      </header>

      {/* Contenido */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6">
        {activeTab === 'stats'       && <StatsOverview />}
        {activeTab === 'users'       && <UserManagement />}
        {activeTab === 'technicians' && <TechnicianManagement onOpenWizard={() => setWizardOpen(true)} />}
        {activeTab === 'companies'   && <CompaniesManagement />}

        {activeTab === 'activity'    && <ActivityLog />}
        {activeTab === 'projects'    && <ProjectsOverview onOpenWizard={() => setWizardOpen(true)} />}
        {activeTab === 'history'     && <AdminHistory />}
      </main>

      <OnboardingWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onComplete={() => setWizardOpen(false)}
      />
    </div>
  )
}
