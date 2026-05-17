import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { QRCodeSVG } from 'qrcode.react'
import { X, UserPlus, CheckCircle, RefreshCw, QrCode, Building2, MapPin, FileText, Navigation } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { COUNTRIES, CITIES_BY_COUNTRY, buildShift } from '@/lib/geo'
import { TimeSelect } from '@/components/ui/TimeSelect'

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
  const [step, setStep]       = useState<Step>(existingTechnician ? 'qr' : 'form')
  const [name, setName]       = useState('')
  const [phone, setPhone]     = useState('')
  const [client, setClient]   = useState('')
  const [project, setProject] = useState('')
  const [country, setCountry]       = useState('')
  const [city, setCity]             = useState('')
  const [shiftStart, setShiftStart] = useState('')
  const [shiftEnd, setShiftEnd]     = useState('')
  const [notes, setNotes]     = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [qrToken, setQrToken] = useState<string | null>(null)
  const [techName, setTechName] = useState(existingTechnician?.name ?? '')

  const cityOptions = country ? (CITIES_BY_COUNTRY[country] ?? []) : []

  function handleCountryChange(newCountry: string) {
    setCountry(newCountry)
    const valid = CITIES_BY_COUNTRY[newCountry] ?? []
    if (city && !valid.includes(city)) setCity('')
  }

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
    if (!name.trim()) { setError('El nombre es obligatorio'); return }
    setLoading(true)
    setError(null)
    try {
      const { data: tech, error: techError } = await supabase
        .from('technicians')
        .insert({
          name:    name.trim(),
          phone:   phone.trim()   || null,
          client:  client.trim()  || null,
          project: project.trim() || null,
          country: country                          || null,
          city:    city                             || null,
          shift:   buildShift(shiftStart, shiftEnd) ?? null,
          notes:   notes.trim()   || null,
          active:  true,
        })
        .select('id, name')
        .single()

      if (techError) throw new Error(techError.message)
      const token = await generateQR(tech.id)
      setQrToken(token)
      setTechName(tech.name)
      setStep('qr')
    } catch (err: any) {
      setError(err.message ?? 'Error al crear técnico')
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
      setError(err.message ?? 'Error al generar QR')
    } finally {
      setLoading(false)
    }
  }

  function handleClose() {
    onOpenChange(false)
    setTimeout(() => {
      setStep(existingTechnician ? 'qr' : 'form')
      setName(''); setPhone(''); setClient(''); setProject('')
      setCountry(''); setCity(''); setShiftStart(''); setShiftEnd(''); setNotes('')
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
        <div className="flex items-center justify-between px-6 pt-6 pb-5 border-b border-border-soft sticky top-0 bg-surface rounded-t-2xl z-10">
          <div className="flex items-center gap-2.5">
            {step === 'form'
              ? <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><UserPlus className="w-4 h-4 text-primary" /></div>
              : <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><QrCode className="w-4 h-4 text-primary" /></div>
            }
            <div>
              <p className="font-bold text-text-primary text-sm leading-none">
                {step === 'form' ? 'Nuevo Técnico' : 'Código QR de Registro'}
              </p>
              {step === 'form' && <p className="text-xs text-text-muted mt-0.5">Completa los datos del técnico</p>}
            </div>
          </div>
          <button
            onClick={handleClose}
            className="text-text-muted hover:text-text-primary transition-colors rounded-lg p-1.5 hover:bg-surface-raised"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Step 1: Form ── */}
        {step === 'form' && (
          <div className="px-6 py-5 space-y-5">
            {/* Datos básicos */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1 h-4 bg-primary rounded-full" />
                <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Datos del técnico</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Field label="Nombre completo" required>
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
                  <Field label="Teléfono">
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
                  <Field label="País">
                    <div className="relative">
                      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
                      <select
                        value={country}
                        onChange={e => handleCountryChange(e.target.value)}
                        className={cn(inputCls, 'pl-8 appearance-none cursor-pointer')}
                      >
                        <option value="">Sin especificar</option>
                        {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </Field>
                </div>
                {/* Ciudad — aparece cuando hay país seleccionado */}
                {country && (
                  <div className="col-span-2">
                    <Field label="Ciudad">
                      <div className="relative">
                        <Navigation className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
                        <select
                          value={city}
                          onChange={e => setCity(e.target.value)}
                          className={cn(inputCls, 'pl-8 appearance-none cursor-pointer')}
                        >
                          <option value="">Seleccionar ciudad</option>
                          {cityOptions.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                    </Field>
                  </div>
                )}
                {/* Horario */}
                <div className="col-span-2">
                  <Field label="Horario de trabajo">
                    <div className="flex items-center gap-2">
                      <TimeSelect value={shiftStart} onChange={setShiftStart} placeholder="Inicio" className="flex-1" />
                      <span className="text-text-muted text-xs font-medium flex-shrink-0">hasta</span>
                      <TimeSelect value={shiftEnd} onChange={setShiftEnd} placeholder="Fin" className="flex-1" />
                    </div>
                  </Field>
                </div>
              </div>
            </div>

            {/* Organización */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1 h-4 bg-accent rounded-full" />
                <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Organización</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Field label="Cliente / Empresa">
                    <div className="relative">
                      <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
                      <input
                        type="text"
                        value={client}
                        onChange={e => setClient(e.target.value)}
                        placeholder="Empresa ABC"
                        className={cn(inputCls, 'pl-8')}
                      />
                    </div>
                  </Field>
                </div>
                <div>
                  <Field label="Proyecto">
                    <input
                      type="text"
                      value={project}
                      onChange={e => setProject(e.target.value)}
                      placeholder="Instalación Zona Norte"
                      className={inputCls}
                    />
                  </Field>
                </div>
              </div>
            </div>

            {/* Notas */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1 h-4 bg-warning rounded-full" />
                <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Notas</p>
                <span className="text-xs text-text-muted">(opcional)</span>
              </div>
              <div className="relative">
                <FileText className="absolute left-3 top-3 w-3.5 h-3.5 text-text-muted pointer-events-none" />
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Información adicional sobre el técnico…"
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

            <div className="pt-1">
              <button
                onClick={handleCreate}
                disabled={loading}
                className={cn(
                  'w-full bg-primary hover:bg-primary-hover text-base font-semibold text-sm',
                  'rounded-xl py-3 transition-colors flex items-center justify-center gap-2',
                  loading && 'opacity-60 cursor-not-allowed'
                )}
              >
                {loading
                  ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  : <><UserPlus className="w-4 h-4" />Crear técnico y generar QR</>
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
              <p className="text-text-muted text-xs mt-0.5">Escanear desde la app del técnico</p>
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
                  Válido por 24 horas · Un solo uso
                </div>
                <p className="text-text-muted text-xs text-center">
                  El técnico debe abrir la app y apuntar la cámara a este código.
                </p>
                {existingTechnician && (
                  <button
                    onClick={handleRegenerateQR}
                    className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Regenerar QR
                  </button>
                )}
              </>
            ) : (
              <p className="text-danger text-sm">{error ?? 'Error al generar QR'}</p>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
