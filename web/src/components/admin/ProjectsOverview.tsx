import { useState, useEffect, useCallback } from 'react'
import {
  Building2, FolderOpen, Users, MapPin, Plus, ChevronDown,
  ChevronRight, RefreshCw, Loader2, Trash2, Edit2, X, Check, Save,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { OnboardingWizard } from './OnboardingWizard'

const STATUS_CFG = {
  active:    { label: 'Activo',     cls: 'bg-success/10 text-success border-success/20' },
  paused:    { label: 'Pausado',    cls: 'bg-warning/10 text-warning border-warning/20' },
  completed: { label: 'Finalizado', cls: 'bg-text-muted/10 text-text-muted border-border' },
} as const

interface Client {
  id: string; name: string; country: string | null; notes: string | null; created_at: string
}
interface Project {
  id: string; client_id: string; name: string; description: string | null
  status: 'active' | 'paused' | 'completed'; created_at: string
}
interface TechSummary { id: string; name: string; phone: string | null }

const inp = cn(
  'w-full bg-base border border-border-soft rounded-xl px-3 py-2 text-sm text-text-primary',
  'placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors'
)

// ── Inline edit for project status ────────────────────────────────────────────

function StatusToggle({ status, onChange }: { status: string; onChange: (s: string) => void }) {
  return (
    <div className="flex gap-1">
      {(Object.entries(STATUS_CFG) as [string, typeof STATUS_CFG['active']][]).map(([key, cfg]) => (
        <button key={key} onClick={() => onChange(key)}
          className={cn(
            'text-xs px-2.5 py-1 rounded-lg border font-medium transition-all',
            status === key ? cfg.cls : 'border-border-soft text-text-muted hover:border-border'
          )}>
          {cfg.label}
        </button>
      ))}
    </div>
  )
}

// ── ProjectRow ────────────────────────────────────────────────────────────────

function ProjectRow({ project, onDelete, onUpdate, onAddTechnicians }: {
  project: Project
  onDelete: (id: string) => void
  onUpdate: (id: string, data: Partial<Project>) => Promise<void>
  onAddTechnicians: (clientId: string, projectId: string) => void
}) {
  const [techs, setTechs]       = useState<TechSummary[]>([])
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing]   = useState(false)
  const [editName, setEditName] = useState(project.name)
  const [editDesc, setEditDesc] = useState(project.description ?? '')
  const [editStatus, setEditStatus] = useState<string>(project.status)
  const [saving, setSaving]     = useState(false)
  const [loadingTechs, setLoadingTechs] = useState(false)

  async function loadTechs() {
    setLoadingTechs(true)
    try {
      const { data } = await supabase
        .from('technicians')
        .select('id, name, phone')
        .eq('project_id', project.id)
        .eq('active', true)
      setTechs(data ?? [])
    } finally {
      setLoadingTechs(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      await onUpdate(project.id, {
        name: editName.trim() || project.name,
        description: editDesc.trim() || null,
        status: editStatus as 'active' | 'paused' | 'completed',
      })
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const cfg = STATUS_CFG[project.status]

  return (
    <div className="border border-border-soft/60 rounded-xl overflow-hidden">
      {/* Project header */}
      <div className="flex items-start gap-3 px-4 py-3 bg-base/40">
        <button
          onClick={() => { setExpanded(v => !v); if (!expanded) loadTechs() }}
          className="mt-0.5 text-text-muted hover:text-text-primary transition-colors flex-shrink-0"
        >
          {expanded
            ? <ChevronDown className="w-4 h-4" />
            : <ChevronRight className="w-4 h-4" />
          }
        </button>

        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="space-y-2">
              <input value={editName} onChange={e => setEditName(e.target.value)} className={cn(inp, 'py-1.5 text-sm')} />
              <input value={editDesc} onChange={e => setEditDesc(e.target.value)}
                placeholder="Descripción…" className={cn(inp, 'py-1.5 text-xs')} />
              <StatusToggle status={editStatus} onChange={setEditStatus} />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <FolderOpen className="w-3.5 h-3.5 text-accent flex-shrink-0" />
                <p className="text-sm font-semibold text-text-primary">{project.name}</p>
                <span className={cn('text-xs px-2 py-0.5 rounded-full border font-medium', cfg.cls)}>{cfg.label}</span>
              </div>
              {project.description && (
                <p className="text-xs text-text-muted mt-0.5 line-clamp-1">{project.description}</p>
              )}
              <p className="text-xs text-text-muted/60 mt-0.5">
                Creado {format(parseISO(project.created_at), 'dd MMM yyyy', { locale: es })}
              </p>
            </>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {editing ? (
            <>
              <button onClick={handleSave} disabled={saving}
                className="p-1.5 rounded-lg text-success hover:bg-success/10 transition-colors disabled:opacity-40">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              </button>
              <button onClick={() => setEditing(false)}
                className="p-1.5 rounded-lg text-text-muted hover:bg-surface-raised transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => onAddTechnicians(project.client_id, project.id)}
                title="Añadir técnico"
                className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 px-2 py-1 rounded-lg hover:bg-primary/10 transition-colors"
              >
                <Plus className="w-3 h-3" /> Técnico
              </button>
              <button onClick={() => setEditing(true)}
                className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-raised transition-colors">
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => onDelete(project.id)}
                className="p-1.5 rounded-lg text-text-muted hover:text-danger hover:bg-danger/10 transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Technicians list */}
      {expanded && (
        <div className="border-t border-border-soft/40 px-4 py-3 bg-base/20">
          {loadingTechs ? (
            <div className="flex justify-center py-3">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
            </div>
          ) : techs.length === 0 ? (
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <Users className="w-3.5 h-3.5" />
              <span>Sin técnicos asignados · </span>
              <button onClick={() => onAddTechnicians(project.client_id, project.id)}
                className="text-primary hover:underline">Añadir técnico</button>
            </div>
          ) : (
            <div className="space-y-1.5">
              <p className="text-xs text-text-muted font-medium mb-2 flex items-center gap-1.5">
                <Users className="w-3 h-3" />
                {techs.length} técnico{techs.length > 1 ? 's' : ''}
              </p>
              {techs.map(t => (
                <div key={t.id} className="flex items-center gap-2 text-sm">
                  <div className="w-1.5 h-1.5 rounded-full bg-success flex-shrink-0" />
                  <span className="text-text-secondary font-medium">{t.name}</span>
                  {t.phone && <span className="text-text-muted text-xs">{t.phone}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function ProjectsOverview({ onOpenWizard }: { onOpenWizard: () => void }) {
  const [clients, setClients]         = useState<Client[]>([])
  const [projects, setProjects]       = useState<Project[]>([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState<string | null>(null)
  const [expandedClients, setExpandedClients] = useState<Set<string>>(new Set())
  const [deletingId, setDeletingId]   = useState<string | null>(null)

  const [wizardOpen, setWizardOpen]           = useState(false)
  const [wizardClientId, setWizardClientId]   = useState<string | undefined>()
  const [wizardProjectId, setWizardProjectId] = useState<string | undefined>()

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [clientsRes, projectsRes] = await Promise.all([
        supabase.from('clients').select('*').order('name'),
        supabase.from('projects').select('*').order('created_at', { ascending: false }),
      ])
      if (clientsRes.error) throw clientsRes.error
      if (projectsRes.error) throw projectsRes.error
      setClients(clientsRes.data ?? [])
      setProjects(projectsRes.data ?? [])
      // Auto-expand all clients
      setExpandedClients(new Set((clientsRes.data ?? []).map(c => c.id)))
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function deleteProject(id: string) {
    if (!window.confirm('¿Eliminar este proyecto? Los técnicos quedarán sin proyecto asignado.')) return
    setDeletingId(id)
    try {
      await supabase.from('technicians').update({ project_id: null }).eq('project_id', id)
      await supabase.from('projects').delete().eq('id', id)
      setProjects(prev => prev.filter(p => p.id !== id))
    } finally {
      setDeletingId(null)
    }
  }

  async function updateProject(id: string, data: Partial<Project>) {
    const { error } = await supabase.from('projects').update(data).eq('id', id)
    if (error) throw error
    setProjects(prev => prev.map(p => p.id === id ? { ...p, ...data } : p))
  }

  function openWizardForProject(clientId: string, projectId: string) {
    setWizardClientId(clientId)
    setWizardProjectId(projectId)
    setWizardOpen(true)
  }

  const clientProjects = (clientId: string) => projects.filter(p => p.client_id === clientId)

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div>
          <p className="text-text-primary font-semibold text-sm">Clientes y Proyectos</p>
          {!loading && (
            <p className="text-xs text-text-muted">
              {clients.length} cliente{clients.length !== 1 ? 's' : ''} ·{' '}
              {projects.length} proyecto{projects.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <button onClick={load} title="Actualizar"
            className="text-text-muted hover:text-text-primary transition-colors p-1.5 rounded-lg hover:bg-surface-raised">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={onOpenWizard}
            className="flex items-center gap-1.5 bg-primary hover:bg-primary-hover text-base text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors">
            <Plus className="w-3.5 h-3.5" /> Nuevo proyecto
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/30 text-danger text-sm rounded-xl px-4 py-3">{error}</div>
      )}

      {clients.length === 0 ? (
        <div className="border border-dashed border-border-soft rounded-2xl px-6 py-16 text-center">
          <Building2 className="w-10 h-10 text-text-muted/40 mx-auto mb-3" />
          <p className="text-text-muted text-sm font-medium">Sin clientes registrados</p>
          <p className="text-text-muted/60 text-xs mt-1 mb-4">Usa el asistente para crear tu primer cliente y proyecto</p>
          <button onClick={onOpenWizard}
            className="inline-flex items-center gap-2 bg-primary hover:bg-primary-hover text-base text-sm font-semibold px-4 py-2 rounded-xl transition-colors">
            <Plus className="w-4 h-4" /> Comenzar configuración
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {clients.map(client => {
            const cProjects = clientProjects(client.id)
            const expanded = expandedClients.has(client.id)

            return (
              <div key={client.id} className="bg-surface border border-border-soft rounded-2xl overflow-hidden">
                {/* Client header */}
                <button
                  onClick={() => setExpandedClients(prev => {
                    const n = new Set(prev)
                    n.has(client.id) ? n.delete(client.id) : n.add(client.id)
                    return n
                  })}
                  className="w-full flex items-center gap-3 px-5 py-4 hover:bg-surface-raised transition-colors text-left"
                >
                  <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-4.5 h-4.5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-text-primary">{client.name}</p>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      {client.country && (
                        <span className="flex items-center gap-1 text-xs text-text-muted">
                          <MapPin className="w-3 h-3" />{client.country}
                        </span>
                      )}
                      <span className="text-xs text-text-muted">
                        {cProjects.length} proyecto{cProjects.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>
                  <ChevronDown className={cn('w-4 h-4 text-text-muted transition-transform flex-shrink-0', expanded && 'rotate-180')} />
                </button>

                {/* Projects list */}
                {expanded && (
                  <div className="border-t border-border-soft px-4 py-3 space-y-2">
                    {cProjects.length === 0 ? (
                      <div className="flex items-center justify-between py-2">
                        <p className="text-xs text-text-muted">Sin proyectos en este cliente</p>
                        <button
                          onClick={() => { setWizardClientId(client.id); setWizardProjectId(undefined); setWizardOpen(true) }}
                          className="text-xs text-primary hover:underline flex items-center gap-1">
                          <Plus className="w-3 h-3" /> Crear proyecto
                        </button>
                      </div>
                    ) : (
                      cProjects.map(p => (
                        <ProjectRow
                          key={p.id}
                          project={p}
                          onDelete={deleteProject}
                          onUpdate={updateProject}
                          onAddTechnicians={openWizardForProject}
                        />
                      ))
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <OnboardingWizard
        open={wizardOpen}
        onOpenChange={v => { setWizardOpen(v); if (!v) { setWizardClientId(undefined); setWizardProjectId(undefined) } }}
        onComplete={load}
        initialClientId={wizardClientId}
        initialProjectId={wizardProjectId}
      />
    </div>
  )
}
