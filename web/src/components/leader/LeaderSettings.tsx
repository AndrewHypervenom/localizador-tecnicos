import { useEffect, useState } from 'react'
import { Clock, RefreshCw, Check, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getLeaderScope } from '@/lib/leaderContext'
import { useI18n } from '@/lib/i18n/i18n'

// Zonas horarias comunes en LatAm (ampliable).
const TZ_OPTIONS = [
  'America/Bogota', 'America/Lima', 'America/Mexico_City', 'America/Santiago',
  'America/Argentina/Buenos_Aires', 'America/Caracas', 'America/Guayaquil',
  'America/La_Paz', 'America/Panama', 'America/Costa_Rica',
]

const selectCls =
  'w-full bg-base border border-border-soft rounded-xl px-3 py-2.5 text-sm text-text-primary ' +
  'focus:outline-none focus:ring-2 focus:ring-primary/40 transition-colors'

interface CompanyRow {
  id: string
  name: string
  work_start_hour: number
  work_end_hour: number
  work_skip_weekends: boolean
  work_tz: string
}

export function LeaderSettings() {
  const { t } = useI18n()
  const [companies, setCompanies]   = useState<CompanyRow[]>([])
  const [companyId, setCompanyId]   = useState<string>('')
  const [startHour, setStartHour]   = useState(8)
  const [endHour, setEndHour]       = useState(17)
  const [skipWeekends, setSkipWeekends] = useState(true)
  const [tz, setTz]                 = useState('America/Bogota')
  const [loading, setLoading]       = useState(true)
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [saved, setSaved]           = useState(false)

  // Carga los valores del formulario desde una empresa concreta.
  function applyCompany(c: CompanyRow) {
    setCompanyId(c.id)
    setStartHour(c.work_start_hour ?? 8)
    setEndHour(c.work_end_hour ?? 17)
    setSkipWeekends(c.work_skip_weekends ?? true)
    setTz(c.work_tz ?? 'America/Bogota')
  }

  async function load() {
    setLoading(true); setError(null); setSaved(false)
    try {
      const { companyIds } = await getLeaderScope()
      if (companyIds.length === 0) { setError(t('leaderSettings.noCompany')); return }

      const { data, error } = await supabase
        .from('companies')
        .select('id, name, work_start_hour, work_end_hour, work_skip_weekends, work_tz')
        .in('id', companyIds)
        .order('name')
      if (error) throw error

      const rows = (data ?? []) as CompanyRow[]
      setCompanies(rows)
      if (rows.length) applyCompany(rows[0])
    } catch (err: any) {
      setError(err.message ?? t('leaderSettings.loadError'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleSave() {
    if (!companyId) return
    setSaving(true); setError(null); setSaved(false)
    try {
      const { error } = await supabase
        .from('companies')
        .update({
          work_start_hour: startHour,
          work_end_hour: endHour,
          work_skip_weekends: skipWeekends,
          work_tz: tz,
        })
        .eq('id', companyId)
      if (error) throw error
      // Reflejar el cambio en la lista local.
      setCompanies(prev => prev.map(c => c.id === companyId
        ? { ...c, work_start_hour: startHour, work_end_hour: endHour, work_skip_weekends: skipWeekends, work_tz: tz }
        : c))
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err: any) {
      setError(err.message ?? t('leaderSettings.saveError'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-xl mx-auto p-2 space-y-6">
      <div>
        <h2 className="text-text-primary font-semibold text-base flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary" /> {t('leaderSettings.alertSchedule')}
        </h2>
        <p className="text-text-muted text-xs mt-1">
          {t('leaderSettings.desc')}
        </p>
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/30 text-danger text-sm rounded-xl px-4 py-3">{error}</div>
      )}

      {companyId && (
        <div className="bg-surface border border-border-soft rounded-2xl p-5 space-y-4">
          {companies.length > 1 && (
            <div>
              <label className="block text-xs text-text-muted font-medium mb-1.5">{t('techForm.company')}</label>
              <select
                value={companyId}
                onChange={e => {
                  const c = companies.find(x => x.id === e.target.value)
                  if (c) applyCompany(c)
                }}
                className={selectCls}
              >
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}

          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="block text-xs text-text-muted font-medium mb-1.5">{t('leaderSettings.from')}</label>
              <select value={startHour} onChange={e => setStartHour(Number(e.target.value))} className={selectCls}>
                {Array.from({ length: 25 }, (_, h) => (
                  <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs text-text-muted font-medium mb-1.5">{t('leaderSettings.to')}</label>
              <select value={endHour} onChange={e => setEndHour(Number(e.target.value))} className={selectCls}>
                {Array.from({ length: 25 }, (_, h) => (
                  <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                ))}
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={skipWeekends}
              onChange={e => setSkipWeekends(e.target.checked)}
              className="rounded border-border-soft"
            />
            <span className="text-sm text-text-secondary">{t('leaderSettings.skipWeekends')}</span>
          </label>

          <div>
            <label className="block text-xs text-text-muted font-medium mb-1.5">{t('leaderSettings.timezone')}</label>
            <select value={tz} onChange={e => setTz(e.target.value)} className={selectCls}>
              {TZ_OPTIONS.map(z => <option key={z} value={z}>{z}</option>)}
            </select>
          </div>
        </div>
      )}

      {companyId && (
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-primary hover:bg-primary/90 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors flex items-center gap-2 disabled:opacity-60"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {t('common.save')}
          </button>
          {saved && <span className="text-success text-sm">{t('leaderSettings.saved')}</span>}
          <button onClick={load} className="ml-auto text-text-muted hover:text-text-primary transition-colors" title={t('common.reload')}>
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  )
}
