import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { QrCode, X, RefreshCw, CheckCircle } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { supabase } from '@/lib/supabase'

interface Props {
  tech: { id: string; name: string }
  onClose: () => void
}

export function QrCodeModal({ tech, onClose }: Props) {
  const [qrToken, setQrToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  async function generateToken() {
    setLoading(true)
    setError(null)
    try {
      await supabase
        .from('registration_tokens')
        .update({ used_at: new Date().toISOString() })
        .eq('technician_id', tech.id)
        .is('used_at', null)

      const { data, error: err } = await supabase
        .from('registration_tokens')
        .insert({ technician_id: tech.id })
        .select('token')
        .single()

      if (err) throw new Error(err.message)
      setQrToken(data.token)
    } catch (err: any) {
      setError(err.message ?? 'Error al generar QR')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { generateToken() }, [])

  const qrValue = qrToken ? `localizador:register:${qrToken}` : ''

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }} />
      <div
        style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: '360px', margin: '0 16px' }}
        className="bg-surface border border-border-soft rounded-2xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3.5 border-b border-border-soft">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center">
              <QrCode className="w-4 h-4 text-success" />
            </div>
            <div>
              <p className="font-bold text-text-primary text-sm leading-none">Código QR de vinculación</p>
              <p className="text-xs text-text-muted mt-0.5 truncate max-w-[200px]">{tech.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors p-1.5 rounded-lg hover:bg-surface-raised">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-6 flex flex-col items-center gap-4">
          {loading ? (
            <div className="w-52 h-52 flex items-center justify-center">
              <span className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="w-52 h-52 flex items-center justify-center">
              <p className="text-danger text-sm text-center">{error}</p>
            </div>
          ) : (
            <>
              <div className="bg-white p-4 rounded-2xl shadow-inner">
                <QRCodeSVG value={qrValue} size={188} level="M" bgColor="#ffffff" fgColor="#0f172a" />
              </div>
              <div className="flex items-center gap-1.5 bg-success/10 border border-success/20 rounded-xl px-3 py-2 text-xs text-success">
                <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
                Válido por 24 horas · Un solo uso
              </div>
              <p className="text-text-muted text-xs text-center">
                El técnico debe abrir la app y apuntar la cámara a este código para vincular su dispositivo.
              </p>
            </>
          )}

          <div className="flex gap-2 w-full">
            <button
              onClick={generateToken}
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs border border-border-soft text-text-secondary hover:text-text-primary hover:bg-surface-raised rounded-xl py-2.5 transition-colors disabled:opacity-50"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Regenerar QR
            </button>
            <button
              onClick={onClose}
              className="flex-1 bg-primary hover:bg-primary-hover text-base text-xs font-semibold rounded-xl py-2.5 transition-colors"
            >
              Listo
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
