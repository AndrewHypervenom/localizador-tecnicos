import { useState, useCallback, useRef, useEffect } from 'react'
import { read, utils } from 'xlsx'
import {
  Upload, FileSpreadsheet, X, Check, AlertTriangle,
  ChevronDown, ChevronRight, Building2, FolderOpen,
  Loader2, UserPlus, Link2, Users, MapPin, CheckCircle2, Navigation,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { format, addDays } from 'date-fns'
import { es } from 'date-fns/locale'
import { toast } from 'sonner'
import { DateScroller, getWeekStart } from './DateScroller'
import { COUNTRIES, CITIES_BY_COUNTRY } from '@/lib/geo'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ParsedRow {
  otp: string; oth: string; ot_mer: string; estado_ot: string
  item_facturacion: string; franja: string; ciudad: string
  cliente: string; direccion: string; producto: string
  fecha_inicial: string | null; hora_inicial: string | null
  pim: string; cedula: string; phone: string | null
}

interface TechGroup {
  pim: string; cedula: string; phone: string | null; items: ParsedRow[]
  expanded: boolean; matchedTechId: string | null
}

interface Company  { id: string; name: string }
interface Campaign { id: string; name: string; company_id: string; is_active: boolean }

type UploadStep = 'idle' | 'preview' | 'saving' | 'done'

// ── Helpers ───────────────────────────────────────────────────────────────────

function excelDate(v: any): string | null {
  if (!v && v !== 0) return null
  if (v instanceof Date) return format(v, 'yyyy-MM-dd')
  if (typeof v === 'number') return format(new Date((v - 25569) * 86400 * 1000), 'yyyy-MM-dd')
  return String(v)
}
function excelTime(v: any): string | null {
  if (!v && v !== 0) return null
  if (v instanceof Date) return format(v, 'HH:mm')
  if (typeof v === 'number') {
    const mins = Math.round(v * 24 * 60)
    return `${String(Math.floor(mins / 60) % 24).padStart(2,'0')}:${String(mins % 60).padStart(2,'0')}`
  }
  return String(v)
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase()
}

const inp = cn(
  'w-full bg-base border border-border-soft rounded-xl px-3 py-2.5 text-sm text-text-primary',
  'placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors'
)

// ── Campaign selector ─────────────────────────────────────────────────────────

function CampaignSelector({
  companies, campaigns,
  selectedCampaignId, onSelect,
  onCampaignsChange,
}: {
  companies: Company[]
  campaigns: Campaign[]
  selectedCampaignId: string
  onSelect: (id: string) => void
  onCampaignsChange: () => void
}) {
  const [addingCompany, setAddingCompany]   = useState(false)
  const [addingCampaign, setAddingCampaign] = useState(false)
  const [companyName, setCompanyName]       = useState('')
  const [campaignName, setCampaignName]     = useState('')
  const [selectedCompanyForNew, setForNew]  = useState(companies[0]?.id ?? '')
  const [saving, setSaving]                 = useState(false)

  useEffect(() => {
    if (companies.length && !selectedCompanyForNew) setForNew(companies[0].id)
  }, [companies])

  async function createCompany() {
    if (!companyName.trim()) return
    setSaving(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const { error } = await supabase.from('companies').insert({ name: companyName.trim(), created_by: session?.user.id })
      if (error) throw error
      setCompanyName(''); setAddingCompany(false)
      onCampaignsChange()
      toast.success('Empresa creada')
    } catch (e: any) { toast.error(e.message) }
    finally { setSaving(false) }
  }

  async function createCampaign() {
    if (!campaignName.trim() || !selectedCompanyForNew) return
    setSaving(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const { data, error } = await supabase.from('campaigns').insert({
        name: campaignName.trim(), company_id: selectedCompanyForNew,
        is_active: true, created_by: session?.user.id,
      }).select('id').single()
      if (error) throw error
      setCampaignName(''); setAddingCampaign(false)
      onCampaignsChange()
      onSelect(data.id)
      toast.success('Campaña creada')
    } catch (e: any) { toast.error(e.message) }
    finally { setSaving(false) }
  }

  const grouped = companies.map(c => ({
    company: c,
    items: campaigns.filter(cp => cp.company_id === c.id),
  })).filter(g => g.items.length > 0)

  const selected = campaigns.find(c => c.id === selectedCampaignId)
  const company  = selected ? companies.find(c => c.id === selected.company_id) : null

  return (
    <div className="bg-surface border border-border-soft rounded-2xl p-4 space-y-3 h-full">
      <div className="flex items-center justify-between">
        <label className="text-xs text-text-muted uppercase tracking-wider font-medium">
          Campaña
        </label>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => { setAddingCampaign(v => !v); setAddingCompany(false) }}
            className={cn('flex items-center gap-1 text-xs px-2 py-1 rounded-lg border transition-colors',
              addingCampaign
                ? 'bg-primary/10 text-primary border-primary/30'
                : 'border-border-soft text-text-muted hover:text-text-primary hover:bg-surface-raised'
            )}
          >
            <FolderOpen className="w-3 h-3" /> Nueva
          </button>
          <button
            type="button"
            onClick={() => { setAddingCompany(v => !v); setAddingCampaign(false) }}
            className={cn('flex items-center gap-1 text-xs px-2 py-1 rounded-lg border transition-colors',
              addingCompany
                ? 'bg-primary/10 text-primary border-primary/30'
                : 'border-border-soft text-text-muted hover:text-text-primary hover:bg-surface-raised'
            )}
          >
            <Building2 className="w-3 h-3" /> Empresa
          </button>
        </div>
      </div>

      {addingCompany && (
        <div className="bg-base border border-border-soft rounded-xl p-3 space-y-2">
          <p className="text-xs text-text-muted font-medium">Nueva empresa</p>
          <div className="flex gap-2">
            <input type="text" value={companyName} onChange={e => setCompanyName(e.target.value)}
              placeholder="Nombre de la empresa" className={cn(inp, 'flex-1 py-2')}
              onKeyDown={e => e.key === 'Enter' && createCompany()} autoFocus />
            <button type="button" onClick={createCompany} disabled={!companyName.trim() || saving}
              className="px-3 py-2 bg-primary hover:bg-primary/90 text-white text-xs rounded-xl transition-colors disabled:opacity-50 flex items-center gap-1">
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Crear
            </button>
          </div>
        </div>
      )}

      {addingCampaign && (
        <div className="bg-base border border-border-soft rounded-xl p-3 space-y-2">
          <p className="text-xs text-text-muted font-medium">Nueva campaña</p>
          <div className="flex gap-2">
            <select value={selectedCompanyForNew} onChange={e => setForNew(e.target.value)}
              className={cn(inp, 'py-2 w-auto text-xs')}>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input type="text" value={campaignName} onChange={e => setCampaignName(e.target.value)}
              placeholder="Nombre de la campaña" className={cn(inp, 'flex-1 py-2')}
              onKeyDown={e => e.key === 'Enter' && createCampaign()} autoFocus />
            <button type="button" onClick={createCampaign} disabled={!campaignName.trim() || !selectedCompanyForNew || saving}
              className="px-3 py-2 bg-primary hover:bg-primary/90 text-white text-xs rounded-xl transition-colors disabled:opacity-50 flex items-center gap-1">
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Crear
            </button>
          </div>
        </div>
      )}

      {companies.length === 0 ? (
        <p className="text-text-muted text-xs py-2">Crea una empresa primero.</p>
      ) : campaigns.length === 0 ? (
        <p className="text-text-muted text-xs py-2">Crea una campaña para organizar tus rutas.</p>
      ) : (
        <div className="relative">
          <select value={selectedCampaignId} onChange={e => onSelect(e.target.value)}
            className={cn(inp, 'pr-8 appearance-none')}>
            <option value="">— Sin campaña asignada —</option>
            {grouped.map(g => (
              <optgroup key={g.company.id} label={g.company.name}>
                {g.items.map(cp => (
                  <option key={cp.id} value={cp.id}>{cp.name}{!cp.is_active ? ' (inactiva)' : ''}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
        </div>
      )}

      {selected && company && (
        <div className="flex items-center gap-2 py-1 px-3 rounded-xl bg-primary/5 border border-primary/15">
          <Building2 className="w-3 h-3 text-text-muted flex-shrink-0" />
          <span className="text-text-muted text-xs truncate">{company.name}</span>
          <span className="text-border-soft">·</span>
          <FolderOpen className="w-3 h-3 text-primary flex-shrink-0" />
          <span className="text-primary text-xs font-semibold truncate">{selected.name}</span>
        </div>
      )}
    </div>
  )
}

// ── Unmatched tech row ────────────────────────────────────────────────────────

function UnmatchedTechRow({
  pim, cedula, phone: initialPhone, companies, campaigns, onLinked,
}: {
  pim: string; cedula: string; phone: string | null
  companies: Company[]; campaigns: Campaign[]
  onLinked: (techId: string) => void
}) {
  const [open, setOpen]       = useState(false)
  const [phone, setPhone]     = useState(initialPhone ?? '')
  const [country, setCountry] = useState('')
  const [city, setCity]       = useState('')
  const [campaignId, setCamp] = useState(campaigns.find(c => c.is_active)?.id ?? '')
  const [saving, setSaving]   = useState(false)
  const [done, setDone]       = useState(false)

  const phoneFromExcel = !!initialPhone
  const cityOptions = country ? (CITIES_BY_COUNTRY[country] ?? []) : []

  function handleCountryChange(val: string) {
    setCountry(val)
    const valid = CITIES_BY_COUNTRY[val] ?? []
    if (city && !valid.includes(city)) setCity('')
  }

  async function handleCreate() {
    setSaving(true)
    try {
      const camp = campaigns.find(c => c.id === campaignId)
      const comp = camp ? companies.find(co => co.id === camp.company_id) : undefined
      const { data, error } = await supabase
        .from('technicians')
        .insert({
          name: pim, phone: phone || null,
          client: comp?.name ?? null, project: camp?.name ?? null,
          company_id: comp?.id ?? null,
          country: country || null, city: city || null,
          active: true,
        })
        .select('id').single()
      if (error) throw error
      onLinked(data.id)
      setDone(true)
      toast.success(`${pim} registrado`)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (done) return (
    <div className="flex items-center gap-3 px-4 py-3.5 bg-success/5 border border-success/20 rounded-2xl">
      <div className="w-10 h-10 rounded-xl bg-success/15 flex items-center justify-center flex-shrink-0">
        <Check className="w-5 h-5 text-success" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-success font-semibold text-sm truncate">{pim}</p>
        <p className="text-success/70 text-xs">Registrado y vinculado</p>
      </div>
    </div>
  )

  return (
    <div className="border border-warning/25 rounded-2xl overflow-hidden bg-warning/[0.02]">
      <div
        className="flex items-center gap-3 px-4 py-3.5 cursor-pointer hover:bg-warning/5 transition-colors select-none"
        onClick={() => setOpen(v => !v)}
      >
        <div className="w-10 h-10 rounded-xl bg-warning/15 flex items-center justify-center flex-shrink-0">
          <span className="text-warning text-sm font-bold">{initials(pim)}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-text-primary font-semibold text-sm truncate">{pim}</p>
          <div className="flex items-center gap-2 flex-wrap mt-0.5">
            {cedula && <span className="text-text-muted text-xs">CC {cedula}</span>}
            {initialPhone && <span className="text-text-muted text-xs">· {initialPhone}</span>}
          </div>
        </div>
        <span className="hidden sm:inline text-warning text-xs font-medium bg-warning/10 px-2.5 py-1 rounded-full border border-warning/20 flex-shrink-0">
          Sin cuenta
        </span>
        <button
          type="button"
          onClick={e => { e.stopPropagation(); setOpen(v => !v) }}
          className={cn(
            'flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl transition-colors flex-shrink-0',
            open
              ? 'bg-surface-raised text-text-muted'
              : 'bg-primary text-white hover:bg-primary/90'
          )}
        >
          {open
            ? <ChevronDown className="w-3.5 h-3.5" />
            : <><UserPlus className="w-3.5 h-3.5" /> Registrar</>
          }
        </button>
      </div>

      {open && (
        <div className="border-t border-warning/20 bg-base/70 p-4 space-y-3">
          <p className="text-text-muted text-xs">Revisa los datos y registra este técnico en el sistema:</p>

          {/* Datos del Excel (solo lectura) */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-base border border-border-soft rounded-xl px-3 py-2">
              <p className="text-text-muted/70 text-xs mb-0.5">Nombre</p>
              <p className="text-text-primary text-xs font-semibold truncate">{pim}</p>
            </div>
            <div className="bg-base border border-border-soft rounded-xl px-3 py-2">
              <p className="text-text-muted/70 text-xs mb-0.5">Cédula</p>
              <p className="text-text-primary text-xs font-semibold">{cedula || '—'}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs text-text-muted font-medium flex items-center gap-1.5">
                Teléfono
                {phoneFromExcel && (
                  <span className="text-success text-xs bg-success/10 px-1.5 py-0.5 rounded border border-success/20">del Excel</span>
                )}
                {!phoneFromExcel && <span className="text-text-muted/50">(opcional)</span>}
              </label>
              <input
                type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                placeholder="3XX XXX XXXX" className={inp} autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-text-muted font-medium">Campaña</label>
              <select value={campaignId} onChange={e => setCamp(e.target.value)}
                className={cn(inp, 'appearance-none')}>
                <option value="">— Seleccionar campaña —</option>
                {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-text-muted font-medium flex items-center gap-1.5">
                <MapPin className="w-3 h-3" /> País
              </label>
              <select value={country} onChange={e => handleCountryChange(e.target.value)}
                className={cn(inp, 'appearance-none')}>
                <option value="">— Sin especificar —</option>
                {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-text-muted font-medium flex items-center gap-1.5">
                <Navigation className="w-3 h-3" /> Ciudad
              </label>
              <select
                value={city} onChange={e => setCity(e.target.value)}
                disabled={!country}
                className={cn(inp, 'appearance-none', !country && 'opacity-40 cursor-not-allowed')}
              >
                <option value="">{country ? '— Seleccionar ciudad —' : '— Selecciona país primero —'}</option>
                {cityOptions.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={handleCreate} disabled={saving}
              className="flex-1 bg-primary hover:bg-primary/90 text-white text-sm font-bold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              Registrar técnico
            </button>
            <button type="button" onClick={() => setOpen(false)}
              className="px-4 py-2.5 border border-border-soft text-text-muted text-sm rounded-xl hover:bg-surface-raised transition-colors">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function RouteUpload({ onUploaded }: { onUploaded: () => void }) {
  const [step, setStep]             = useState<UploadStep>('idle')
  const [dragOver, setDragOver]     = useState(false)
  const [fileName, setFileName]     = useState('')
  const [routeDate, setRouteDate]   = useState(format(addDays(new Date(), 1), 'yyyy-MM-dd'))
  const [weekStart, setWeekStart]   = useState(getWeekStart(format(addDays(new Date(), 1), 'yyyy-MM-dd')))
  const [groups, setGroups]         = useState<TechGroup[]>([])
  const [saveProgress, setSaveProgress] = useState(0)
  const [companies, setCompanies]   = useState<Company[]>([])
  const [campaigns, setCampaigns]   = useState<Campaign[]>([])
  const [campaignId, setCampaignId] = useState('')
  const [unmatchedOpen, setUnmatchedOpen] = useState(true)
  const fileRef = useRef<HTMLInputElement>(null)

  async function loadCampaigns() {
    const [{ data: cos }, { data: cps }] = await Promise.all([
      supabase.from('companies').select('id, name').order('name'),
      supabase.from('campaigns').select('id, name, company_id, is_active').order('name'),
    ])
    setCompanies(cos ?? [])
    setCampaigns(cps ?? [])
    if (!campaignId && cps?.length) {
      const active = cps.find(c => c.is_active)
      if (active) setCampaignId(active.id)
    }
  }

  useEffect(() => { loadCampaigns() }, [])

  function handleDateChange(d: string) {
    setRouteDate(d)
    setWeekStart(getWeekStart(d))
  }

  const parseFile = useCallback(async (file: File) => {
    setFileName(file.name)
    try {
      const buf = await file.arrayBuffer()
      const wb = read(buf, { type: 'array', cellDates: true })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows: any[][] = utils.sheet_to_json(ws, { header: 1 })
      const dataRows = rows.slice(1).filter(r => r.length >= 13 && r[12])

      const parsed: ParsedRow[] = dataRows.map(r => ({
        otp: String(r[0] ?? ''), oth: String(r[1] ?? ''), ot_mer: String(r[2] ?? ''),
        estado_ot: String(r[3] ?? ''), item_facturacion: String(r[4] ?? ''),
        franja: String(r[5] ?? ''), ciudad: String(r[6] ?? ''),
        cliente: String(r[7] ?? ''), direccion: String(r[8] ?? ''),
        producto: String(r[9] ?? ''),
        fecha_inicial: excelDate(r[10]), hora_inicial: excelTime(r[11]),
        pim: String(r[12] ?? '').trim(), cedula: String(r[13] ?? '').trim(),
        phone: r[14] ? String(r[14]).trim() || null : null,
      }))

      const groupMap = new Map<string, ParsedRow[]>()
      for (const row of parsed) {
        const key = `${row.pim}||${row.cedula}`
        if (!groupMap.has(key)) groupMap.set(key, [])
        groupMap.get(key)!.push(row)
      }

      const { data: allTechs } = await supabase.from('technicians').select('id, name').eq('active', true)
      const nameToId = new Map<string, string>()
      for (const t of allTechs ?? []) nameToId.set(t.name.trim().toUpperCase(), t.id)

      const newGroups: TechGroup[] = []
      for (const [key, items] of groupMap) {
        const [pim, cedula] = key.split('||')
        const phone = items.find(i => i.phone)?.phone ?? null
        newGroups.push({ pim, cedula, phone, items, expanded: false, matchedTechId: nameToId.get(pim.toUpperCase()) ?? null })
      }
      setGroups(newGroups)
      setStep('preview')
    } catch (err: any) {
      toast.error('Error al leer el archivo: ' + (err.message ?? 'Formato inválido'))
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) parseFile(file)
  }, [parseFile])

  const removeGroup = (idx: number) => setGroups(prev => prev.filter((_, i) => i !== idx))
  const removeItem  = (gi: number, ii: number) =>
    setGroups(prev => prev.map((g, i) => i !== gi ? g : { ...g, items: g.items.filter((_, j) => j !== ii) }).filter(g => g.items.length > 0))
  const toggle = (idx: number) =>
    setGroups(prev => prev.map((g, i) => i === idx ? { ...g, expanded: !g.expanded } : g))
  const linkTech = (gi: number, techId: string) =>
    setGroups(prev => prev.map((g, i) => i === gi ? { ...g, matchedTechId: techId } : g))

  async function handleSave() {
    setStep('saving'); setSaveProgress(0)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const userId = session?.user?.id

      const { data: existing } = await supabase.from('technician_routes').select('id').eq('route_date', routeDate)
      if (existing?.length) await supabase.from('technician_routes').delete().in('id', existing.map(e => e.id))

      for (let i = 0; i < groups.length; i++) {
        const g = groups[i]
        const { data: routeRow, error: re } = await supabase.from('technician_routes').insert({
          route_date: routeDate, technician_name: g.pim, technician_cedula: g.cedula || null,
          technician_id: g.matchedTechId, campaign_id: campaignId || null, uploaded_by: userId,
        }).select('id').single()
        if (re) throw re

        const { error: ie } = await supabase.from('route_items').insert(
          g.items.map((item, idx) => ({
            route_id: routeRow.id, otp: item.otp || null, oth: item.oth || null,
            ot_mer: item.ot_mer || null, estado_ot: item.estado_ot || null,
            item_facturacion: item.item_facturacion || null, franja: item.franja || null,
            ciudad: item.ciudad || null, cliente: item.cliente || null,
            direccion: item.direccion || null, producto: item.producto || null,
            fecha_inicial: item.fecha_inicial, hora_inicial: item.hora_inicial,
            order_index: idx, status: 'pending',
          }))
        )
        if (ie) throw ie
        setSaveProgress(Math.round(((i + 1) / groups.length) * 100))
      }

      setStep('done')
      toast.success(`Rutas del ${format(new Date(routeDate + 'T12:00:00'), "d 'de' MMMM", { locale: es })} cargadas`)
    } catch (err: any) {
      toast.error('Error al guardar: ' + (err.message ?? 'Error desconocido'))
      setStep('preview')
    }
  }

  const totalItems = groups.reduce((s, g) => s + g.items.length, 0)
  const totalAM    = groups.reduce((s, g) => s + g.items.filter(i => i.franja === 'AM').length, 0)
  const totalPM    = groups.reduce((s, g) => s + g.items.filter(i => i.franja === 'PM').length, 0)
  const unmatched  = groups.filter(g => !g.matchedTechId)

  // ── Done ──────────────────────────────────────────────────────────────────────
  if (step === 'done') return (
    <div className="flex flex-col items-center justify-center py-24 gap-6">
      <div className="w-24 h-24 rounded-full bg-success/10 border-2 border-success/30 flex items-center justify-center">
        <Check className="w-12 h-12 text-success" />
      </div>
      <div className="text-center">
        <h2 className="text-text-primary font-black text-2xl">¡Rutas cargadas!</h2>
        <p className="text-text-muted text-sm mt-2">
          {groups.length} técnicos · {totalItems} instalaciones
        </p>
        <p className="text-text-muted text-sm capitalize">
          {format(new Date(routeDate + 'T12:00:00'), "EEEE d 'de' MMMM", { locale: es })}
        </p>
      </div>
      <div className="flex gap-3">
        <button
          onClick={() => { setStep('idle'); setGroups([]); setFileName('') }}
          className="px-5 py-2.5 border border-border-soft text-text-muted hover:text-text-primary text-sm rounded-xl transition-colors hover:bg-surface-raised"
        >
          Cargar otro archivo
        </button>
        <button onClick={onUploaded}
          className="px-6 py-2.5 bg-primary hover:bg-primary/90 text-white font-bold text-sm rounded-xl transition-colors">
          Ver rutas cargadas
        </button>
      </div>
    </div>
  )

  // ── Saving ────────────────────────────────────────────────────────────────────
  if (step === 'saving') return (
    <div className="flex flex-col items-center justify-center py-24 gap-5">
      <div className="w-14 h-14 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      <div className="text-center">
        <p className="text-text-primary font-semibold">Guardando rutas…</p>
        <p className="text-text-muted text-xs mt-1">No cierres esta página</p>
      </div>
      <div className="w-72 bg-surface border border-border-soft rounded-full h-3 overflow-hidden">
        <div className="h-full bg-primary transition-all duration-300 rounded-full" style={{ width: `${saveProgress}%` }} />
      </div>
      <p className="text-primary text-sm font-bold">{saveProgress}%</p>
    </div>
  )

  // ── Preview ───────────────────────────────────────────────────────────────────
  if (step === 'preview') return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="w-11 h-11 rounded-2xl bg-primary/10 flex items-center justify-center flex-shrink-0">
          <FileSpreadsheet className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-text-primary font-black text-xl leading-tight">Revisar rutas</h2>
          <p className="text-text-muted text-xs truncate mt-0.5">{fileName}</p>
        </div>
        <button
          onClick={() => { setStep('idle'); setGroups([]); setFileName('') }}
          className="text-text-muted hover:text-danger transition-colors p-2.5 rounded-xl hover:bg-danger/10 flex-shrink-0"
          title="Cancelar"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Stats hero */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {([
          { label: 'Técnicos',      value: groups.length, sub: 'en el Excel',   cls: 'text-text-primary', bg: 'bg-surface border-border-soft'    },
          { label: 'Instalaciones', value: totalItems,    sub: 'en total',      cls: 'text-text-primary', bg: 'bg-surface border-border-soft'    },
          { label: 'Franja AM',     value: totalAM,       sub: 'por la mañana', cls: 'text-warning',      bg: 'bg-warning/5 border-warning/20'   },
          { label: 'Franja PM',     value: totalPM,       sub: 'por la tarde',  cls: 'text-primary',      bg: 'bg-primary/5 border-primary/20'   },
        ] as const).map(s => (
          <div key={s.label} className={cn('border rounded-2xl p-4 sm:p-5', s.bg)}>
            <p className={cn('text-4xl sm:text-5xl font-black tracking-tight leading-none', s.cls)}>{s.value}</p>
            <p className="text-text-primary text-sm font-semibold mt-2">{s.label}</p>
            <p className="text-text-muted text-xs">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Config: Campaign + Date */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CampaignSelector
          companies={companies} campaigns={campaigns}
          selectedCampaignId={campaignId} onSelect={setCampaignId}
          onCampaignsChange={loadCampaigns}
        />
        <div className="bg-surface border border-border-soft rounded-2xl p-4 space-y-3">
          <p className="text-xs text-text-muted uppercase tracking-wider font-medium">Fecha de las rutas</p>
          <DateScroller
            selected={routeDate} onChange={handleDateChange}
            weekStart={weekStart} onWeekChange={s => setWeekStart(s)}
          />
          <div className="flex items-center gap-2">
            <button onClick={() => handleDateChange(format(new Date(), 'yyyy-MM-dd'))}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                routeDate === format(new Date(), 'yyyy-MM-dd')
                  ? 'bg-primary text-white border-primary'
                  : 'border-border-soft text-text-muted hover:text-text-primary hover:bg-surface-raised'
              )}>Hoy</button>
            <button onClick={() => handleDateChange(format(addDays(new Date(), 1), 'yyyy-MM-dd'))}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                routeDate === format(addDays(new Date(), 1), 'yyyy-MM-dd')
                  ? 'bg-primary text-white border-primary'
                  : 'border-border-soft text-text-muted hover:text-text-primary hover:bg-surface-raised'
              )}>Mañana</button>
            <span className="ml-auto text-text-muted text-xs capitalize">
              {format(new Date(routeDate + 'T12:00:00'), "EEEE d 'de' MMMM", { locale: es })}
            </span>
          </div>
        </div>
      </div>

      {/* Unmatched warning panel */}
      {unmatched.length > 0 && (
        <div className="border border-warning/30 rounded-2xl overflow-hidden bg-warning/[0.03]">
          <button
            type="button"
            onClick={() => setUnmatchedOpen(v => !v)}
            className="w-full flex items-center gap-3 px-5 py-4 hover:bg-warning/5 transition-colors text-left"
          >
            <div className="w-9 h-9 rounded-xl bg-warning/15 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-4 h-4 text-warning" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-text-primary font-bold text-sm">
                {unmatched.length} técnico{unmatched.length !== 1 ? 's' : ''} sin cuenta
              </p>
              <p className="text-text-muted text-xs mt-0.5">
                {unmatchedOpen ? 'Regístralos para vincularlos a sus rutas' : 'Expande para registrarlos ahora'}
              </p>
            </div>
            <span className="bg-warning text-white text-xs font-black px-2.5 py-1 rounded-full flex-shrink-0">
              {unmatched.length}
            </span>
            {unmatchedOpen
              ? <ChevronDown className="w-4 h-4 text-text-muted flex-shrink-0" />
              : <ChevronRight className="w-4 h-4 text-text-muted flex-shrink-0" />
            }
          </button>
          {unmatchedOpen && (
            <div className="border-t border-warning/20 p-3 space-y-2">
              {unmatched.map((g) => {
                const realIdx = groups.findIndex(gr => gr.pim === g.pim && gr.cedula === g.cedula)
                return (
                  <UnmatchedTechRow
                    key={`${g.pim}||${g.cedula}`}
                    pim={g.pim} cedula={g.cedula} phone={g.phone}
                    companies={companies} campaigns={campaigns}
                    onLinked={(techId) => linkTech(realIdx, techId)}
                  />
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Technicians list */}
      <div className="bg-surface border border-border-soft rounded-2xl overflow-hidden">
        {/* Card header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-soft">
          <div className="flex items-center gap-2.5">
            <Users className="w-4 h-4 text-text-muted" />
            <h3 className="text-text-primary font-bold text-sm">
              {groups.length} técnico{groups.length !== 1 ? 's' : ''}
            </h3>
            <span className="text-text-muted text-xs">· {totalItems} instalaciones</span>
          </div>
          {unmatched.length === 0 ? (
            <span className="flex items-center gap-1.5 text-xs text-success font-medium bg-success/10 px-2.5 py-1 rounded-full">
              <CheckCircle2 className="w-3.5 h-3.5" /> Todos vinculados
            </span>
          ) : (
            <span className="text-xs text-warning font-medium bg-warning/10 px-2.5 py-1 rounded-full">
              {groups.length - unmatched.length} de {groups.length} vinculados
            </span>
          )}
        </div>

        {/* Scrollable list */}
        <div className="divide-y divide-border-soft">
          {groups.map((g, gi) => (
            <div key={gi}>
              <div
                className="flex items-center gap-3 px-5 py-4 cursor-pointer select-none hover:bg-surface-raised transition-colors"
                onClick={() => toggle(gi)}
              >
                {/* Initials avatar */}
                <div className={cn(
                  'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 font-bold text-sm',
                  g.matchedTechId ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'
                )}>
                  {initials(g.pim)}
                </div>

                {/* Name + cedula */}
                <div className="flex-1 min-w-0">
                  <p className="text-text-primary font-semibold text-sm truncate">{g.pim}</p>
                  <p className="text-text-muted text-xs mt-0.5">
                    {g.cedula ? `CC ${g.cedula}` : 'Sin cédula'}
                  </p>
                </div>

                {/* Badges */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {g.items.filter(i => i.franja === 'AM').length > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-warning/10 text-warning border border-warning/20 font-medium">
                      {g.items.filter(i => i.franja === 'AM').length} AM
                    </span>
                  )}
                  {g.items.filter(i => i.franja === 'PM').length > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium">
                      {g.items.filter(i => i.franja === 'PM').length} PM
                    </span>
                  )}
                  {g.matchedTechId && (
                    <span title="Vinculado al sistema">
                      <Link2 className="w-3.5 h-3.5 text-success" />
                    </span>
                  )}
                </div>

                {/* Expand chevron */}
                {g.expanded
                  ? <ChevronDown className="w-4 h-4 text-text-muted flex-shrink-0" />
                  : <ChevronRight className="w-4 h-4 text-text-muted flex-shrink-0" />
                }

                {/* Remove */}
                <button type="button" onClick={e => { e.stopPropagation(); removeGroup(gi) }}
                  className="p-1.5 text-text-muted hover:text-danger transition-colors rounded-lg hover:bg-danger/10 flex-shrink-0">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {g.expanded && (
                <div className="border-t border-border-soft divide-y divide-border-soft bg-base/40">
                  {g.items.map((item, ii) => (
                    <div key={ii} className="flex items-start gap-3 pl-[72px] pr-5 py-3 text-xs">
                      <span className={cn(
                        'mt-0.5 px-2 py-0.5 rounded-lg text-xs font-bold flex-shrink-0',
                        item.franja === 'AM' ? 'bg-warning/10 text-warning' : 'bg-primary/10 text-primary'
                      )}>
                        {item.franja || '—'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-text-primary font-semibold truncate">{item.cliente || '—'}</p>
                        <p className="text-text-muted truncate mt-0.5">{item.direccion || '—'}</p>
                        {item.producto && <p className="text-text-muted/60 mt-0.5">{item.producto}</p>}
                      </div>
                      <div className="flex-shrink-0 text-right space-y-0.5">
                        {item.hora_inicial && (
                          <p className="text-text-muted font-medium">{item.hora_inicial}</p>
                        )}
                      </div>
                      <button type="button" onClick={() => removeItem(gi, ii)}
                        className="p-1 text-text-muted hover:text-danger transition-colors rounded flex-shrink-0 mt-0.5">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Sticky footer */}
      <div className="sticky bottom-0 z-30 bg-base/95 backdrop-blur-sm border-t border-border-soft px-4 py-3 -mx-4">
        {unmatched.length > 0 && (
          <div className="max-w-7xl mx-auto mb-2">
            <div className="flex items-center gap-2 bg-danger/10 border border-danger/30 rounded-xl px-4 py-2">
              <AlertTriangle className="w-4 h-4 text-danger flex-shrink-0" />
              <p className="text-danger text-xs font-semibold">
                No se puede guardar: {unmatched.length} técnico{unmatched.length !== 1 ? 's' : ''} sin registrar.
                Regístralos arriba antes de continuar.
              </p>
            </div>
          </div>
        )}
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div>
            <p className="text-text-primary text-sm font-bold">
              {groups.length} ruta{groups.length !== 1 ? 's' : ''} · {totalItems} instalaciones
            </p>
            <p className="text-text-muted text-xs capitalize">
              {format(new Date(routeDate + 'T12:00:00'), "EEEE d 'de' MMMM", { locale: es })}
            </p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => { setStep('idle'); setGroups([]); setFileName('') }}
              className="px-4 py-2.5 border border-border-soft text-text-muted hover:text-text-primary text-sm rounded-xl transition-colors hover:bg-surface-raised">
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={groups.length === 0 || unmatched.length > 0}
              title={unmatched.length > 0 ? `Registra los ${unmatched.length} técnicos pendientes primero` : undefined}
              className="px-6 py-2.5 bg-primary hover:bg-primary/90 text-white font-bold text-sm rounded-xl transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-primary/20"
            >
              <Upload className="w-4 h-4" />
              Guardar {groups.length} ruta{groups.length !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  // ── Idle ──────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-text-primary font-black text-xl">Cargar Rutas</h2>
        <p className="text-text-muted text-sm mt-1">Carga el Excel con las asignaciones del día.</p>
      </div>

      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        className={cn(
          'border-2 border-dashed rounded-3xl p-16 flex flex-col items-center gap-6 cursor-pointer transition-all duration-200',
          dragOver ? 'border-primary bg-primary/5 scale-[1.01]' : 'border-border hover:border-primary/40 hover:bg-surface'
        )}
      >
        <div className={cn('w-24 h-24 rounded-3xl flex items-center justify-center transition-colors', dragOver ? 'bg-primary/10' : 'bg-surface')}>
          <FileSpreadsheet className={cn('w-12 h-12 transition-colors', dragOver ? 'text-primary' : 'text-text-muted')} />
        </div>
        <div className="text-center">
          <p className={cn('font-black text-2xl', dragOver ? 'text-primary' : 'text-text-primary')}>
            {dragOver ? 'Suelta el archivo aquí' : 'Arrastra tu Excel aquí'}
          </p>
          <p className="text-text-muted text-base mt-2">o haz clic para seleccionar</p>
        </div>
        <span className="bg-surface border border-border-soft rounded-xl px-5 py-2 text-sm text-text-muted font-medium">
          Acepta .xlsx y .xls
        </span>
      </div>

      <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) parseFile(f) }} />

      {/* Format reference */}
      <div className="bg-surface border border-border-soft rounded-2xl p-5">
        <h3 className="text-text-primary font-bold mb-3">Formato esperado del Excel</h3>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {[
            { col: 'OTP', key: true }, { col: 'OTH', key: false }, { col: 'OT MER', key: false },
            { col: 'ESTADO OT', key: false }, { col: 'ITEM FAC.', key: false }, { col: 'FRANJA', key: false },
            { col: 'CIUDAD', key: false }, { col: 'CLIENTE', key: false }, { col: 'DIRECCIÓN', key: false },
            { col: 'PRODUCTO', key: false }, { col: 'FECHA', key: false }, { col: 'HORA', key: false },
            { col: 'PIM', key: true }, { col: 'CÉDULA', key: true }, { col: 'TELÉFONO*', key: false },
          ].map(({ col, key }, i) => (
            <span key={col} className={cn('px-2.5 py-1 rounded-lg text-xs font-mono border',
              i === 12 ? 'bg-primary/10 text-primary border-primary/20 font-bold' :
              i === 13 ? 'bg-success/10 text-success border-success/20 font-bold' :
              i === 14 ? 'bg-warning/10 text-warning border-warning/20' :
              'bg-base text-text-muted border-border-soft'
            )}>{col}</span>
          ))}
        </div>
        <p className="text-text-muted text-xs">
          Fila 1 = encabezado. Se agrupa por <strong className="text-primary">PIM</strong>.
          <strong className="text-warning ml-1">TELÉFONO*</strong> es opcional — si existe se pre-llena al registrar el técnico.
        </p>
      </div>
    </div>
  )
}
