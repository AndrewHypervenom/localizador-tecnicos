import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { format } from 'date-fns'
import { TrackingMap } from '@/components/map/TrackingMap'
import { TechnicianList } from '@/components/panels/TechnicianList'
import { TechnicianDetail } from '@/components/panels/TechnicianDetail'
import { ZoneDetailPanel } from '@/components/map/ZoneDetailPanel'
import { useRealtimeTechnicians } from '@/hooks/useRealtimeTechnicians'
import { useZones } from '@/hooks/useZones'
import { useZoneEvents } from '@/hooks/useZoneEvents'
import { useTrackingStore } from '@/store/trackingStore'
import { useZonesStore } from '@/store/zonesStore'
import { supabase } from '@/lib/supabase'
import api from '@/lib/api'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n/i18n'
import {
  ChevronRight, ChevronDown, Building2, Eye, EyeOff, X, RefreshCw, Check,
} from 'lucide-react'

interface CompanyOpt { id: string; name: string; count: number }

const ALL = 'all'

// ── Selector de empresa ─────────────────────────────────────────────────────
function CompanySelect({
  companies, selected, totalCount, onSelect, onRefresh,
}: {
  companies: CompanyOpt[]
  selected: string
  totalCount: number
  onSelect: (id: string) => void
  onRefresh: () => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const current = selected === ALL
    ? t('adminMap.allCompanies')
    : companies.find(c => c.id === selected)?.name ?? t('adminMap.company')

  return (
    <div className="px-3 pt-3 pb-2 border-b border-border-soft flex-shrink-0 flex items-center gap-1.5">
      <div className="relative flex-1 min-w-0" ref={ref}>
        <button
          onClick={() => setOpen(v => !v)}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-colors bg-base border border-border-soft text-text-primary hover:bg-surface-raised"
        >
          <Building2 className="w-3.5 h-3.5 text-primary flex-shrink-0" />
          <span className="flex-1 text-left truncate">{current}</span>
          <ChevronDown className={cn('w-3.5 h-3.5 text-text-muted transition-transform flex-shrink-0', open && 'rotate-180')} />
        </button>

        {open && (
          <div className="absolute left-0 right-0 top-full mt-1.5 bg-surface border border-border-soft rounded-xl shadow-2xl py-1 z-[1000] max-h-72 overflow-y-auto">
            <button
              onClick={() => { onSelect(ALL); setOpen(false) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors"
            >
              <span className="flex-1 text-left font-medium">{t('adminMap.allCompanies')}</span>
              <span className="font-mono text-text-muted">{totalCount}</span>
              {selected === ALL && <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
            </button>
            <div className="border-t border-border-soft my-1" />
            {companies.length === 0 ? (
              <p className="px-3 py-2 text-xs text-text-muted">{t('adminMap.noCompanies')}</p>
            ) : (
              companies.map(c => (
                <button
                  key={c.id}
                  onClick={() => { onSelect(c.id); setOpen(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors"
                >
                  <span className="flex-1 text-left truncate">{c.name}</span>
                  <span className="font-mono text-text-muted">{c.count}</span>
                  {selected === c.id && <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
                </button>
              ))
            )}
          </div>
        )}
      </div>
      <button
        onClick={onRefresh}
        title={t('common.refresh')}
        className="p-2 text-text-muted hover:text-text-primary transition-colors rounded-lg hover:bg-surface-raised flex-shrink-0"
      >
        <RefreshCw className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// ── Sidebar: técnicos del scope + estado realtime ───────────────────────────
// Va con key={scopeKey} en el padre: cambiar de empresa lo remonta y vuelve a
// cargar los técnicos del nuevo scope (incl. "todas" = undefined). El mapa NO
// está aquí, así conserva su zoom/centro al cambiar de empresa.
function ScopeSidebar({ scopeIds }: { scopeIds: string[] | undefined }) {
  const { t } = useI18n()
  const today = useMemo(() => format(new Date(), 'yyyy-MM-dd'), [])

  useRealtimeTechnicians(scopeIds)
  useZones(today)
  useZoneEvents(scopeIds)

  const { selectedTechnicianId, selectTechnician, realtimeStatus } = useTrackingStore()

  const realtimeCfg = {
    connecting:   { dot: 'bg-warning animate-pulse', text: 'text-warning',    label: t('realtime.connecting') },
    connected:    { dot: 'bg-success animate-pulse',  text: 'text-success',    label: t('realtime.connected') },
    error:        { dot: 'bg-danger',                 text: 'text-danger',     label: t('realtime.error') },
    disconnected: { dot: 'bg-text-muted',             text: 'text-text-muted', label: t('realtime.disconnected') },
  }[realtimeStatus]

  return (
    <>
      <div className="flex-1 overflow-hidden flex flex-col">
        {selectedTechnicianId ? (
          <div className="flex-1 overflow-y-auto">
            <button
              onClick={() => selectTechnician(null)}
              className="w-full flex items-center gap-1.5 px-3 py-2 text-xs text-text-muted hover:text-text-primary hover:bg-surface-raised transition-colors border-b border-border-soft"
            >
              <ChevronRight className="w-3.5 h-3.5 rotate-180" />
              {t('leaderMap.backToTechs')}
            </button>
            <TechnicianDetail />
          </div>
        ) : (
          <TechnicianList className="flex-1 overflow-hidden" variant="admin" />
        )}
      </div>

      <div className="border-t border-border-soft px-3 py-2 flex items-center gap-2 flex-shrink-0">
        <div className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', realtimeCfg.dot)} />
        <span className={cn('text-xs font-medium', realtimeCfg.text)}>{realtimeCfg.label}</span>
      </div>
    </>
  )
}

// Botón flotante de zonas (mostrar/ocultar)
function ZonesToggle() {
  const { t } = useI18n()
  const { zones, showZones, toggleShowZones } = useZonesStore()
  return (
    <div className="absolute top-4 right-4 z-[500]">
      <button
        onClick={toggleShowZones}
        title={showZones ? t('dashboard.hideZones') : t('dashboard.showZones')}
        className={cn(
          'bg-surface/90 backdrop-blur-sm border border-border-soft rounded-xl px-3 py-2 flex items-center gap-1.5 hover:bg-surface transition-colors shadow-xl text-xs',
          showZones ? 'text-primary' : 'text-text-muted',
        )}
      >
        {showZones ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
        {t('dashboard.zones')} {zones.length > 0 && <span className="font-mono font-bold">{zones.length}</span>}
      </button>
    </div>
  )
}

export function AdminMap() {
  const { t } = useI18n()
  const today = useMemo(() => format(new Date(), 'yyyy-MM-dd'), [])

  const [companies, setCompanies]         = useState<CompanyOpt[]>([])
  const [techByCompany, setTechByCompany] = useState<Record<string, string[]>>({})
  const [allTechIds, setAllTechIds]       = useState<string[]>([])
  const [selected, setSelected]           = useState<string>(ALL)
  const [collapsed, setCollapsed]         = useState(false)

  const { selectedTechnicianId, selectTechnician } = useTrackingStore()
  const { zones, selectedZoneId, selectZone }      = useZonesStore()

  const load = useCallback(async () => {
    const [techsRes, companiesRes] = await Promise.all([
      supabase.from('technicians').select('id, company_id').eq('active', true),
      api.get<{ id: string; name: string }[]>('/api/admin/companies')
        .catch(() => ({ data: [] as { id: string; name: string }[] })),
    ])
    const map: Record<string, string[]> = {}
    const all: string[] = []
    ;(techsRes.data ?? []).forEach((tr: any) => {
      all.push(tr.id)
      if (tr.company_id) (map[tr.company_id] ??= []).push(tr.id)
    })
    setTechByCompany(map)
    setAllTechIds(all)
    setCompanies(
      (companiesRes.data ?? [])
        .map((c: any) => ({ id: c.id, name: c.name, count: map[c.id]?.length ?? 0 }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    )
  }, [])

  useEffect(() => { load() }, [load])

  // 'all' → undefined (modo admin: todos los técnicos). Empresa → sus IDs.
  const scopeIds = selected === ALL ? undefined : (techByCompany[selected] ?? [])
  const scopeKey = selected === ALL ? 'all' : `co:${selected}`

  function handleSelect(id: string) {
    selectTechnician(null)
    setSelected(id)
  }

  return (
    <div className="flex h-full overflow-hidden relative">
      {/* Sidebar */}
      <motion.div
        animate={{ width: collapsed ? 0 : 320 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="flex-shrink-0 bg-surface border-r border-border-soft overflow-hidden"
      >
        <motion.div
          animate={{ opacity: collapsed ? 0 : 1 }}
          transition={{ duration: 0.12 }}
          className="w-[320px] h-full flex flex-col"
        >
          <CompanySelect
            companies={companies}
            selected={selected}
            totalCount={allTechIds.length}
            onSelect={handleSelect}
            onRefresh={load}
          />
          {/* Remontable por scope */}
          <ScopeSidebar key={scopeKey} scopeIds={scopeIds} />
        </motion.div>
      </motion.div>

      {/* Toggle colapsar */}
      <motion.button
        animate={{ left: collapsed ? 0 : 320 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        onClick={() => setCollapsed(v => !v)}
        title={collapsed ? t('dashboard.showPanel') : t('dashboard.hidePanel')}
        className="absolute top-1/2 -translate-y-1/2 z-[500] group"
      >
        <div className={cn(
          'flex items-center justify-center px-[5px] py-7 rounded-r-xl',
          'bg-surface border border-l-0 border-border-soft shadow-md',
          'group-hover:bg-primary/5 group-hover:border-primary/30 transition-colors duration-200',
        )}>
          <motion.div animate={{ rotate: collapsed ? 0 : 180 }} transition={{ type: 'spring', stiffness: 300, damping: 30 }}>
            <ChevronRight className="w-4 h-4 text-text-muted group-hover:text-primary transition-colors duration-200" />
          </motion.div>
        </div>
      </motion.button>

      {/* Mapa — persistente (no se remonta al cambiar de empresa) */}
      <div className="flex-1 relative min-w-0">
        <TrackingMap className="h-full w-full" date={today} />

        <AnimatePresence>
          {selectedTechnicianId && (
            <motion.button
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              onClick={() => selectTechnician(null)}
              className="absolute top-4 left-4 z-[500] flex items-center gap-2 bg-surface/95 backdrop-blur-sm border border-border-soft rounded-xl px-3 py-2 shadow-xl text-xs text-text-secondary hover:text-danger hover:border-danger/40 hover:bg-danger/5 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              {t('leaderMap.clearSelection')}
            </motion.button>
          )}
        </AnimatePresence>

        <ZonesToggle />

        <AnimatePresence>
          {selectedZoneId && (() => {
            const zone = zones.find(z => z.id === selectedZoneId)
            return zone ? (
              <div className="absolute bottom-4 left-4 z-[500]">
                <ZoneDetailPanel zone={zone} onClose={() => selectZone(null)} />
              </div>
            ) : null
          })()}
        </AnimatePresence>
      </div>
    </div>
  )
}
