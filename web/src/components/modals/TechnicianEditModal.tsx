import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  Edit2, X, Loader2, Save, MapPin, Building2,
  FolderOpen, FileText, Navigation, Search, Home, Locate, Mail,
} from 'lucide-react'
import { toast } from 'sonner'
import { MapContainer, Marker, Circle } from 'react-leaflet'
import { MapBaseLayer } from '@/components/map/MapBaseLayer'
import L from 'leaflet'
import { supabase } from '@/lib/supabase'
import { reverseGeocode, geocodeAddress, geocodeWithClaude, resolveMapsLink, isShortMapsLink } from '@/lib/geocoding'
import { COUNTRIES, CITIES_BY_COUNTRY, parseShift, buildShift } from '@/lib/geo'
import { TimeSelect } from '@/components/ui/TimeSelect'
import { cn } from '@/lib/utils'

const HOME_PREVIEW_ICON = L.divIcon({
  html: `<div style="width:32px;height:32px;border-radius:50%;background:#10B98120;border:2px solid #10B981;display:flex;align-items:center;justify-content:center;font-size:17px;box-shadow:0 2px 12px rgba(0,0,0,0.55);">🏠</div>`,
  className: '',
  iconSize:   [32, 32],
  iconAnchor: [16, 16],
})

// ── Tipo exportado ─────────────────────────────────────────────────────────────

export interface TechnicianEditable {
  id:           string
  name:         string
  phone:        string | null
  client:       string | null
  project:      string | null
  country:      string | null
  city:         string | null
  shift:        string | null
  notes:        string | null
  device_id:    string | null
  active:       boolean
  created_at:   string
  home_address: string | null
  home_lat:     number | null
  home_lng:     number | null
  home_radius:  number | null
  company_id:   string | null
  email:        string | null
}

const DEFAULT_HOME_RADIUS = 100

// ── Helpers UI ─────────────────────────────────────────────────────────────────

const inputCls = cn(
  'w-full bg-base border border-border-soft rounded-xl px-3 py-2 text-sm text-text-primary',
  'placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors',
)

function SectionLabel({ color, label, optional }: { color: string; label: string; optional?: boolean }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className={cn('w-1 h-4 rounded-full', color)} />
      <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">{label}</p>
      {optional && <span className="text-xs text-text-muted">(opcional)</span>}
    </div>
  )
}

function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <label className="block text-xs text-text-muted font-medium mb-1.5">
      {label} {required && <span className="text-danger">*</span>}
    </label>
  )
}

// ── Modal ──────────────────────────────────────────────────────────────────────

export function TechnicianEditModal({ tech, onSave, onClose }: {
  tech:    TechnicianEditable
  onSave:  (id: string, data: Partial<TechnicianEditable>) => Promise<void>
  onClose: () => void
}) {
  const [name,    setName]    = useState(tech.name)
  const [phone,   setPhone]   = useState(tech.phone   ?? '')
  const [email,   setEmail]   = useState(tech.email   ?? '')
  const [country, setCountry] = useState(tech.country ?? '')
  const [city,    setCity]    = useState(tech.city    ?? '')
  const [notes,   setNotes]   = useState(tech.notes   ?? '')
  const { start: s0, end: e0 } = parseShift(tech.shift)
  const [shiftStart, setShiftStart] = useState(s0)
  const [shiftEnd,   setShiftEnd]   = useState(e0)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const [detectingCity,  setDetectingCity]  = useState(false)
  const [citySuggestion, setCitySuggestion] = useState<string | null>(null)

  const [homeAddress,   setHomeAddress]   = useState(tech.home_address ?? '')
  const [homeLat,       setHomeLat]       = useState<number | null>(tech.home_lat ?? null)
  const [homeLng,       setHomeLng]       = useState<number | null>(tech.home_lng ?? null)
  const [homeRadius,    setHomeRadius]    = useState<number>(tech.home_radius ?? DEFAULT_HOME_RADIUS)
  const [geocodingHome, setGeocodingHome] = useState(false)

  // Org dropdowns
  const [companies,    setCompanies]    = useState<{ id: string; name: string }[]>([])
  const [allCampaigns, setAllCampaigns] = useState<{ id: string; name: string; company_id: string }[]>([])
  const [loadingOrgs,  setLoadingOrgs]  = useState(true)
  const [selectedCompanyId,  setSelectedCompanyId]  = useState(tech.company_id ?? '')
  const [selectedCampaignId, setSelectedCampaignId] = useState('')

  const [companyCountry, setCompanyCountry] = useState<string | null>(null)

  const cityOptions        = country ? (CITIES_BY_COUNTRY[country] ?? []) : []
  const filteredCampaigns  = allCampaigns.filter(c => c.company_id === selectedCompanyId)
  const availableCountries = companyCountry ? [companyCountry] : COUNTRIES

  async function loadCompanyCountry(companyId: string) {
    setCompanyCountry(null)
    if (!companyId) return
    const { data } = await supabase
      .from('technicians')
      .select('country')
      .eq('company_id', companyId)
      .neq('id', tech.id)
      .not('country', 'is', null)
    const countries = (data ?? []).map((t: any) => t.country as string).filter(Boolean)
    const unique = [...new Set(countries)]
    if (unique.length === 1) setCompanyCountry(unique[0])
  }

  // Load companies + campaigns, then pre-select based on existing data
  useEffect(() => {
    setLoadingOrgs(true)
    Promise.all([
      supabase.from('companies').select('id, name').order('name'),
      supabase.from('campaigns').select('id, name, company_id').eq('is_active', true).order('name'),
    ]).then(([{ data: cos }, { data: cps }]) => {
      const companyList  = cos ?? []
      const campaignList = cps ?? []
      setCompanies(companyList)
      setAllCampaigns(campaignList)

      // Pre-select company: prefer company_id, fall back to matching client name
      let compId = tech.company_id ?? ''
      if (!compId && tech.client) {
        const match = companyList.find(c => c.name === tech.client)
        if (match) compId = match.id
      }
      setSelectedCompanyId(compId)
      if (compId) loadCompanyCountry(compId)

      // Pre-select campaign by matching project name within that company
      if (compId && tech.project) {
        const match = campaignList.find(
          c => c.company_id === compId && c.name === tech.project
        )
        if (match) setSelectedCampaignId(match.id)
      }

      setLoadingOrgs(false)
    })
  }, [])

  function handleCompanyChange(id: string) {
    setSelectedCompanyId(id)
    setSelectedCampaignId('')
    loadCompanyCountry(id)
  }

  function handleCountryChange(newCountry: string) {
    setCountry(newCountry)
    if (city && !(CITIES_BY_COUNTRY[newCountry] ?? []).includes(city)) setCity('')
  }

  async function handleDetectCity() {
    if (detectingCity || !tech.device_id) return
    setDetectingCity(true)
    setCitySuggestion(null)
    try {
      const { data } = await supabase
        .from('technician_current_status')
        .select('lat, lng')
        .eq('id', tech.id)
        .single()
      if (!data?.lat || !data?.lng) {
        toast.error('No hay datos de GPS recientes para este técnico')
        return
      }
      const result = await reverseGeocode(data.lat, data.lng)
      if (!result) { toast.error('No se pudo detectar la ciudad'); return }

      const matchedCountry = COUNTRIES.find(c => c.toLowerCase() === result.country.toLowerCase()) ?? ''
      const availCities    = matchedCountry ? (CITIES_BY_COUNTRY[matchedCountry] ?? []) : []
      const matchedCity    = availCities.find(
        c => c.toLowerCase().includes(result.city.toLowerCase()) ||
             result.city.toLowerCase().includes(c.toLowerCase()),
      ) ?? ''

      if (matchedCountry) setCountry(matchedCountry)
      if (matchedCity)    setCity(matchedCity)

      const label = [matchedCity || result.city, matchedCountry || result.country].filter(Boolean).join(', ')
      setCitySuggestion(label)
      if (!matchedCity) toast.info(`Detectado: ${result.city}, ${result.country} — selecciona la ciudad manualmente`)
    } catch {
      toast.error('Error al detectar ubicación')
    } finally {
      setDetectingCity(false)
    }
  }

  async function handleGeocodeHome() {
    if (!homeAddress.trim() || geocodingHome) return
    setGeocodingHome(true)
    const selectedCompany = companies.find(c => c.id === selectedCompanyId)
    try {
      // Link de Google Maps (largo o corto maps.app.goo.gl) → extraer coordenadas
      const raw = homeAddress.trim()
      const isShort = isShortMapsLink(raw)
      if (isShort) toast.loading('Resolviendo link de Google Maps…', { id: 'gm-resolve' })
      const gmCoords = await resolveMapsLink(raw)
      if (isShort) toast.dismiss('gm-resolve')
      if (gmCoords) {
        setHomeLat(gmCoords.lat)
        setHomeLng(gmCoords.lng)
        toast.success('Coordenadas extraídas del link de Google Maps')
        return
      }
      if (isShort) {
        toast.error('No se pudo resolver el link corto de Google Maps. Intenta con el link largo (el que muestra la dirección en la barra).')
        return
      }

      let lat: number | null = null
      let lng: number | null = null
      if (city) {
        const res = await geocodeWithClaude(homeAddress.trim(), city, selectedCompany?.name ?? null)
        if (res.result) { lat = res.result.lat; lng = res.result.lng }
      }
      if (!lat || !lng) {
        const query = city ? `${homeAddress.trim()}, ${city}, Colombia` : homeAddress.trim()
        const res = await geocodeAddress(query)
        if (res) { lat = res.lat; lng = res.lng }
      }
      if (!lat || !lng) { toast.error('No se encontró la dirección'); return }
      setHomeLat(lat)
      setHomeLng(lng)
      toast.success('Coordenadas de casa obtenidas')
    } catch {
      toast.error('Error al geocodificar')
    } finally {
      setGeocodingHome(false)
    }
  }

  async function handleSave() {
    if (!name.trim())         { setError('El nombre es obligatorio'); return }
    if (!country)             { setError('El país es obligatorio'); return }
    if (!city)                { setError('La ciudad es obligatoria'); return }
    if (!selectedCompanyId)   { setError('Debes seleccionar una empresa'); return }
    if (!selectedCampaignId)  { setError('Debes seleccionar una campaña'); return }
    if (companyCountry && country !== companyCountry) {
      setError(`Esta empresa solo puede tener técnicos de ${companyCountry}`)
      return
    }
    setSaving(true)
    setError(null)
    try {
      let finalLat = homeLat
      let finalLng = homeLng

      if (homeAddress.trim() && (!finalLat || !finalLng)) {
        try {
          const selectedCompany = companies.find(c => c.id === selectedCompanyId)
          if (city) {
            const res = await geocodeWithClaude(homeAddress.trim(), city, selectedCompany?.name ?? null)
            if (res.result) { finalLat = res.result.lat; finalLng = res.result.lng }
          }
          if (!finalLat || !finalLng) {
            const query = city ? `${homeAddress.trim()}, ${city}, Colombia` : homeAddress.trim()
            const res = await geocodeAddress(query)
            if (res) { finalLat = res.lat; finalLng = res.lng }
          }
          if (finalLat && finalLng) { setHomeLat(finalLat); setHomeLng(finalLng) }
        } catch { /* continúa sin coordenadas */ }
      }

      const selectedCompany  = companies.find(c => c.id === selectedCompanyId)
      const selectedCampaign = filteredCampaigns.find(c => c.id === selectedCampaignId)

      await onSave(tech.id, {
        name:         name.trim(),
        phone:        phone.trim()   || null,
        email:        email.trim()   || null,
        client:       selectedCompany?.name  ?? null,
        project:      selectedCampaign?.name ?? null,
        company_id:   selectedCompanyId      || null,
        country:      country        || null,
        city:         city           || null,
        shift:        buildShift(shiftStart, shiftEnd) ?? null,
        notes:        notes.trim()   || null,
        home_address: (() => { const a = homeAddress.trim(); return (a && !a.startsWith('http')) ? a : null })(),
        home_lat:     finalLat,
        home_lng:     finalLng,
        home_radius:  homeRadius,
      })
      onClose()
    } catch (err: any) {
      setError(err.message ?? 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (!saving && e.target === e.currentTarget) onClose() }}
    >
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }} />
      <div
        style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: '520px', margin: '0 16px', maxHeight: '90vh', overflowY: 'auto' }}
        className="bg-surface border border-border-soft rounded-2xl shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border-soft sticky top-0 bg-surface rounded-t-2xl z-10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Edit2 className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="font-bold text-text-primary text-sm leading-none">Editar técnico</p>
              <p className="text-xs text-text-muted mt-0.5">{tech.name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors rounded-lg p-1.5 hover:bg-surface-raised"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">

          {/* ── Datos personales ── */}
          <div>
            <SectionLabel color="bg-primary" label="Datos del técnico" />
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <FieldLabel label="Nombre completo" required />
                <input
                  type="text" value={name} onChange={e => setName(e.target.value)}
                  placeholder="Carlos Ramírez" className={inputCls} autoFocus
                />
              </div>
              <div>
                <FieldLabel label="Teléfono" />
                <input
                  type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                  placeholder="+57 300 000 0000" className={inputCls}
                />
              </div>
              <div>
                <FieldLabel label="Email" />
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
                  <input
                    type="email" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="tecnico@ejemplo.com" className={cn(inputCls, 'pl-8')}
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs text-text-muted font-medium">País <span className="text-danger">*</span></label>
                  {tech.device_id && (
                    <button
                      type="button" onClick={handleDetectCity} disabled={detectingCity}
                      className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
                    >
                      {detectingCity ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Locate className="w-2.5 h-2.5" />}
                      Detectar por GPS
                    </button>
                  )}
                </div>
                {citySuggestion && (
                  <p className="text-[10px] text-success mb-1.5 flex items-center gap-1">
                    <Locate className="w-2.5 h-2.5" /> Detectado: {citySuggestion}
                  </p>
                )}
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
                  <select
                    value={country} onChange={e => handleCountryChange(e.target.value)}
                    disabled={!!companyCountry}
                    className={cn(inputCls, 'pl-8 appearance-none cursor-pointer disabled:opacity-80')}
                  >
                    <option value="">Sin especificar</option>
                    {availableCountries.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  {companyCountry && (
                    <p className="text-[11px] text-warning mt-1.5">
                      Esta empresa solo opera en {companyCountry}
                    </p>
                  )}
                </div>
              </div>

              {country && (
                <div className="col-span-2">
                  <FieldLabel label="Ciudad" required />
                  <div className="relative">
                    <Navigation className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
                    <select
                      value={city} onChange={e => setCity(e.target.value)}
                      className={cn(inputCls, 'pl-8 appearance-none cursor-pointer')}
                    >
                      <option value="">Seleccionar ciudad</option>
                      {cityOptions.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
              )}

              <div className="col-span-2">
                <FieldLabel label="Horario de trabajo" />
                <div className="flex items-center gap-2">
                  <TimeSelect value={shiftStart} onChange={setShiftStart} placeholder="Inicio" className="flex-1" />
                  <span className="text-text-muted text-xs font-medium flex-shrink-0">hasta</span>
                  <TimeSelect value={shiftEnd}   onChange={setShiftEnd}   placeholder="Fin"   className="flex-1" />
                </div>
              </div>
            </div>
          </div>

          {/* ── Organización ── */}
          <div>
            <SectionLabel color="bg-accent" label="Organización" />
            {loadingOrgs ? (
              <div className="flex items-center gap-2 text-xs text-text-muted py-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Cargando empresas y campañas…
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel label="Empresa" required />
                  <div className="relative">
                    <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
                    <select
                      value={selectedCompanyId}
                      onChange={e => handleCompanyChange(e.target.value)}
                      className={cn(inputCls, 'pl-8 appearance-none cursor-pointer')}
                    >
                      <option value="">Seleccionar empresa</option>
                      {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <FieldLabel label="Campaña" required />
                  <div className="relative">
                    <FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
                    <select
                      value={selectedCampaignId}
                      onChange={e => setSelectedCampaignId(e.target.value)}
                      disabled={!selectedCompanyId}
                      className={cn(inputCls, 'pl-8 appearance-none cursor-pointer disabled:opacity-60')}
                    >
                      <option value="">
                        {!selectedCompanyId
                          ? 'Seleccionar empresa primero'
                          : filteredCampaigns.length === 0
                            ? 'Sin campañas activas'
                            : 'Seleccionar campaña'}
                      </option>
                      {filteredCampaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Notas ── */}
          <div>
            <SectionLabel color="bg-warning" label="Notas" optional />
            <div className="relative">
              <FileText className="absolute left-3 top-3 w-3.5 h-3.5 text-text-muted pointer-events-none" />
              <textarea
                value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Información adicional…"
                rows={2} className={cn(inputCls, 'pl-8 resize-none leading-relaxed')}
              />
            </div>
          </div>

          {/* ── Dirección de casa ── */}
          <div>
            <SectionLabel color="bg-success" label="Dirección de casa" optional />
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Home className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
                <input
                  type="text"
                  value={homeAddress}
                  onChange={e => { setHomeAddress(e.target.value); setHomeLat(null); setHomeLng(null) }}
                  onKeyDown={e => { if (e.key === 'Enter') handleGeocodeHome() }}
                  placeholder="Calle 45 #12-30 o pega un link de Google Maps"
                  className={cn(inputCls, 'pl-8')}
                />
              </div>
              <button
                type="button"
                onClick={handleGeocodeHome}
                disabled={geocodingHome || !homeAddress.trim()}
                title="Buscar coordenadas"
                className="px-3 rounded-xl bg-success/10 hover:bg-success/20 text-success transition-colors disabled:opacity-50 flex items-center"
              >
                {geocodingHome ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              </button>
            </div>
            {homeLat && homeLng ? (
              <>
                <p className="text-[11px] text-success mt-1.5 flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  Ubicado · {homeLat.toFixed(4)}, {homeLng.toFixed(4)}
                </p>
                <div style={{ height: 160, borderRadius: 12, overflow: 'hidden', marginTop: 8, border: '1px solid #10B98140' }}>
                  <MapContainer
                    key={`${homeLat.toFixed(5)}-${homeLng.toFixed(5)}`}
                    center={[homeLat, homeLng]}
                    zoom={16}
                    scrollWheelZoom={false}
                    attributionControl={false}
                    style={{ height: '100%', width: '100%' }}
                  >
                    <MapBaseLayer />
                    <Circle
                      center={[homeLat, homeLng]}
                      radius={homeRadius}
                      pathOptions={{ color: '#10B981', fillColor: '#10B981', fillOpacity: 0.18, weight: 2, opacity: 0.8, dashArray: '6, 4' }}
                    />
                    <Marker position={[homeLat, homeLng]} icon={HOME_PREVIEW_ICON} />
                  </MapContainer>
                </div>

                {/* Tamaño del círculo de la casa */}
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs text-text-muted font-medium">Tamaño del círculo</label>
                    <span className="text-[11px] font-mono font-semibold text-success">{homeRadius} m</span>
                  </div>
                  <input
                    type="range"
                    min={30}
                    max={500}
                    step={10}
                    value={homeRadius}
                    onChange={e => setHomeRadius(Number(e.target.value))}
                    className="w-full accent-success cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-text-muted/60 mt-0.5">
                    <span>30 m</span>
                    <span>500 m</span>
                  </div>
                </div>
              </>
            ) : homeAddress ? (
              <p className="text-[11px] text-text-muted mt-1.5">
                Presiona el botón buscar para geolocalizar la dirección
              </p>
            ) : null}
          </div>

          {error && (
            <div className="bg-danger/10 border border-danger/30 text-danger text-xs rounded-xl px-3 py-2.5">
              {error}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              className="flex-1 border border-border-soft text-text-secondary hover:text-text-primary text-sm font-medium rounded-xl py-2.5 transition-colors hover:bg-surface-raised"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving || loadingOrgs}
              className="flex-1 bg-primary hover:bg-primary-hover text-base font-semibold text-sm rounded-xl py-2.5 transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
