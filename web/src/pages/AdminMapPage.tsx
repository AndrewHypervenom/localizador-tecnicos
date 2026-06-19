import { Link } from 'react-router-dom'
import { LogOut, Shield, ArrowLeft } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { AdminMap } from '@/components/admin/AdminMap'
import { useI18n } from '@/lib/i18n/i18n'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'

export function AdminMapPage() {
  const { t } = useI18n()
  const handleLogout = async () => { await supabase.auth.signOut() }

  return (
    <div className="h-screen bg-base flex flex-col overflow-hidden">
      {/* Header */}
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

          <div className="flex items-center gap-1.5 bg-primary/10 border border-primary/20 text-primary text-xs px-2.5 py-1 rounded-full font-medium flex-shrink-0">
            <Shield className="w-3 h-3" />
            {t('adminMap.title')}
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <Link
              to="/admin"
              className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary transition-colors px-2.5 py-1.5 rounded-lg hover:bg-surface-raised"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t('adminMap.backToPanel')}</span>
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
      </header>

      {/* Mapa */}
      <div className="flex-1 overflow-hidden relative">
        <AdminMap />
      </div>
    </div>
  )
}
