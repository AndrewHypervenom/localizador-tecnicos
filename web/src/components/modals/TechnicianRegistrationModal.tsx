import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { QRCodeSVG } from 'qrcode.react'
import { X, UserPlus, CheckCircle, RefreshCw, QrCode, Building2, MapPin, FileText, Navigation, Check, FolderOpen, Mail } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { COUNTRIES, CITIES_BY_COUNTRY, buildShift } from '@/lib/geo'
import { TimeSelect } from '@/components/ui/TimeSelect'
import { getLeaderScope } from '@/lib/leaderContext'
import { useI18n } from '@/lib/i18n/i18n'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  existingTechnician?: { id: string; name: string }
}

type Step = 'form' | 'qr'

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-text-muted font-medium mb-1.5">
        {label} {required && <span className="text-danger">*</span>}
      </label>
      {children}
    </div>
  )
}

const inputCls = cn(
  'w-full bg-base border border-border-soft rounded-xl px-3 py-2.5 text-sm text-text-primary',
  'placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors'
)

export function TechnicianRegistrationModal({ open, onOpenChange, existingTechnician }: Props) {
  const { t } = useI18n()
  const [step, setStep]       = useState<Step>(existingTechnician ? 'qr' : 'form')
  const [name, setName]       = useState('')
  const [phone, setPhone]     = useState('')
  const [email, setEmail]     = useState('')
  const [country, setCountry]       = useState('')
  const [city, setCity]             = useState('')
  const [shiftStart, setShiftStart] = useState('')
  const [shiftEnd, setShiftEnd]     = useState('')
  const [notes, setNotes]     = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [qrToken, setQrToken] = useState<string | null>(null)
  const [techName, setTechName] = useState(existingTechnician?.name ?? '')

  // Org dropdowns
  const [companies, setCompanies]       = useState<{ id: string; name: string }[]>([])
  const [allCampaigns, setAllCampaigns] = useState<{ id: string; name: string; company_id: string }[]>([])
  const [loadingOrgs, setLoadingOrgs]   = useState(false)
  const [selectedCompanyId, setSelectedCompanyId]   = useState('')
  const [selectedCampaignId, setSelectedCampaignId] = useState('')
  const [companyCountry, setCompanyCountry] = useState<string | null>(null)

  const cityOptions        = country ? (CITIES_BY_COUNTRY[country] ?? []) : []
  const filteredCampaigns  = allCampaigns.filter(c => c.company_id === selectedCompanyId)
  const availableCountries = companyCountry ? [companyCountry] : COUNTRIES

  function handleCountryChange(newCountry: string) {
    setCountry(newCountry)
    const valid = CITIES_BY_COUNTRY[newCountry] ?? []
    if (city && !valid.includes(city)) setCity('')
  }

  async function handleCompanyChange(id: string) {
    setSelectedCompanyId(id)
    setSelectedCampaignId('')
    setCompanyCountry(null)
    if (!id) return
    const { data } = await supabase
      .from('technicians')
      .select('country')
      .eq('company_id', id)
      .not('country', 'is', null)
    const countries = (data ?? []).map((t: any) => t.country as string).filter(Boolean)
    const unique = [...new Set(countries)]
    if (unique.length === 1) {
      setCompanyCountry(unique[0])
      setCountry(unique[0])
      if (city && !(CITIES_BY_COUNTRY[unique[0]] ?? []).includes(city)) setCity('')
    }
  }

  // Load companies + campaigns when modal opens.
  // Superadmin ve todas; el líder solo las empresas que creó.
  useEffect(() => {
    if (!open) return
    setLoadingOrgs(true)
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const role = session?.user?.app_metadata?.role as string | undefined

      let companyQuery = supabase.from('companies').select('id, name').order('name')
      let campaignQuery = supabase.from('campaigns').select('id, name, company_id').eq('is_active', true).order('name')

      if (role !== 'superadmin') {
        const { companyIds } = await getLeaderScope()
        if (companyIds.length === 0) {
          setCompanies([]); setAllCampaigns([]); setLoadingOrgs(false)
          return
        }
        companyQuery = (companyQuery as any).in('id', companyIds)
        campaignQuery = (campaignQuery as any).in('company_id', companyIds)
      }

      const [{ data: cos }, { data: cps }] = await Promise.all([companyQuery, campaignQuery])
      setCompanies(cos ?? [])
      setAllCampaigns(cps ?? [])
      setLoadingOrgs(false)
    })()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => {
    if (open && existingTechnician && !qrToken) handleRegenerateQR()
  }, [open, existingTechnician])

  async function generateQR(technicianId: string) {
    await supabase.from('registration_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('technician_id', technicianId)
      .is('used_at', null)

    const { data, error: tokenError } = await supabase
      .from('registration_tokens')
      .insert({ technician_id: technicianId })
      .select('token')
      .single()

    if (tokenError) throw new Error(tokenError.message)
    return data.token as string
  }

  async function handleCreate() {
    if (!name.trim())        { setError(t('techForm.errName')); return }
    if (!country)            { setError(t('techForm.errCountry')); return }
    if (!city)               { setError(t('techForm.errCity')); return }
    if (!selectedCompanyId)  { setError(t('techForm.errCompany')); return }
    if (!selectedCampaignId) { setError(t('techForm.errCampaign')); return }
    if (companyCountry && country !== companyCountry) {
      setError(t('techForm.errCompanyCountry', { country: companyCountry }))
      return
    }
    setLoading(true)
    setError(null)
    try {
      const selectedCompany  = companies.find(c => c.id === selectedCompanyId)
      const selectedCampaign = filteredCampaigns.find(c => c.id === selectedCampaignId)

      const { data: tech, error: techError } = await supabase
        .from('technicians')
        .insert({
          name:       name.trim(),
          phone:      phone.trim()  || null,
          email:      email.trim()  || null,
          client:     selectedCompany?.name  ?? null,
          project:    selectedCampaign?.name ?? null,
          company_id: selectedCompanyId      || null,
          country:    country                || null,
          city:       city                   || null,
          shift:      buildShift(shiftStart, shiftEnd) ?? null,
          notes:      notes.trim()           || null,
          active:     true,
        })
        .select('id, name')
        .single()

      if (techError) throw new Error(techError.message)
      const token = await generateQR(tech.id)
      setQrToken(token)
      setTechName(tech.name)
      setStep('qr')
    } catch (err: any) {
      setError(err.message ?? t('regTech.createError'))
    } finally {
      setLoading(false)
    }
  }

  async function handleRegenerateQR() {
    if (!existingTechnician) return
    setLoading(true)
    setError(null)
    try {
      const token = await generateQR(existingTechnician.id)
      setQrToken(token)
    } catch (err: any) {
      setError(err.message ?? t('qr.genError'))
    } finally {
      setLoading(false)
    }
  }

  function handleClose() {
    onOpenChange(false)
    setTimeout(() => {
      setStep(existingTechnician ? 'qr' : 'form')
      setName(''); setPhone(''); setEmail('')
      setCountry(''); setCity(''); setShiftStart(''); setShiftEnd(''); setNotes('')
      setSelectedCompanyId(''); setSelectedCampaignId('')
      setError(null); setQrToken(null)
    }, 200)
  }

  const qrValue = qrToken ? `localizador:register:${qrToken}` : ''
  if (!open) return null

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) handleClose() }}
    >
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }} />

      <div
        style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: step === 'form' ? '520px' : '380px', margin: '0 16px', maxHeight: '90vh', overflowY: 'auto' }}
        className="bg-surface border border-border-soft rounded-2xl shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border-soft sticky top-0 bg-surface rounded-t-2xl z-10">
          <div className="flex items-center gap-2.5">
            {step === 'form'
              ? <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><UserPlus className="w-4 h-4 text-primary" /></div>
              : <div className="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center"><QrCode className="w-4 h-4 text-success" /></div>
            }
            <div>
              <p className="font-bold text-text-primary text-sm leading-none">
                {step === 'form' ? t('regTech.newTech') : t('qr.titleRegister')}
              </p>
              <p className="text-xs text-text-muted mt-0.5">
                {step === 'form' ? t('regTech.completeData') : t('qr.scanFromAppShort', { name: techName })}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="text-text-muted hover:text-text-primary transition-colors rounded-lg p-1.5 hover:bg-surface-raised"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-4 px-6 py-2.5 border-b border-border-soft bg-base/30">
          {([{ key: 'form', label: t('regTech.stepData') }, { key: 'qr', label: t('regTech.stepQr') }] as const).map(({ key, label }, i) => {
            const isActive = step === key
            const isDone   = key === 'form' && step === 'qr'
            return (
              <div key={key} className="flex items-center gap-2">
                {i > 0 && <div className={cn('w-8 h-px transition-colors', step === 'qr' ? 'bg-primary/40' : 'bg-border-soft')} />}
                <div className={cn('flex items-center gap-1.5 text-xs font-medium transition-colors', isActive ? 'text-primary' : isDone ? 'text-success' : 'text-text-muted/50')}>
                  <div className={cn('w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors', isActive ? 'bg-primary text-base' : isDone ? 'bg-success text-white' : 'border border-border text-text-muted')}>
                    {isDone ? <Check className="w-2.5 h-2.5" /> : i + 1}
                  </div>
                  {label}
                </div>
              </div>
            )
          })}
        </div>

        {/* ── Step 1: Form ── */}
        {step === 'form' && (
          <div className="px-6 py-5 space-y-5">
            {/* Datos básicos */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1 h-4 bg-primary rounded-full" />
                <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">{t('techForm.sectionData')}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Field label={t('techForm.fullName')} required>
                    <input
                      type="text"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder="Carlos Ramírez"
                      autoFocus
                      className={inputCls}
                    />
                  </Field>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <Field label={t('techForm.phone')}>
                    <input
                      type="tel"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      placeholder="+504 9999-0001"
                      className={inputCls}
                    />
                  </Field>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <Field label={t('techForm.email')}>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
                      <input
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        placeholder={t('techForm.emailPlaceholder')}
                        className={cn(inputCls, 'pl-8')}
                      />
                    </div>
                  </Field>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <Field label={t('techForm.country')} required>
                    <div className="relative">
                      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
                      <select
                        value={country}
                        onChange={e => handleCountryChange(e.target.value)}
                        disabled={!!companyCountry}
                        className={cn(inputCls, 'pl-8 appearance-none cursor-pointer disabled:opacity-80')}
                      >
                        <option value="">{t('techForm.selectCountry')}</option>
                        {availableCountries.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    {companyCountry && (
                      <p className="text-[11px] text-warning mt-1.5">
                        {t('techForm.companyOnlyCountry', { country: companyCountry })}
                      </p>
                    )}
                  </Field>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <Field label={t('techForm.city')} required>
                    <div className="relative">
                      <Navigation className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
                      <select
                        value={city}
                        onChange={e => setCity(e.target.value)}
                        disabled={!country}
                        className={cn(inputCls, 'pl-8 appearance-none cursor-pointer disabled:opacity-60')}
                      >
                        <option value="">{!country ? t('techForm.selectCountryFirst') : t('techForm.selectCity')}</option>
                        {cityOptions.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </Field>
                </div>
                {/* Horario */}
                <div className="col-span-2">
                  <Field label={t('techForm.workSchedule')}>
                    <div className="flex items-center gap-2">
                      <TimeSelect value={shiftStart} onChange={setShiftStart} placeholder={t('techForm.shiftStart')} className="flex-1" />
                      <span className="text-text-muted text-xs font-medium flex-shrink-0">{t('techForm.until')}</span>
                      <TimeSelect value={shiftEnd} onChange={setShiftEnd} placeholder={t('techForm.shiftEnd')} className="flex-1" />
                    </div>
                  </Field>
                </div>
              </div>
            </div>

            {/* Organización */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1 h-4 bg-accent rounded-full" />
                <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">{t('techForm.sectionOrg')}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Field label={t('techForm.company')} required>
                    <div className="relative">
                      <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
                      <select
                        value={selectedCompanyId}
                        onChange={e => handleCompanyChange(e.target.value)}
                        disabled={loadingOrgs}
                        className={cn(inputCls, 'pl-8 appearance-none cursor-pointer disabled:opacity-60')}
                      >
                        <option value="">{loadingOrgs ? t('techForm.loadingShort') : t('techForm.noCompany')}</option>
                        {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                  </Field>
                </div>
                <div>
                  <Field label={t('techForm.campaign')} required>
                    <div className="relative">
                      <FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
                      <select
                        value={selectedCampaignId}
                        onChange={e => setSelectedCampaignId(e.target.value)}
                        disabled={!selectedCompanyId || filteredCampaigns.length === 0}
                        className={cn(inputCls, 'pl-8 appearance-none cursor-pointer disabled:opacity-60')}
                      >
                        <option value="">
                          {!selectedCompanyId
                            ? t('techForm.selectCompanyFirst')
                            : filteredCampaigns.length === 0
                              ? t('techForm.noActiveCampaigns')
                              : t('techForm.noCampaign')}
                        </option>
                        {filteredCampaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                  </Field>
                </div>
              </div>
            </div>

            {/* Notas */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1 h-4 bg-warning rounded-full" />
                <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">{t('techForm.sectionNotes')}</p>
                <span className="text-xs text-text-muted">{t('techForm.optional')}</span>
              </div>
              <div className="relative">
                <FileText className="absolute left-3 top-3 w-3.5 h-3.5 text-text-muted pointer-events-none" />
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder={t('techForm.notesPlaceholder')}
                  rows={2}
                  className={cn(inputCls, 'pl-8 resize-none leading-relaxed')}
                />
              </div>
            </div>

            {error && (
              <div className="bg-danger/10 border border-danger/30 text-danger text-xs rounded-xl px-3 py-2.5">
                {error}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                onClick={handleClose}
                className="flex-1 border border-border-soft text-text-secondary hover:text-text-primary text-sm font-medium rounded-xl py-2.5 transition-colors hover:bg-surface-raised"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleCreate}
                disabled={loading}
                className={cn(
                  'flex-1 bg-primary hover:bg-primary-hover text-base font-semibold text-sm',
                  'rounded-xl py-2.5 transition-colors flex items-center justify-center gap-2',
                  loading && 'opacity-60 cursor-not-allowed'
                )}
              >
                {loading
                  ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  : <><UserPlus className="w-4 h-4" />{t('regTech.createGenQr')}</>
                }
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: QR ── */}
        {step === 'qr' && (
          <div className="px-6 py-6 flex flex-col items-center gap-4">
            <div className="text-center">
              <p className="text-text-primary font-semibold">{techName}</p>
              <p className="text-text-muted text-xs mt-0.5">{t('qr.scanFromApp')}</p>
            </div>

            {loading ? (
              <div className="w-52 h-52 flex items-center justify-center">
                <span className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              </div>
            ) : qrToken ? (
              <>
                <div className="bg-white p-4 rounded-2xl shadow-inner">
                  <QRCodeSVG value={qrValue} size={180} level="M" bgColor="#ffffff" fgColor="#0f172a" />
                </div>
                <div className="flex items-center gap-1.5 bg-success/10 border border-success/20 rounded-xl px-3 py-2 text-xs text-success">
                  <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  {t('qr.validOneUse')}
                </div>
                <p className="text-text-muted text-xs text-center">
                  {t('qr.scanHint')}
                </p>
                {existingTechnician && (
                  <button
                    onClick={handleRegenerateQR}
                    className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    {t('qr.regenerate')}
                  </button>
                )}
              </>
            ) : (
              <p className="text-danger text-sm">{error ?? t('qr.genError')}</p>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
