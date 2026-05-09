import { useEffect, useState } from 'react'
import {
  Plus, RefreshCw, Trash2, Edit2, Check, X, QrCode,
  Loader2, Smartphone, WifiOff,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { TechnicianRegistrationModal } from '@/components/modals/TechnicianRegistrationModal'

interface Technician {
  id: string
  name: string
  phone: string | null
  device_id: string | null
  active: boolean
  created_at: string
}

interface TechStatus {
  id: string
  status: string
  last_seen: string | null
  battery: number | null
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  moving:   { label: 'En movimiento', color: 'text-success' },
  idle:     { label: 'Inactivo',      color: 'text-warning' },
  stopped:  { label: 'Detenido',      color: 'text-text-muted' },
  offline:  { label: 'Sin conexión',  color: 'text-danger' },
  accident: { label: '¡Accidente!',   color: 'text-danger' },
}

function StatusBadge({ status }: { status: string | undefined }) {
  const cfg = STATUS_LABELS[status ?? 'offline'] ?? STATUS_LABELS['offline']
  return (
    <span className={cn('text-xs font-medium', cfg.color)}>
      {cfg.label}
    </span>
  )
}

export function TechnicianManagement() {
  const [techs, setTechs]                 = useState<Technician[]>([])
  const [statuses, setStatuses]           = useState<Record<string, TechStatus>>({})
  const [loading, setLoading]             = useState(true)
  const [error, setError]                 = useState<string | null>(null)
  const [editingId, setEditingId]         = useState<string | null>(null)
  const [editName, setEditName]           = useState('')
  const [editPhone, setEditPhone]         = useState('')
  const [savingId, setSavingId]           = useState<string | null>(null)
  const [togglingId, setTogglingId]       = useState<string | null>(null)
  const [deletingId, setDeletingId]       = useState<string | null>(null)
  const [createOpen, setCreateOpen]       = useState(false)
  const [qrTech, setQrTech]              = useState<{ id: string; name: string } | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [techsRes, statusRes] = await Promise.all([
        supabase
          .from('technicians')
          .select('id, name, phone, device_id, active, created_at')
          .order('created_at', { ascending: false }),
        supabase
          .from('technician_current_status')
          .select('id, status, last_seen, battery'),
      ])
      if (techsRes.error) throw new Error(techsRes.error.message)
      setTechs(techsRes.data ?? [])
      const statusMap: Record<string, TechStatus> = {}
      for (const s of statusRes.data ?? []) statusMap[s.id] = s
      setStatuses(statusMap)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function startEdit(tech: Technician) {
    setEditingId(tech.id)
    setEditName(tech.name)
    setEditPhone(tech.phone ?? '')
  }

  function cancelEdit() {
    setEditingId(null)
    setEditName('')
    setEditPhone('')
  }

  async function saveEdit(id: string) {
    if (!editName.trim()) return
    setSavingId(id)
    try {
      const { error } = await supabase
        .from('technicians')
        .update({ name: editName.trim(), phone: editPhone.trim() || null })
        .eq('id', id)
      if (error) throw error
      setTechs(prev => prev.map(t => t.id === id ? { ...t, name: editName.trim(), phone: editPhone.trim() || null } : t))
      cancelEdit()
    } catch (err: any) {
      alert(err.message)
    } finally {
      setSavingId(null)
    }
  }

  async function toggleActive(tech: Technician) {
    setTogglingId(tech.id)
    try {
      const { error } = await supabase
        .from('technicians')
        .update({ active: !tech.active })
        .eq('id', tech.id)
      if (error) throw error
      setTechs(prev => prev.map(t => t.id === tech.id ? { ...t, active: !t.active } : t))
    } catch (err: any) {
      alert(err.message)
    } finally {
      setTogglingId(null)
    }
  }

  async function deleteTech(tech: Technician) {
    const confirmed = window.confirm(
      `¿Eliminar al técnico "${tech.name}"?\nSe borrarán también sus tokens de registro. Esta acción no se puede deshacer.`,
    )
    if (!confirmed) return
    setDeletingId(tech.id)
    try {
      await supabase.from('registration_tokens').delete().eq('technician_id', tech.id)
      const { error } = await supabase.from('technicians').delete().eq('id', tech.id)
      if (error) throw error
      setTechs(prev => prev.filter(t => t.id !== tech.id))
    } catch (err: any) {
      alert(err.message)
    } finally {
      setDeletingId(null)
    }
  }

  function downloadCSV() {
    const header = 'ID,Nombre,Teléfono,Device ID,Activo,Estado,Batería,Último acceso,Registrado'
    const rows = techs.map(t => {
      const s = statuses[t.id]
      return [
        t.id,
        `"${t.name}"`,
        t.phone ?? '',
        t.device_id ?? '',
        t.active ? 'Sí' : 'No',
        s?.status ?? 'offline',
        s?.battery != null ? `${s.battery}%` : '',
        s?.last_seen ? format(parseISO(s.last_seen), 'dd/MM/yyyy HH:mm') : '',
        format(parseISO(t.created_at), 'dd/MM/yyyy'),
      ].join(',')
    })
    const csv = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tecnicos_${format(new Date(), 'yyyyMMdd')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-text-primary font-semibold text-sm">
          Técnicos de Campo
          {!loading && <span className="text-text-muted font-normal ml-2">({techs.length})</span>}
        </h2>
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={downloadCSV}
            title="Exportar CSV"
            className="text-xs text-text-muted hover:text-text-primary transition-colors border border-border rounded-lg px-2.5 py-1.5"
          >
            Exportar CSV
          </button>
          <button
            onClick={load}
            title="Actualizar"
            className="text-text-muted hover:text-text-primary transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 bg-primary hover:bg-primary/90 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Nuevo técnico
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="bg-danger/10 border border-danger/30 text-danger text-sm rounded-xl px-4 py-3">
          {error}
        </div>
      ) : techs.length === 0 ? (
        <div className="text-center py-16 text-text-muted text-sm">No hay técnicos registrados</div>
      ) : (
        <div className="bg-surface border border-border-soft rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-soft">
                <th className="text-left text-xs text-text-muted font-medium px-4 py-3">Nombre / Teléfono</th>
                <th className="text-left text-xs text-text-muted font-medium px-4 py-3">Estado</th>
                <th className="text-left text-xs text-text-muted font-medium px-4 py-3">Dispositivo</th>
                <th className="text-left text-xs text-text-muted font-medium px-4 py-3">Registrado</th>
                <th className="text-right text-xs text-text-muted font-medium px-4 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {techs.map(tech => {
                const st = statuses[tech.id]
                const isEditing  = editingId === tech.id
                const isSaving   = savingId === tech.id
                const isToggling = togglingId === tech.id
                const isDeleting = deletingId === tech.id

                return (
                  <tr key={tech.id} className={cn(
                    'border-b border-border-soft last:border-0 transition-colors',
                    tech.active ? 'hover:bg-surface-raised' : 'opacity-50 hover:bg-surface-raised',
                  )}>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <div className="space-y-1.5">
                          <input
                            value={editName}
                            onChange={e => setEditName(e.target.value)}
                            placeholder="Nombre"
                            className="w-full bg-base border border-border-soft rounded-lg px-2.5 py-1.5 text-xs text-text-primary focus:outline-none focus:border-primary"
                          />
                          <input
                            value={editPhone}
                            onChange={e => setEditPhone(e.target.value)}
                            placeholder="Teléfono (opcional)"
                            className="w-full bg-base border border-border-soft rounded-lg px-2.5 py-1.5 text-xs text-text-primary focus:outline-none focus:border-primary"
                          />
                        </div>
                      ) : (
                        <div>
                          <p className="text-text-primary text-xs font-medium">{tech.name}</p>
                          {tech.phone && <p className="text-text-muted text-xs">{tech.phone}</p>}
                          {!tech.active && <span className="text-xs text-warning">Desactivado</span>}
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      {tech.device_id ? (
                        <div>
                          <StatusBadge status={st?.status} />
                          {st?.battery != null && (
                            <p className="text-text-muted text-xs mt-0.5">{st.battery}% batería</p>
                          )}
                        </div>
                      ) : (
                        <span className="text-text-muted text-xs flex items-center gap-1">
                          <WifiOff className="w-3 h-3" /> Sin app
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      {tech.device_id ? (
                        <span className="text-text-muted text-xs flex items-center gap-1">
                          <Smartphone className="w-3 h-3 flex-shrink-0" />
                          <span className="font-mono truncate max-w-[120px]" title={tech.device_id}>
                            {tech.device_id.slice(0, 12)}…
                          </span>
                        </span>
                      ) : (
                        <span className="text-text-muted text-xs">No registrado</span>
                      )}
                    </td>

                    <td className="px-4 py-3 text-text-muted text-xs">
                      {format(parseISO(tech.created_at), 'dd MMM yyyy', { locale: es })}
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {isEditing ? (
                          <>
                            <button
                              onClick={() => saveEdit(tech.id)}
                              disabled={isSaving}
                              className="text-success hover:text-success/80 p-1 rounded-lg hover:bg-success/10 transition-colors disabled:opacity-40"
                            >
                              {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="text-text-muted hover:text-text-primary p-1 rounded-lg hover:bg-surface-raised transition-colors"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => setQrTech({ id: tech.id, name: tech.name })}
                              title="Generar QR"
                              className="text-text-muted hover:text-primary p-1 rounded-lg hover:bg-primary/10 transition-colors"
                            >
                              <QrCode className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => startEdit(tech)}
                              title="Editar"
                              className="text-text-muted hover:text-text-primary p-1 rounded-lg hover:bg-surface-raised transition-colors"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => toggleActive(tech)}
                              disabled={isToggling || isDeleting}
                              title={tech.active ? 'Desactivar' : 'Activar'}
                              className={cn(
                                'text-xs px-2 py-1 rounded-lg transition-colors disabled:opacity-40',
                                tech.active
                                  ? 'text-warning hover:text-warning/80 hover:bg-warning/10'
                                  : 'text-success hover:text-success/80 hover:bg-success/10',
                              )}
                            >
                              {isToggling
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : tech.active ? 'Desactivar' : 'Activar'}
                            </button>
                            <button
                              onClick={() => deleteTech(tech)}
                              disabled={isDeleting || isToggling}
                              title="Eliminar"
                              className="text-text-muted hover:text-danger p-1 rounded-lg hover:bg-danger/10 transition-colors disabled:opacity-40"
                            >
                              {isDeleting
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : <Trash2 className="w-3.5 h-3.5" />}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <TechnicianRegistrationModal
        open={createOpen}
        onOpenChange={open => {
          setCreateOpen(open)
          if (!open) load()
        }}
      />

      {qrTech && (
        <TechnicianRegistrationModal
          open={!!qrTech}
          onOpenChange={open => { if (!open) setQrTech(null) }}
          existingTechnician={qrTech}
        />
      )}
    </div>
  )
}
