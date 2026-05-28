import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabase'
import { geocodeAddress } from '@/lib/geocoding'
import {
  FleetLocation, FleetLocationType,
  FLEET_LOCATION_TYPES, LOCATION_COLORS,
} from '@/types/fleet'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  Plus, Edit2, Trash2, MapPin, Search, X, Save,
  Loader2, RefreshCw, Building2, ToggleLeft, ToggleRight,
} from 'lucide-react'

const inputCls = cn(
  'w-full bg-base border border-border-soft rounded-xl px-3 py-2 text-sm text-text-primary',
  'placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors',
)

// ── Modal crear/editar ────────────────────────────────────────────────────────

interface ModalState { mode: 'create' | 'edit'; loc?: FleetLocation }

function LocationModal({ state, onClose, onSaved }: {
  state: ModalState; onClose: () => void; onSaved: () => void
}) {
  const isEdit = state.mode === 'edit'
  const [name,    setName]    = useState(state.loc?.name    ?? '')
  const [type,    setType]    = useState<FleetLocationType>(state.loc?.type ?? 'office')
  const [address, setAddress] = useState(state.loc?.address ?? '')
  const [lat,     setLat]     = useState(state.loc?.lat?.toString() ?? '')
  const [lng,     setLng]     = useState(state.loc?.lng?.toString() ?? '')
  const [color,   setColor]   = useState(state.loc?.color   ?? FLEET_LOCATION_TYPES['office'].defaultColor)
  const [notes,   setNotes]   = useState(state.loc?.notes   ?? '')
  const [geocoding, setGeocoding] = useState(false)
  const [saving,    setSaving]    = useState(false)

  function handleTypeChange(t: FleetLocationType) {
    setType(t)
    if (!state.loc) setColor(FLEET_LOCATION_TYPES[t].defaultColor)
  }

  async function handleGeocode() {
    if (!address.trim() || geocoding) return
    setGeocoding(true)
    try {
      const res = await geocodeAddress(address.trim())
      if (!res) { toast.error('No se encontró la dirección'); return }
      setLat(res.lat.toFixed(6))
      setLng(res.lng.toFixed(6))
      toast.success('Coordenadas obtenidas')
    } catch {
      toast.error('Error al geocodificar')
    } finally {
      setGeocoding(false)
    }
  }

  async function handleSave() {
    if (!name.trim()) { toast.error('El nombre es requerido'); return }
    const latN = parseFloat(lat)
    const lngN = parseFloat(lng)
    if (isNaN(latN) || isNaN(lngN)) {
      toast.error('Ingresá una dirección válida y buscá las coordenadas')
      return
    }
    setSaving(true)
    try {
      const payload = {
        name:      name.trim(),
        type,
        address:   address.trim() || null,
        lat:       latN,
        lng:       lngN,
        color,
        notes:     notes.trim() || null,
        is_active: true,
      }
      if (isEdit && state.loc) {
        const { error } = await supabase.from('fleet_locations').update(payload).eq('id', state.loc.id)
        if (error) throw error
        toast.success('Ubicación actualizada')
      } else {
        const { data: sess } = await supabase.auth.getSession()
        const { error } = await supabase.from('fleet_locations').insert({
          ...payload, created_by: sess.session?.user.id ?? null,
        })
        if (error) throw error
        toast.success('Ubicación creada')
      }
      onSaved()
      onClose()
    } catch (err: any) {
      toast.error(err.message ?? 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const cfg = FLEET_LOCATION_TYPES[type]

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      onClick={(e) => { if (!saving && e.target === e.currentTarget) onClose() }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative z-10 w-full max-w-md mx-4 bg-surface border border-border-soft rounded-2xl shadow-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b border-border-soft">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
            style={{ background: color + '20', border: `2px solid ${color}` }}>
            {cfg.emoji}
          </div>
          <div className="flex-1">
            <p className="font-bold text-text-primary text-sm">
              {isEdit ? 'Editar ubicación' : 'Nueva ubicación de flota'}
            </p>
            <p className="text-text-muted text-xs mt-0.5">Bodegas, oficinas y puntos para la flota</p>
          </div>
          {!saving && (
            <button onClick={onClose} className="text-text-muted hover:text-text-primary p-1 rounded-lg hover:bg-surface-raised transition-colors">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-5 space-y-4">

          {/* Tipo */}
          <div>
            <label className="text-xs text-text-muted font-medium mb-2 block">Tipo</label>
            <div className="grid grid-cols-5 gap-1.5">
              {(Object.entries(FLEET_LOCATION_TYPES) as [FleetLocationType, typeof FLEET_LOCATION_TYPES[FleetLocationType]][]).map(([t, c]) => (
                <button
                  key={t}
                  onClick={() => handleTypeChange(t)}
                  className={cn(
                    'flex flex-col items-center gap-1 py-2 px-1 rounded-xl border text-xs transition-all',
                    type === t
                      ? 'border-primary/50 bg-primary/10 text-primary'
                      : 'border-border-soft text-text-muted hover:text-text-secondary hover:bg-surface-raised',
                  )}
                >
                  <span className="text-base">{c.emoji}</span>
                  <span className="text-[10px] text-center leading-tight">{c.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Nombre */}
          <div>
            <label className="text-xs text-text-muted font-medium mb-1.5 block">Nombre *</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ej: Bodega Principal Norte"
              className={inputCls}
              autoFocus
            />
          </div>

          {/* Dirección + Geocode */}
          <div>
            <label className="text-xs text-text-muted font-medium mb-1.5 block">Dirección</label>
            <div className="flex gap-2">
              <input
                value={address}
                onChange={e => setAddress(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleGeocode() }}
                placeholder="Calle 100 #45-20, Bogotá"
                className={cn(inputCls, 'flex-1')}
              />
              <button
                onClick={handleGeocode}
                disabled={geocoding || !address.trim()}
                title="Obtener coordenadas"
                className="px-3 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary transition-colors disabled:opacity-50 flex items-center"
              >
                {geocoding
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Search className="w-4 h-4" />
                }
              </button>
            </div>
          </div>

          {/* Lat / Lng */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-text-muted font-medium mb-1.5 block">Latitud *</label>
              <input value={lat} onChange={e => setLat(e.target.value)} placeholder="4.711000" className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-text-muted font-medium mb-1.5 block">Longitud *</label>
              <input value={lng} onChange={e => setLng(e.target.value)} placeholder="-74.072100" className={inputCls} />
            </div>
          </div>
          {!lat && !lng && (
            <p className="text-[11px] text-text-muted -mt-2 flex items-center gap-1.5">
              <MapPin className="w-3 h-3 flex-shrink-0" />
              Ingresá una dirección y presioná el botón buscar para obtener las coordenadas automáticamente.
            </p>
          )}

          {/* Color */}
          <div>
            <label className="text-xs text-text-muted font-medium mb-2 block">Color en mapa</label>
            <div className="flex gap-2 flex-wrap">
              {LOCATION_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={cn(
                    'w-7 h-7 rounded-lg border-2 transition-all',
                    color === c ? 'border-white scale-110 shadow-md' : 'border-transparent hover:border-white/50',
                  )}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>

          {/* Notas */}
          <div>
            <label className="text-xs text-text-muted font-medium mb-1.5 block">Notas <span className="text-text-muted/60">(opcional)</span></label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Horario de atención, contacto, indicaciones…"
              rows={2}
              className={cn(inputCls, 'resize-none')}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 pt-2 flex gap-2 border-t border-border-soft">
          <button onClick={onClose} disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-surface-raised hover:bg-border-soft text-text-secondary text-sm font-medium transition-colors disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving || !name.trim()}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-base text-sm font-semibold transition-colors disabled:opacity-50">
            {saving
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <><Save className="w-4 h-4" />{isEdit ? 'Guardar' : 'Crear ubicación'}</>
            }
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ── Component principal ───────────────────────────────────────────────────────

export function FleetLocationsManagement() {
  const [locations, setLocations] = useState<FleetLocation[]>([])
  const [loading,   setLoading]   = useState(true)
  const [modal,     setModal]     = useState<ModalState | null>(null)
  const [deleting,  setDeleting]  = useState<string | null>(null)
  const [toggling,  setToggling]  = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('fleet_locations').select('*').order('name')
    setLocations((data as FleetLocation[]) ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handleDelete(id: string) {
    if (!confirm('¿Eliminar esta ubicación? Las asignaciones vinculadas perderán la referencia.')) return
    setDeleting(id)
    try {
      const { error } = await supabase.from('fleet_locations').delete().eq('id', id)
      if (error) throw error
      toast.success('Ubicación eliminada')
      setLocations(prev => prev.filter(l => l.id !== id))
    } catch (err: any) {
      toast.error(err.message ?? 'Error al eliminar')
    } finally {
      setDeleting(null)
    }
  }

  async function handleToggleActive(loc: FleetLocation) {
    setToggling(loc.id)
    const { error } = await supabase
      .from('fleet_locations')
      .update({ is_active: !loc.is_active })
      .eq('id', loc.id)
    if (error) { toast.error('Error al actualizar'); setToggling(null); return }
    setLocations(prev => prev.map(l => l.id === loc.id ? { ...l, is_active: !l.is_active } : l))
    setToggling(null)
  }

  const active   = locations.filter(l => l.is_active)
  const inactive = locations.filter(l => !l.is_active)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-text-primary flex items-center gap-2">
            <Building2 className="w-4 h-4 text-primary" />
            Ubicaciones de flota
          </h2>
          <p className="text-xs text-text-muted mt-0.5">
            Bodegas, oficinas y puntos compartidos visibles en el mapa para todos los técnicos
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={load} className="p-2 rounded-lg hover:bg-surface-raised text-text-muted hover:text-text-primary transition-colors" title="Recargar">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setModal({ mode: 'create' })}
            className="flex items-center gap-1.5 bg-primary hover:bg-primary-hover text-base text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Nueva ubicación
          </button>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-16 gap-2 text-text-muted text-sm">
          <Loader2 className="w-5 h-5 animate-spin" /> Cargando…
        </div>
      ) : locations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="w-16 h-16 rounded-2xl bg-surface-raised flex items-center justify-center text-3xl">🏢</div>
          <div className="text-center">
            <p className="text-text-primary font-semibold text-sm">Sin ubicaciones aún</p>
            <p className="text-text-muted text-xs mt-1 max-w-xs">
              Agregá bodegas, oficinas y puntos de referencia para que aparezcan en el mapa principal
            </p>
          </div>
          <button
            onClick={() => setModal({ mode: 'create' })}
            className="flex items-center gap-1.5 bg-primary hover:bg-primary-hover text-base text-xs font-semibold px-4 py-2 rounded-lg transition-colors mt-1"
          >
            <Plus className="w-3.5 h-3.5" /> Agregar primera ubicación
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Activas */}
          {active.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                Activas · {active.length}
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {active.map(loc => <LocationCard key={loc.id} loc={loc} onEdit={() => setModal({ mode: 'edit', loc })} onDelete={handleDelete} onToggle={handleToggleActive} deleting={deleting} toggling={toggling} />)}
              </div>
            </div>
          )}

          {/* Inactivas */}
          {inactive.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                Inactivas · {inactive.length}
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {inactive.map(loc => <LocationCard key={loc.id} loc={loc} onEdit={() => setModal({ mode: 'edit', loc })} onDelete={handleDelete} onToggle={handleToggleActive} deleting={deleting} toggling={toggling} />)}
              </div>
            </div>
          )}
        </div>
      )}

      {modal && (
        <LocationModal state={modal} onClose={() => setModal(null)} onSaved={load} />
      )}
    </div>
  )
}

function LocationCard({ loc, onEdit, onDelete, onToggle, deleting, toggling }: {
  loc: FleetLocation
  onEdit: () => void
  onDelete: (id: string) => void
  onToggle: (loc: FleetLocation) => void
  deleting: string | null
  toggling: string | null
}) {
  const cfg = FLEET_LOCATION_TYPES[loc.type]
  return (
    <div className={cn(
      'bg-surface border border-border-soft rounded-xl p-4 flex items-start gap-3 transition-all hover:border-border',
      !loc.is_active && 'opacity-50',
    )}>
      <div
        className="w-11 h-11 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
        style={{ background: loc.color + '20', border: `2px solid ${loc.color}` }}
      >
        {cfg.emoji}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-text-primary text-sm truncate">{loc.name}</p>
            <p className="text-xs text-text-muted">{cfg.label}</p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button onClick={onEdit} className="p-1.5 rounded-lg hover:bg-surface-raised text-text-muted hover:text-primary transition-colors" title="Editar">
              <Edit2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onDelete(loc.id)}
              disabled={deleting === loc.id}
              className="p-1.5 rounded-lg hover:bg-danger/10 text-text-muted hover:text-danger transition-colors"
              title="Eliminar"
            >
              {deleting === loc.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
        {loc.address && (
          <div className="flex items-center gap-1 mt-2">
            <MapPin className="w-3 h-3 text-text-muted flex-shrink-0" />
            <p className="text-xs text-text-muted truncate">{loc.address}</p>
          </div>
        )}
        {loc.notes && <p className="text-xs text-text-muted mt-1 line-clamp-1">{loc.notes}</p>}
        <button
          onClick={() => onToggle(loc)}
          disabled={toggling === loc.id}
          className={cn(
            'mt-2.5 flex items-center gap-1.5 text-[11px] font-medium transition-colors',
            loc.is_active ? 'text-success hover:text-success/80' : 'text-text-muted hover:text-text-secondary',
          )}
        >
          {toggling === loc.id
            ? <Loader2 className="w-3 h-3 animate-spin" />
            : loc.is_active
              ? <ToggleRight className="w-4 h-4" />
              : <ToggleLeft  className="w-4 h-4" />
          }
          {loc.is_active ? 'Visible en mapa' : 'Oculta en mapa'}
        </button>
      </div>
    </div>
  )
}
