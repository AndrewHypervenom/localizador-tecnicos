import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { QRCodeSVG } from 'qrcode.react'
import { X, UserPlus, CheckCircle, RefreshCw, QrCode } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  existingTechnician?: { id: string; name: string }
}

type Step = 'form' | 'qr'

export function TechnicianRegistrationModal({ open, onOpenChange, existingTechnician }: Props) {
  const [step, setStep]         = useState<Step>(existingTechnician ? 'qr' : 'form')
  const [name, setName]         = useState('')
  const [phone, setPhone]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [qrToken, setQrToken]   = useState<string | null>(null)
  const [techName, setTechName] = useState(existingTechnician?.name ?? '')

  // Cerrar con Escape
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // Auto-generar QR si se abre con técnico existente
  useEffect(() => {
    if (open && existingTechnician && !qrToken) {
      handleRegenerateQR()
    }
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
        .insert({ name: name.trim(), phone: phone.trim() || null, active: true })
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
      setName(''); setPhone(''); setError(null); setQrToken(null)
    }, 200)
  }

  const qrValue = qrToken ? `localizador:register:${qrToken}` : ''

  if (!open) return null

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}
    >
      {/* Overlay */}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)' }} />

      {/* Card */}
      <div
        style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: '384px', margin: '0 16px' }}
        className="bg-surface border border-border-soft rounded-2xl shadow-2xl p-6"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            {step === 'form'
              ? <UserPlus className="w-5 h-5 text-primary" />
              : <QrCode    className="w-5 h-5 text-primary" />
            }
            <span className="font-bold text-text-primary text-base">
              {step === 'form' ? 'Nuevo Técnico' : 'Código QR de Registro'}
            </span>
          </div>
          <button
            onClick={handleClose}
            className="text-text-muted hover:text-text-primary transition-colors rounded-lg p-1 hover:bg-surface-raised"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Paso 1: Formulario ── */}
        {step === 'form' && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-text-muted uppercase tracking-wider mb-1.5">
                Nombre *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                placeholder="Carlos Ramírez"
                autoFocus
                className={cn(
                  'w-full bg-base border border-border-soft rounded-xl px-3 py-2.5 text-sm text-text-primary',
                  'placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50'
                )}
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted uppercase tracking-wider mb-1.5">
                Teléfono (opcional)
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                placeholder="+504 9999-0001"
                className={cn(
                  'w-full bg-base border border-border-soft rounded-xl px-3 py-2.5 text-sm text-text-primary',
                  'placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50'
                )}
              />
            </div>

            {error && (
              <p className="text-danger text-xs bg-danger/10 rounded-xl px-3 py-2">{error}</p>
            )}

            <button
              onClick={handleCreate}
              disabled={loading}
              className={cn(
                'w-full bg-primary hover:bg-primary/90 text-white font-semibold text-sm',
                'rounded-xl py-2.5 transition-colors flex items-center justify-center gap-2',
                loading && 'opacity-60 cursor-not-allowed'
              )}
            >
              {loading
                ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                : <><UserPlus className="w-4 h-4" />Crear y generar QR</>
              }
            </button>
          </div>
        )}

        {/* ── Paso 2: QR ── */}
        {step === 'qr' && (
          <div className="flex flex-col items-center gap-4">
            <div className="text-center">
              <p className="text-text-primary font-semibold text-sm">{techName}</p>
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

                <div className="flex items-center gap-1.5 bg-success/10 rounded-xl px-3 py-2 text-xs text-success">
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
