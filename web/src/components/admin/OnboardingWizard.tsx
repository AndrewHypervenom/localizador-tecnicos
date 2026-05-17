import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { QRCodeSVG } from 'qrcode.react'
import {
  X, Building2, FolderOpen, UserPlus, CheckCircle2,
  MapPin, Plus, Check, Search, ChevronRight,
  Loader2, RefreshCw, Sparkles, Users, ArrowLeft,
  Navigation,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { COUNTRIES, CITIES_BY_COUNTRY, buildShift } from '@/lib/geo'
import { TimeSelect } from '@/components/ui/TimeSelect'

const STATUS_CFG = {
  active:    { label: 'Activo',     cls: 'bg-success/10 text-success border-success/20' },
  paused:    { label: 'Pausado',    cls: 'bg-warning/10 text-warning border-warning/20' },
  completed: { label: 'Finalizado', cls: 'bg-text-muted/10 text-text-muted border-border' },
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Client {
  id: string; name: string; country: string | null; notes: string | null
  created_at: string; projects?: { id: string }[]
}
interface Project {
  id: string; client_id: string; name: string; description: string | null
  status: 'active' | 'paused' | 'completed'; created_at: string
  technicians?: { id: string }[]
}
interface TechRow {
  id: string; name: string; phone: string | null
  project_id: string | null; project?: { name: string } | null
}

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  onComplete?: () => void
  initialClientId?: string
  initialProjectId?: string
}

// ── Shared input style ────────────────────────────────────────────────────────

const inp = cn(
  'w-full bg-base border border-border-soft rounded-xl px-3 py-2.5 text-sm text-text-primary',
  'placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors'
)

// ── Step indicator ────────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, label: 'Cliente',  Icon: Building2    },
  { id: 2, label: 'Proyecto', Icon: FolderOpen   },
  { id: 3, label: 'Técnico',  Icon: UserPlus     },
  { id: 4, label: 'Listo',    Icon: CheckCircle2 },
]

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-center gap-0 px-6 py-4 border-b border-border-soft">
      {STEPS.map((s, i) => {
        const done    = s.id < current
        const active  = s.id === current
        const Icon    = s.Icon
        return (
          <div key={s.id} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div className={cn(
                'w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all duration-300',
                done   ? 'bg-primary border-primary'
                : active ? 'bg-primary/10 border-primary'
                : 'bg-base border-border-soft'
              )}>
                {done
                  ? <Check className="w-3.5 h-3.5 text-base" />
                  : <Icon className={cn('w-3.5 h-3.5', active ? 'text-primary' : 'text-text-muted')} />
                }
              </div>
              <span className={cn(
                'text-xs font-medium transition-colors',
                active ? 'text-primary' : done ? 'text-text-secondary' : 'text-text-muted'
              )}>{s.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={cn(
                'w-12 sm:w-20 h-0.5 mb-5 mx-1 transition-colors duration-300',
                s.id < current ? 'bg-primary' : 'bg-border-soft'
              )} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Slide animation ───────────────────────────────────────────────────────────

const slide = {
  enter: (dir: number) => ({ x: dir > 0 ? '40%' : '-40%', opacity: 0 }),
  center: { x: 0, opacity: 1, transition: { duration: 0.22 } },
  exit:  (dir: number) => ({ x: dir > 0 ? '-40%' : '40%', opacity: 0, transition: { duration: 0.16 } }),
}

// ── Step 1: Cliente ───────────────────────────────────────────────────────────

function StepClient({ clients, loading, selectedId, onSelect, showForm, onToggleForm, form, setForm }: {
  clients: Client[]; loading: boolean; selectedId: string | null
  onSelect: (id: string) => void; showForm: boolean; onToggleForm: () => void
  form: { name: string; country: string; notes: string }
  setForm: (f: any) => void
}) {
  const [search, setSearch] = useState('')
  const filtered = clients.filter(c => c.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-text-primary">¿Para qué empresa trabajan?</h2>
        <p className="text-sm text-text-muted mt-0.5">Selecciona un cliente existente o crea uno nuevo</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : (
        <>
          {clients.length > 0 && (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
                <input
                  type="text" value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Buscar cliente…"
                  className="w-full bg-base border border-border-soft rounded-xl pl-8 pr-3 py-2 text-sm placeholder:text-text-muted focus:outline-none focus:border-primary transition-colors"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-52 overflow-y-auto pr-1">
                {filtered.map(c => (
                  <button
                    key={c.id}
                    onClick={() => { onSelect(c.id); if (showForm) onToggleForm() }}
                    className={cn(
                      'text-left rounded-xl border p-3.5 transition-all group hover:border-primary/50',
                      selectedId === c.id
                        ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                        : 'border-border-soft bg-base hover:bg-surface'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-text-primary text-sm truncate">{c.name}</p>
                        {c.country && (
                          <p className="flex items-center gap-1 text-xs text-text-muted mt-0.5">
                            <MapPin className="w-3 h-3 flex-shrink-0" />{c.country}
                          </p>
                        )}
                        {c.projects && (
                          <p className="text-xs text-text-muted/70 mt-1">
                            {c.projects.length} {c.projects.length === 1 ? 'proyecto' : 'proyectos'}
                          </p>
                        )}
                      </div>
                      <div className={cn(
                        'w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5',
                        selectedId === c.id ? 'border-primary bg-primary' : 'border-border'
                      )}>
                        {selectedId === c.id && <Check className="w-3 h-3 text-base" />}
                      </div>
                    </div>
                  </button>
                ))}
                {filtered.length === 0 && (
                  <p className="col-span-2 text-center text-xs text-text-muted py-4">Sin resultados</p>
                )}
              </div>
            </>
          )}

          {/* Create new */}
          <div className={cn(
            'rounded-xl border transition-all',
            showForm ? 'border-primary/40 bg-primary/3' : 'border-dashed border-border-soft'
          )}>
            <button
              onClick={onToggleForm}
              className={cn(
                'w-full flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors rounded-xl',
                showForm ? 'text-primary' : 'text-text-muted hover:text-text-primary'
              )}
            >
              <div className={cn(
                'w-6 h-6 rounded-lg flex items-center justify-center transition-colors',
                showForm ? 'bg-primary/20' : 'bg-surface-raised'
              )}>
                <Plus className={cn('w-3.5 h-3.5', showForm ? 'text-primary' : 'text-text-muted')} />
              </div>
              {clients.length === 0 ? 'Crear primer cliente' : 'Crear nuevo cliente'}
            </button>

            <AnimatePresence>
              {showForm && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-4 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="col-span-2">
                        <label className="block text-xs text-text-muted font-medium mb-1">Nombre de la empresa *</label>
                        <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                          placeholder="Empresa ABC" className={inp} autoFocus />
                      </div>
                      <div className="col-span-2 sm:col-span-1">
                        <label className="block text-xs text-text-muted font-medium mb-1">País</label>
                        <div className="relative">
                          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
                          <select value={form.country} onChange={e => setForm({ ...form, country: e.target.value })}
                            className={cn(inp, 'pl-8 appearance-none cursor-pointer')}>
                            <option value="">Sin especificar</option>
                            {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="col-span-2 sm:col-span-1">
                        <label className="block text-xs text-text-muted font-medium mb-1">Notas</label>
                        <input type="text" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                          placeholder="Información adicional…" className={inp} />
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </>
      )}
    </div>
  )
}

// ── Step 2: Proyecto ──────────────────────────────────────────────────────────

function StepProject({ projects, loading, selectedId, clientName, onSelect, showForm, onToggleForm, form, setForm }: {
  projects: Project[]; loading: boolean; selectedId: string | null; clientName: string
  onSelect: (id: string) => void; showForm: boolean; onToggleForm: () => void
  form: { name: string; description: string; status: 'active' | 'paused' | 'completed' }
  setForm: (f: any) => void
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-text-primary">¿En qué proyecto?</h2>
        <p className="text-sm text-text-muted mt-0.5 flex items-center gap-1.5">
          <Building2 className="w-3.5 h-3.5 text-primary" />
          <span className="text-primary font-medium">{clientName}</span>
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : (
        <>
          {projects.length > 0 && (
            <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
              {projects.map(p => {
                const cfg = STATUS_CFG[p.status]
                return (
                  <button
                    key={p.id}
                    onClick={() => { onSelect(p.id); if (showForm) onToggleForm() }}
                    className={cn(
                      'w-full text-left rounded-xl border p-3.5 transition-all',
                      selectedId === p.id
                        ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                        : 'border-border-soft bg-base hover:border-primary/40 hover:bg-surface'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-text-primary text-sm truncate">{p.name}</p>
                        {p.description && (
                          <p className="text-xs text-text-muted mt-0.5 line-clamp-1">{p.description}</p>
                        )}
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className={cn('text-xs px-2 py-0.5 rounded-full border font-medium', cfg.cls)}>
                            {cfg.label}
                          </span>
                          {p.technicians && (
                            <span className="text-xs text-text-muted flex items-center gap-1">
                              <Users className="w-3 h-3" />
                              {p.technicians.length} {p.technicians.length === 1 ? 'técnico' : 'técnicos'}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className={cn(
                        'w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5',
                        selectedId === p.id ? 'border-primary bg-primary' : 'border-border'
                      )}>
                        {selectedId === p.id && <Check className="w-3 h-3 text-base" />}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          <div className={cn(
            'rounded-xl border transition-all',
            showForm ? 'border-primary/40 bg-primary/3' : 'border-dashed border-border-soft'
          )}>
            <button
              onClick={onToggleForm}
              className={cn(
                'w-full flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors rounded-xl',
                showForm ? 'text-primary' : 'text-text-muted hover:text-text-primary'
              )}
            >
              <div className={cn('w-6 h-6 rounded-lg flex items-center justify-center', showForm ? 'bg-primary/20' : 'bg-surface-raised')}>
                <Plus className={cn('w-3.5 h-3.5', showForm ? 'text-primary' : 'text-text-muted')} />
              </div>
              {projects.length === 0 ? 'Crear primer proyecto' : 'Crear nuevo proyecto'}
            </button>

            <AnimatePresence>
              {showForm && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                  <div className="px-4 pb-4 space-y-3">
                    <div>
                      <label className="block text-xs text-text-muted font-medium mb-1">Nombre del proyecto *</label>
                      <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                        placeholder="Instalación de fibra óptica zona norte" className={inp} autoFocus />
                    </div>
                    <div>
                      <label className="block text-xs text-text-muted font-medium mb-1">Descripción</label>
                      <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                        placeholder="Detalles adicionales del proyecto…" rows={2}
                        className={cn(inp, 'resize-none leading-relaxed')} />
                    </div>
                    <div>
                      <label className="block text-xs text-text-muted font-medium mb-1">Estado inicial</label>
                      <div className="flex gap-2">
                        {(Object.entries(STATUS_CFG) as [string, typeof STATUS_CFG['active']][]).map(([key, cfg]) => (
                          <button
                            key={key}
                            type="button"
                            onClick={() => setForm({ ...form, status: key })}
                            className={cn(
                              'flex-1 text-xs py-1.5 rounded-lg border font-medium transition-all',
                              form.status === key ? cfg.cls + ' ring-1 ring-offset-0' : 'border-border-soft text-text-muted hover:border-border'
                            )}
                          >
                            {cfg.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </>
      )}
    </div>
  )
}

// ── Step 3: Técnico ───────────────────────────────────────────────────────────

function StepTechnician({ techs, loading, selectedIds, onToggle, projectName, showForm, onToggleForm, form, setForm, clientCountry }: {
  techs: TechRow[]; loading: boolean; selectedIds: Set<string>; onToggle: (id: string) => void
  projectName: string; showForm: boolean; onToggleForm: () => void
  form: { name: string; phone: string; city: string; shiftStart: string; shiftEnd: string }; setForm: (f: any) => void
  clientCountry?: string | null
}) {
  const [search, setSearch] = useState('')
  const filtered = techs.filter(t => t.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-text-primary">¿Quién trabajará aquí?</h2>
        <p className="text-sm text-text-muted mt-0.5 flex items-center gap-1.5">
          <FolderOpen className="w-3.5 h-3.5 text-primary" />
          <span className="text-primary font-medium">{projectName}</span>
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : (
        <>
          {techs.length > 0 && (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
                <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Buscar técnico…"
                  className="w-full bg-base border border-border-soft rounded-xl pl-8 pr-3 py-2 text-sm placeholder:text-text-muted focus:outline-none focus:border-primary transition-colors" />
              </div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {filtered.map(t => {
                  const sel = selectedIds.has(t.id)
                  return (
                    <button key={t.id} onClick={() => onToggle(t.id)}
                      className={cn(
                        'w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl border transition-all text-left',
                        sel ? 'border-primary bg-primary/5' : 'border-border-soft bg-base hover:border-primary/40 hover:bg-surface'
                      )}
                    >
                      <div className={cn(
                        'w-5 h-5 rounded flex items-center justify-center border-2 flex-shrink-0 transition-all',
                        sel ? 'border-primary bg-primary' : 'border-border'
                      )}>
                        {sel && <Check className="w-3 h-3 text-base" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-text-primary truncate">{t.name}</p>
                        <p className="text-xs text-text-muted truncate">
                          {t.phone ?? ''}
                          {t.project && <span className="ml-1 text-warning">· actualmente en {t.project.name}</span>}
                        </p>
                      </div>
                    </button>
                  )
                })}
                {filtered.length === 0 && (
                  <p className="text-center text-xs text-text-muted py-4">Sin resultados</p>
                )}
              </div>
            </>
          )}

          <div className={cn(
            'rounded-xl border transition-all',
            showForm ? 'border-primary/40 bg-primary/3' : 'border-dashed border-border-soft'
          )}>
            <button onClick={onToggleForm}
              className={cn(
                'w-full flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors rounded-xl',
                showForm ? 'text-primary' : 'text-text-muted hover:text-text-primary'
              )}
            >
              <div className={cn('w-6 h-6 rounded-lg flex items-center justify-center', showForm ? 'bg-primary/20' : 'bg-surface-raised')}>
                <UserPlus className={cn('w-3.5 h-3.5', showForm ? 'text-primary' : 'text-text-muted')} />
              </div>
              {techs.length === 0 ? 'Crear primer técnico' : 'Crear nuevo técnico'}
            </button>

            <AnimatePresence>
              {showForm && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                  <div className="px-4 pb-4 grid grid-cols-2 gap-3">
                    <div className="col-span-2 sm:col-span-1">
                      <label className="block text-xs text-text-muted font-medium mb-1">Nombre completo *</label>
                      <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                        placeholder="Carlos Ramírez" className={inp} autoFocus />
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                      <label className="block text-xs text-text-muted font-medium mb-1">Teléfono</label>
                      <input type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}
                        placeholder="+504 9999-0001" className={inp} />
                    </div>
                    {/* Ciudad — basada en el país del cliente */}
                    {clientCountry && (CITIES_BY_COUNTRY[clientCountry]?.length ?? 0) > 0 && (
                      <div className="col-span-2">
                        <label className="block text-xs text-text-muted font-medium mb-1">Ciudad</label>
                        <div className="relative">
                          <Navigation className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
                          <select value={form.city} onChange={e => setForm({ ...form, city: e.target.value })}
                            className={cn(inp, 'pl-8 appearance-none cursor-pointer')}>
                            <option value="">Seleccionar ciudad</option>
                            {(CITIES_BY_COUNTRY[clientCountry] ?? []).map(c => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}
                    {/* Horario */}
                    <div className="col-span-2">
                      <label className="block text-xs text-text-muted font-medium mb-1.5">Horario de trabajo</label>
                      <div className="flex items-center gap-2">
                        <TimeSelect value={form.shiftStart} onChange={v => setForm({ ...form, shiftStart: v })}
                          placeholder="Inicio" className="flex-1" />
                        <span className="text-text-muted text-xs font-medium flex-shrink-0">hasta</span>
                        <TimeSelect value={form.shiftEnd} onChange={v => setForm({ ...form, shiftEnd: v })}
                          placeholder="Fin" className="flex-1" />
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {(selectedIds.size > 0 || (showForm && form.name.trim())) && (
            <p className="text-xs text-text-muted flex items-center gap-1">
              <Check className="w-3 h-3 text-success" />
              {selectedIds.size > 0 && `${selectedIds.size} técnico${selectedIds.size > 1 ? 's' : ''} seleccionado${selectedIds.size > 1 ? 's' : ''}`}
              {selectedIds.size > 0 && showForm && form.name.trim() && ' · '}
              {showForm && form.name.trim() && '1 nuevo a crear'}
            </p>
          )}
        </>
      )}
    </div>
  )
}

// ── Step 4: Done ──────────────────────────────────────────────────────────────

function StepDone({ clientName, projectName, assignedCount, newTechName, qrToken, onAddAnother, onFinish }: {
  clientName: string; projectName: string; assignedCount: number
  newTechName: string | null; qrToken: string | null
  onAddAnother: () => void; onFinish: () => void
}) {
  const qrValue = qrToken ? `localizador:register:${qrToken}` : ''
  const total = assignedCount + (newTechName ? 1 : 0)

  return (
    <div className="space-y-5">
      {/* Success header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center flex-shrink-0">
          <CheckCircle2 className="w-5 h-5 text-success" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-text-primary">¡Todo listo!</h2>
          <p className="text-sm text-text-muted">La configuración se completó correctamente</p>
        </div>
      </div>

      {/* Summary */}
      <div className="bg-base border border-border-soft rounded-xl p-4 space-y-2 text-sm">
        <div className="flex items-center gap-2 text-text-secondary">
          <Building2 className="w-4 h-4 text-primary flex-shrink-0" />
          <span className="font-medium text-text-primary">{clientName}</span>
        </div>
        <div className="flex items-center gap-2 text-text-secondary ml-4">
          <ChevronRight className="w-3.5 h-3.5 text-text-muted" />
          <FolderOpen className="w-3.5 h-3.5 text-accent" />
          <span>{projectName}</span>
        </div>
        <div className="ml-8 text-xs text-text-muted">
          {total > 0 ? (
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3" />
              {total} técnico{total > 1 ? 's' : ''} asignado{total > 1 ? 's' : ''}
            </span>
          ) : (
            <span>Sin técnicos aún</span>
          )}
        </div>
      </div>

      {/* QR for new technician */}
      {qrToken && newTechName && (
        <div className="bg-surface border border-border-soft rounded-xl p-4 flex flex-col items-center gap-3">
          <p className="text-sm font-semibold text-text-primary">QR de registro — {newTechName}</p>
          <div className="bg-white p-3 rounded-xl shadow-inner">
            <QRCodeSVG value={qrValue} size={160} level="M" bgColor="#ffffff" fgColor="#0f172a" />
          </div>
          <div className="flex items-center gap-1.5 bg-success/10 border border-success/20 rounded-xl px-3 py-2 text-xs text-success">
            <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
            Válido 24h · Un solo uso · El técnico lo escanea con la app
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button onClick={onAddAnother}
          className="flex-1 flex items-center justify-center gap-2 border border-border-soft text-text-secondary hover:text-text-primary text-sm font-medium rounded-xl py-2.5 transition-colors hover:bg-surface-raised">
          <UserPlus className="w-4 h-4" />
          Añadir otro técnico
        </button>
        <button onClick={onFinish}
          className="flex-1 bg-primary hover:bg-primary-hover text-base font-semibold text-sm rounded-xl py-2.5 transition-colors flex items-center justify-center gap-2">
          <Check className="w-4 h-4" />
          Finalizar
        </button>
      </div>
    </div>
  )
}

// ── Main Wizard ───────────────────────────────────────────────────────────────

export function OnboardingWizard({ open, onOpenChange, onComplete, initialClientId, initialProjectId }: Props) {
  const [step, setStep]       = useState(1)
  const [direction, setDir]   = useState(1)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)

  // Data
  const [clients, setClients]   = useState<Client[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [allTechs, setAllTechs] = useState<TechRow[]>([])
  const [loadingClients, setLoadingClients]   = useState(false)
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [loadingTechs, setLoadingTechs]       = useState(false)

  // Step 1: client
  const [selectedClientId, setSelectedClientId] = useState<string | null>(initialClientId ?? null)
  const [showClientForm, setShowClientForm]     = useState(false)
  const [clientForm, setClientForm]             = useState({ name: '', country: '', notes: '' })

  // Step 2: project
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(initialProjectId ?? null)
  const [showProjectForm, setShowProjectForm]     = useState(false)
  const [projectForm, setProjectForm]             = useState({ name: '', description: '', status: 'active' as const })

  // Step 3: technician
  const [selectedTechIds, setSelectedTechIds] = useState<Set<string>>(new Set())
  const [showTechForm, setShowTechForm]       = useState(false)
  const [techForm, setTechForm]               = useState({ name: '', phone: '', city: '', shiftStart: '', shiftEnd: '' })

  // Step 4: done
  const [createdTechName, setCreatedTechName] = useState<string | null>(null)
  const [qrToken, setQrToken]                 = useState<string | null>(null)
  const [assignedCount, setAssignedCount]     = useState(0)

  const selectedClient  = clients.find(c => c.id === selectedClientId)
  const selectedProject = projects.find(p => p.id === selectedProjectId)

  // ── Loaders ──

  async function loadClients() {
    setLoadingClients(true)
    try {
      const { data } = await supabase
        .from('clients')
        .select('id, name, country, notes, created_at, projects(id)')
        .order('name')
      setClients(data ?? [])
    } finally {
      setLoadingClients(false)
    }
  }

  async function loadProjects(clientId: string) {
    setLoadingProjects(true)
    try {
      const { data } = await supabase
        .from('projects')
        .select('id, client_id, name, description, status, created_at, technicians(id)')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
      setProjects(data ?? [])
    } finally {
      setLoadingProjects(false)
    }
  }

  async function loadTechs() {
    setLoadingTechs(true)
    try {
      const { data } = await supabase
        .from('technicians')
        .select('id, name, phone, project_id, project:projects(name)')
        .eq('active', true)
        .order('name')
      setAllTechs((data ?? []) as unknown as TechRow[])
    } finally {
      setLoadingTechs(false)
    }
  }

  useEffect(() => {
    if (!open) return
    resetWizard()
    loadClients()
  }, [open])

  useEffect(() => {
    if (selectedClientId) loadProjects(selectedClientId)
    else setProjects([])
  }, [selectedClientId])

  useEffect(() => {
    if (step === 3) loadTechs()
  }, [step])

  // ── Navigation ──

  function go(nextStep: number, dir: number) {
    setDir(dir)
    setStep(nextStep)
    setError(null)
  }

  async function handleContinue() {
    setError(null)
    setSaving(true)
    try {
      if (step === 1) {
        let clientId = selectedClientId
        if (showClientForm) {
          if (!clientForm.name.trim()) { setError('El nombre del cliente es obligatorio'); setSaving(false); return }
          const { data, error: err } = await supabase
            .from('clients')
            .insert({ name: clientForm.name.trim(), country: clientForm.country || null, notes: clientForm.notes.trim() || null })
            .select('id').single()
          if (err) throw err
          clientId = data.id
          setSelectedClientId(clientId)
          await loadClients()
          setShowClientForm(false)
          setClientForm({ name: '', country: '', notes: '' })
        }
        if (!clientId) { setError('Selecciona o crea un cliente'); setSaving(false); return }
        go(2, 1)
      }
      else if (step === 2) {
        let projectId = selectedProjectId
        if (showProjectForm) {
          if (!projectForm.name.trim()) { setError('El nombre del proyecto es obligatorio'); setSaving(false); return }
          const { data, error: err } = await supabase
            .from('projects')
            .insert({ client_id: selectedClientId!, name: projectForm.name.trim(), description: projectForm.description.trim() || null, status: projectForm.status })
            .select('id').single()
          if (err) throw err
          projectId = data.id
          setSelectedProjectId(projectId)
          setShowProjectForm(false)
          setProjectForm({ name: '', description: '', status: 'active' })
        }
        if (!projectId) { setError('Selecciona o crea un proyecto'); setSaving(false); return }
        go(3, 1)
      }
      else if (step === 3) {
        const hasExisting = selectedTechIds.size > 0
        const hasNew = showTechForm && techForm.name.trim()
        if (!hasExisting && !hasNew) { setError('Selecciona o crea al menos un técnico'); setSaving(false); return }

        let count = 0

        const techMeta = {
          project_id: selectedProjectId,
          client:  selectedClient?.name  ?? null,
          project: selectedProject?.name ?? null,
          country: selectedClient?.country ?? null,
        }

        // Assign existing technicians
        if (selectedTechIds.size > 0) {
          const { error: err } = await supabase
            .from('technicians')
            .update(techMeta)
            .in('id', [...selectedTechIds])
          if (err) throw err
          count = selectedTechIds.size
        }

        // Create new technician + QR
        let newQrToken: string | null = null
        let newTechName: string | null = null
        if (hasNew) {
          const { data: tech, error: techErr } = await supabase
            .from('technicians')
            .insert({
              name: techForm.name.trim(),
              phone: techForm.phone.trim() || null,
              city: techForm.city || null,
              shift: buildShift(techForm.shiftStart, techForm.shiftEnd),
              ...techMeta,
              active: true,
            })
            .select('id, name').single()
          if (techErr) throw techErr

          // Generate QR
          await supabase.from('registration_tokens')
            .update({ used_at: new Date().toISOString() })
            .eq('technician_id', tech.id).is('used_at', null)
          const { data: tokenData, error: tokenErr } = await supabase
            .from('registration_tokens')
            .insert({ technician_id: tech.id })
            .select('token').single()
          if (tokenErr) throw tokenErr

          newQrToken = tokenData.token
          newTechName = tech.name
        }

        setAssignedCount(count)
        setCreatedTechName(newTechName)
        setQrToken(newQrToken)
        go(4, 1)
      }
    } catch (err: any) {
      setError(err.message ?? 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  function handleBack() {
    if (step > 1) go(step - 1, -1)
  }

  function handleAddAnother() {
    setSelectedTechIds(new Set())
    setTechForm({ name: '', phone: '', city: '', shiftStart: '', shiftEnd: '' })
    setShowTechForm(false)
    setCreatedTechName(null)
    setQrToken(null)
    go(3, -1)
    loadTechs()
  }

  function handleFinish() {
    onOpenChange(false)
    onComplete?.()
  }

  function resetWizard() {
    setStep(1); setDir(1); setError(null); setSaving(false)
    setSelectedClientId(initialClientId ?? null)
    setSelectedProjectId(initialProjectId ?? null)
    setShowClientForm(false); setClientForm({ name: '', country: '', notes: '' })
    setShowProjectForm(false); setProjectForm({ name: '', description: '', status: 'active' })
    setSelectedTechIds(new Set()); setShowTechForm(false); setTechForm({ name: '', phone: '', city: '', shiftStart: '', shiftEnd: '' })
    setCreatedTechName(null); setQrToken(null); setAssignedCount(0)
  }

  function handleClose() { onOpenChange(false) }

  const canContinue =
    (step === 1 && (selectedClientId !== null || (showClientForm && clientForm.name.trim()))) ||
    (step === 2 && (selectedProjectId !== null || (showProjectForm && projectForm.name.trim()))) ||
    (step === 3 && (selectedTechIds.size > 0 || (showTechForm && techForm.name.trim())))

  if (!open) return null

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) handleClose() }}
    >
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }} />

      <div
        style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: '640px', margin: '0 16px', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}
        className="bg-surface border border-border-soft rounded-2xl shadow-2xl overflow-hidden"
      >
        {/* Wizard header */}
        <div className="flex items-center justify-between px-6 pt-4 pb-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-sm font-bold text-text-primary">Nuevo proyecto</span>
          </div>
          <button onClick={handleClose} className="text-text-muted hover:text-text-primary transition-colors rounded-lg p-1.5 hover:bg-surface-raised">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step indicator */}
        <StepIndicator current={step} />

        {/* Step content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 min-h-[320px]">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              variants={slide}
              initial="enter"
              animate="center"
              exit="exit"
            >
              {step === 1 && (
                <StepClient
                  clients={clients} loading={loadingClients}
                  selectedId={selectedClientId} onSelect={setSelectedClientId}
                  showForm={showClientForm} onToggleForm={() => { setShowClientForm(v => !v); if (selectedClientId && !showClientForm) setSelectedClientId(null) }}
                  form={clientForm} setForm={setClientForm}
                />
              )}
              {step === 2 && (
                <StepProject
                  projects={projects} loading={loadingProjects}
                  selectedId={selectedProjectId} clientName={selectedClient?.name ?? ''}
                  onSelect={setSelectedProjectId}
                  showForm={showProjectForm} onToggleForm={() => { setShowProjectForm(v => !v); if (selectedProjectId && !showProjectForm) setSelectedProjectId(null) }}
                  form={projectForm} setForm={setProjectForm}
                />
              )}
              {step === 3 && (
                <StepTechnician
                  techs={allTechs} loading={loadingTechs}
                  selectedIds={selectedTechIds}
                  onToggle={id => setSelectedTechIds(prev => {
                    const n = new Set(prev)
                    n.has(id) ? n.delete(id) : n.add(id)
                    return n
                  })}
                  projectName={selectedProject?.name ?? ''}
                  showForm={showTechForm} onToggleForm={() => setShowTechForm(v => !v)}
                  form={techForm} setForm={setTechForm}
                  clientCountry={selectedClient?.country}
                />
              )}
              {step === 4 && (
                <StepDone
                  clientName={selectedClient?.name ?? ''}
                  projectName={selectedProject?.name ?? ''}
                  assignedCount={assignedCount}
                  newTechName={createdTechName}
                  qrToken={qrToken}
                  onAddAnother={handleAddAnother}
                  onFinish={handleFinish}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-6 mb-2 bg-danger/10 border border-danger/30 text-danger text-xs rounded-xl px-3 py-2">{error}</div>
        )}

        {/* Navigation */}
        {step < 4 && (
          <div className="px-6 py-4 border-t border-border-soft flex gap-2">
            {step > 1 ? (
              <button onClick={handleBack} disabled={saving}
                className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors px-4 py-2.5 rounded-xl border border-border-soft hover:bg-surface-raised disabled:opacity-50">
                <ArrowLeft className="w-4 h-4" />
                Atrás
              </button>
            ) : (
              <button onClick={handleClose} className="px-4 py-2.5 rounded-xl border border-border-soft text-sm text-text-secondary hover:text-text-primary transition-colors hover:bg-surface-raised">
                Cancelar
              </button>
            )}
            <button
              onClick={handleContinue}
              disabled={!canContinue || saving}
              className="flex-1 flex items-center justify-center gap-2 bg-primary hover:bg-primary-hover text-base font-semibold text-sm rounded-xl py-2.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving
                ? <><Loader2 className="w-4 h-4 animate-spin" />Guardando…</>
                : <>{step === 3 ? 'Asignar y continuar' : 'Continuar'} <ChevronRight className="w-4 h-4" /></>
              }
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
