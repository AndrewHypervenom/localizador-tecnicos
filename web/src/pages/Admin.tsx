import { useState } from 'react'
import { Link } from 'react-router-dom'
import { LayoutDashboard, Users, Wrench, Activity, BarChart2, LogOut, Shield, FolderOpen, History } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { StatsOverview } from '@/components/admin/StatsOverview'
import { UserManagement } from '@/components/admin/UserManagement'
import { TechnicianManagement } from '@/components/admin/TechnicianManagement'
import { ActivityLog } from '@/components/admin/ActivityLog'
import { ProjectsOverview } from '@/components/admin/ProjectsOverview'
import { OnboardingWizard } from '@/components/admin/OnboardingWizard'
import { AdminHistory } from '@/components/admin/AdminHistory'

type AdminTab = 'stats' | 'users' | 'technicians' | 'activity' | 'projects' | 'history'

const TABS: { id: AdminTab; label: string; icon: React.ElementType }[] = [
  { id: 'stats',       label: 'Resumen',    icon: BarChart2   },
  { id: 'users',       label: 'Usuarios',   icon: Users       },
  { id: 'technicians', label: 'Técnicos',   icon: Wrench      },
  { id: 'activity',    label: 'Actividad',  icon: Activity    },
  { id: 'projects',    label: 'Proyectos',  icon: FolderOpen  },
  { id: 'history',    label: 'Historial',  icon: History     },
]

export function Admin() {
  const [activeTab, setActiveTab] = useState<AdminTab>('stats')
  const [wizardOpen, setWizardOpen] = useState(false)

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
            Panel de Administración
          </div>

          {/* Navegación de tabs */}
          <nav className="hidden md:flex items-center gap-1 ml-4">
            {TABS.map(tab => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors',
                    activeTab === tab.id
                      ? 'bg-primary/10 text-primary'
                      : 'text-text-muted hover:text-text-primary hover:bg-surface-raised',
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
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
              <FolderOpen className="w-3.5 h-3.5" />
              Nuevo proyecto
            </button>
            <Link
              to="/"
              className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary transition-colors px-2.5 py-1.5 rounded-lg hover:bg-surface-raised"
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Dashboard</span>
            </Link>
            <button
              onClick={handleLogout}
              className="text-text-muted hover:text-danger transition-colors p-1.5 rounded-lg hover:bg-danger/10"
              title="Cerrar sesión"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tabs móvil */}
        <div className="md:hidden flex border-t border-border-soft">
          {TABS.map(tab => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex-1 flex flex-col items-center gap-1 py-2 text-xs transition-colors',
                  activeTab === tab.id
                    ? 'text-primary border-b-2 border-primary'
                    : 'text-text-muted hover:text-text-primary',
                )}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            )
          })}
        </div>
      </header>

      {/* Contenido */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6">
        {activeTab === 'stats'       && <StatsOverview />}
        {activeTab === 'users'       && <UserManagement />}
        {activeTab === 'technicians' && <TechnicianManagement />}
        {activeTab === 'activity'    && <ActivityLog />}
        {activeTab === 'projects'    && <ProjectsOverview onOpenWizard={() => setWizardOpen(true)} />}
        {activeTab === 'history'     && <AdminHistory />}
      </main>

      <OnboardingWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onComplete={() => {}}
      />
    </div>
  )
}
