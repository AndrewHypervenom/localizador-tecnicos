import { useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Building2, FolderOpen, CheckCircle2, Check,
  ArrowLeft, Loader2, Sparkles, Plus,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'

// ── Types ────────────────────────────────────────────────────────────────────

interface Props {
  onComplete: (companyId: string, campaignId: string) => void
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const inp = cn(
  'w-full bg-base border border-border-soft rounded-xl px-3.5 py-2.5 text-sm text-text-primary',
  'placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors'
)

// ── Step indicator ─────────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, label: 'Empresa',  Icon: Building2    },
  { id: 2, label: 'Campaña',  Icon: FolderOpen   },
  { id: 3, label: '¡Listo!',  Icon: CheckCircle2 },
]

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-center gap-0 px-6 py-5 border-b border-border-soft">
      {STEPS.map((s, i) => {
        const done   = s.id < current
        const active = s.id === current
        const Icon   = s.Icon
        return (
          <div key={s.id} className="flex items-center">
            <div className="flex flex-col items-center gap-1.5 w-20">
              <div className={cn(
                'w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all duration-300',
                done   ? 'bg-primary border-primary' :
                active ? 'bg-primary/10 border-primary' :
                         'bg-base border-border-soft'
              )}>
                {done
                  ? <Check className="w-4 h-4 text-white" />
                  : <Icon className={cn('w-4 h-4', active ? 'text-primary' : 'text-text-muted')} />
                }
              </div>
              <span className={cn(
                'text-xs font-medium',
                done || active ? 'text-primary' : 'text-text-muted'
              )}>
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={cn(
                'h-0.5 w-12 mb-5 transition-colors duration-300',
                done ? 'bg-primary' : 'bg-border-soft'
              )} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Step 1: Company ────────────────────────────────────────────────────────────

function StepCompany({ onNext }: { onNext: (id: string, name: string) => void }) {
  const [name, setName]    = useState('')
  const [desc, setDesc]    = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]  = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setError(null)
    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const { data, error: err } = await supabase
        .from('companies')
        .insert({ name: name.trim(), description: desc.trim() || null, created_by: session?.user.id })
        .select('id, name')
        .single()
      if (err) throw err
      onNext(data.id, data.name)
    } catch (err: any) {
      setError(err.message ?? 'Error al crear empresa')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 p-6">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Building2 className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h3 className="text-text-primary font-semibold">Crea tu empresa</h3>
          <p className="text-text-muted text-xs mt-0.5">
            La empresa es el cliente o contratante para quien trabajan tus técnicos.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-xs text-text-muted font-medium mb-1.5">
            Nombre de la empresa *
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            required
            autoFocus
            placeholder="Empresa ABC"
            className={inp}
          />
        </div>
        <div>
          <label className="block text-xs text-text-muted font-medium mb-1.5">
            Descripción (opcional)
          </label>
          <input
            type="text"
            value={desc}
            onChange={e => setDesc(e.target.value)}
            placeholder="Información adicional…"
            className={inp}
          />
        </div>
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/30 text-danger text-xs rounded-xl px-3 py-2">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading || !name.trim()}
        className="w-full bg-primary hover:bg-primary-hover text-base font-semibold text-sm rounded-xl py-3 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        {loading ? 'Creando…' : 'Continuar →'}
      </button>
    </form>
  )
}

// ── Step 2: Campaign ──────────────────────────────────────────────────────────

function StepCampaign({
  companyId,
  companyName,
  onNext,
  onBack,
}: {
  companyId: string
  companyName: string
  onNext: (id: string, name: string) => void
  onBack: () => void
}) {
  const [name, setName]       = useState('')
  const [desc, setDesc]       = useState('')
  const [startDate, setStart] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [endDate, setEnd]     = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setError(null)
    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const { data, error: err } = await supabase
        .from('campaigns')
        .insert({
          name:        name.trim(),
          company_id:  companyId,
          description: desc.trim() || null,
          start_date:  startDate || null,
          end_date:    endDate   || null,
          is_active:   true,
          created_by:  session?.user.id,
        })
        .select('id, name')
        .single()
      if (err) throw err
      onNext(data.id, data.name)
    } catch (err: any) {
      setError(err.message ?? 'Error al crear campaña')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 p-6">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
          <FolderOpen className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h3 className="text-text-primary font-semibold">Crea tu primera campaña</h3>
          <p className="text-text-muted text-xs mt-0.5">
            Una campaña agrupa las rutas de trabajo bajo <strong className="text-text-secondary">{companyName}</strong>.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-xs text-text-muted font-medium mb-1.5">
            Nombre de la campaña *
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            required
            autoFocus
            placeholder="Instalación Zona Norte"
            className={inp}
          />
        </div>
        <div>
          <label className="block text-xs text-text-muted font-medium mb-1.5">
            Descripción (opcional)
          </label>
          <input
            type="text"
            value={desc}
            onChange={e => setDesc(e.target.value)}
            placeholder="Información adicional…"
            className={inp}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-text-muted font-medium mb-1.5">
              Fecha inicio
            </label>
            <input
              type="date"
              value={startDate}
              onChange={e => setStart(e.target.value)}
              className={inp}
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted font-medium mb-1.5">
              Fecha fin (opcional)
            </label>
            <input
              type="date"
              value={endDate}
              onChange={e => setEnd(e.target.value)}
              className={inp}
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/30 text-danger text-xs rounded-xl px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-2.5 border border-border-soft text-text-secondary hover:text-text-primary text-sm rounded-xl transition-colors hover:bg-surface-raised flex items-center gap-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Atrás
        </button>
        <button
          type="submit"
          disabled={loading || !name.trim()}
          className="flex-1 bg-primary hover:bg-primary-hover text-base font-semibold text-sm rounded-xl py-2.5 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {loading ? 'Creando…' : 'Continuar →'}
        </button>
      </div>
    </form>
  )
}

// ── Step 3: Done ───────────────────────────────────────────────────────────────

function StepDone({
  companyName,
  campaignName,
  onFinish,
  onBack,
}: {
  companyName: string
  campaignName: string
  onFinish: () => void
  onBack: () => void
}) {
  return (
    <div className="p-8 flex flex-col items-center gap-5 text-center">
      <div className="w-20 h-20 rounded-full bg-success/10 border-2 border-success/30 flex items-center justify-center">
        <Sparkles className="w-10 h-10 text-success" />
      </div>
      <div>
        <h3 className="text-text-primary font-bold text-xl">¡Todo listo!</h3>
        <p className="text-text-muted text-sm mt-2">
          Ya puedes cargar tus rutas bajo<br />
          <strong className="text-text-primary">{companyName}</strong> → <strong className="text-primary">{campaignName}</strong>
        </p>
      </div>
      <div className="w-full bg-surface-raised border border-border-soft rounded-xl p-4 text-left space-y-2">
        <p className="text-xs text-text-muted font-medium uppercase tracking-wider">Creado:</p>
        <div className="flex items-center gap-2">
          <Building2 className="w-3.5 h-3.5 text-text-muted" />
          <span className="text-sm text-text-primary">{companyName}</span>
        </div>
        <div className="flex items-center gap-2">
          <FolderOpen className="w-3.5 h-3.5 text-primary" />
          <span className="text-sm text-text-primary">{campaignName}</span>
        </div>
      </div>
      <p className="text-text-muted text-xs">
        Puedes crear más empresas y campañas desde la pestaña "Cargar Rutas" en cualquier momento.
      </p>
      <div className="flex gap-3 w-full">
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-2.5 border border-border-soft text-text-secondary hover:text-text-primary text-sm rounded-xl transition-colors hover:bg-surface-raised flex items-center gap-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Atrás
        </button>
        <button
          onClick={onFinish}
          className="flex-1 bg-primary hover:bg-primary-hover text-base font-semibold text-sm rounded-xl py-2.5 transition-colors"
        >
          Empezar a cargar rutas
        </button>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function LeaderOnboarding({ onComplete }: Props) {
  const [step, setStep]       = useState(1)
  const [direction, setDir]   = useState(1)
  const [companyId, setCompanyId]     = useState('')
  const [companyName, setCompanyName] = useState('')
  const [campaignId, setCampaignId]   = useState('')
  const [campaignName, setCampaignName] = useState('')

  function go(next: number) {
    setDir(next > step ? 1 : -1)
    setStep(next)
  }

  function handleCompanyNext(id: string, name: string) {
    setCompanyId(id)
    setCompanyName(name)
    go(2)
  }

  function handleCampaignNext(id: string, name: string) {
    setCampaignId(id)
    setCampaignName(name)
    go(3)
  }

  const variants = {
    enter:  (d: number) => ({ x: d > 0 ? 40 : -40, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit:   (d: number) => ({ x: d > 0 ? -40 : 40, opacity: 0 }),
  }

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
      className="flex items-center justify-center p-4"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Card */}
      <div className="relative z-10 w-full max-w-md bg-surface border border-border-soft rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-0 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg overflow-hidden flex-shrink-0">
            <img src="/favicon.png" alt="PositivoS+" className="w-full h-full object-cover" />
          </div>
          <div>
            <p className="text-text-primary font-bold text-sm">Bienvenido al Panel de Líder</p>
            <p className="text-text-muted text-xs">Configuración inicial — solo toma 2 minutos</p>
          </div>
        </div>

        {/* Step indicator */}
        <StepIndicator current={step} />

        {/* Step content with animation */}
        <div className="overflow-hidden" style={{ minHeight: 300 }}>
          <AnimatePresence custom={direction} mode="wait">
            <motion.div
              key={step}
              custom={direction}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.22, ease: 'easeInOut' }}
            >
              {step === 1 && <StepCompany onNext={handleCompanyNext} />}
              {step === 2 && (
                <StepCampaign
                  companyId={companyId}
                  companyName={companyName}
                  onNext={handleCampaignNext}
                  onBack={() => go(1)}
                />
              )}
              {step === 3 && (
                <StepDone
                  companyName={companyName}
                  campaignName={campaignName}
                  onFinish={() => onComplete(companyId, campaignId)}
                  onBack={() => go(2)}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>,
    document.body,
  )
}
