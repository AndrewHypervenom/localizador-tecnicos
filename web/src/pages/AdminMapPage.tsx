import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { AdminMap } from '@/components/admin/AdminMap'
import { AppShell } from '@/components/layout/AppShell'
import { ADMIN_SUBTITLE_KEY, ADMIN_TITLE_KEY, buildAdminNav } from '@/components/layout/adminNav'
import { useI18n } from '@/lib/i18n/i18n'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'

export function AdminMapPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const handleLogout = async () => { await supabase.auth.signOut() }

  // `fromMapRoute` hace que cada item apunte a /admin?tab=…, para saltar del
  // mapa a cualquier vista sin pasar por el resumen.
  const navItems = buildAdminNav(t, { fromMapRoute: true })

  return (
    <AppShell
      items={navItems}
      activeId="map"
      onSelect={id => { if (id !== 'map') navigate(`/admin?tab=${id}`) }}
      onLogout={handleLogout}
      badgeLabel={t('admin.badge')}
      title={t(ADMIN_TITLE_KEY.map)}
      subtitle={t(ADMIN_SUBTITLE_KEY.map)}
      fullBleed
      topbarActions={<LanguageSwitcher />}
    >
      <div className="h-full w-full relative">
        <AdminMap />
      </div>
    </AppShell>
  )
}
