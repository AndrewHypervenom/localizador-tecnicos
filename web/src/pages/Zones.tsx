import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react'
import { MapContainer, useMap } from 'react-leaflet'
import { MapBaseLayer } from '@/components/map/MapBaseLayer'
import L from 'leaflet'
import { motion, AnimatePresence } from 'framer-motion'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Plus, Edit2, Trash2, ArrowLeft, Layers, CheckCircle, X,
  MousePointer, Pencil, AlertTriangle, Home, Flag, Shield,
  Save, Search, RotateCcw, Move, MapPin, Building2,
} from 'lucide-react'
import { ZoneDetailPanel } from '@/components/map/ZoneDetailPanel'
import { supabase } from '@/lib/supabase'
import { useZones, coordsToWkt } from '@/hooks/useZones'
import { useZonesStore } from '@/store/zonesStore'
import { cn } from '@/lib/utils'
import {
  Zone, ZoneType, ZONE_TYPE_LABELS, ZONE_TYPE_LABEL_KEYS, ZONE_TYPE_COLORS, ZONE_PALETTE,
} from '@/types/zones'
import { deleteAllZones } from '@/lib/generateCityZones'
import { getLeaderScope } from '@/lib/leaderContext'
import { geocodeAddress, geocodeWithClaude, GeocodingResult, circlePolygon, fetchCityBoundary, CityBoundaryResult, resolveMapsLink, isShortMapsLink } from '@/lib/geocoding'
import { useI18n } from '@/lib/i18n/i18n'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type AppMode = 'idle' | 'creating' | 'drawing' | 'editing'

interface ZoneFormData {
  name:        string
  description: string
  type:        ZoneType
  color:       string
}

const defaultForm: ZoneFormData = {
  name:        '',
  description: '',
  type:        'service_area',
  color:       ZONE_TYPE_COLORS.service_area,
}

// ─────────────────────────────────────────────────────────────────────────────
// DrawController — gestiona el dibujo de polígonos en el mapa
// ─────────────────────────────────────────────────────────────────────────────

export interface DrawHandle {
  finish: () => void
  undo:   () => void
  cancel: () => void
}

interface DrawControllerProps {
  active:          boolean
  previewColor:    string
  onComplete:      (coords: [number, number][]) => void
  onCancel:        () => void
  onPointsChange:  (count: number) => void
}

const DrawController = forwardRef<DrawHandle, DrawControllerProps>(
  function DrawController({ active, previewColor, onComplete, onCancel, onPointsChange }, ref) {
    const { t } = useI18n()
    const map       = useMap()
    const pointsRef = useRef<[number, number][]>([])
    const layersRef = useRef<{ polygon: L.Polygon | null; markers: L.CircleMarker[] }>({
      polygon: null, markers: [],
    })

    const clearPreview = useCallback(() => {
      layersRef.current.polygon?.remove()
      layersRef.current.polygon = null
      layersRef.current.markers.forEach((m) => m.remove())
      layersRef.current.markers = []
    }, [])

    const redrawPreview = useCallback((pts: [number, number][]) => {
      clearPreview()
      if (pts.length === 0) return
      pts.forEach((p, i) => {
        const m = L.circleMarker(p, {
          radius:      i === 0 ? 8 : 5,
          color:       previewColor,
          fillColor:   i === 0 ? previewColor : '#ffffff',
          fillOpacity: 1,
          weight:      2.5,
        }).addTo(map)
        layersRef.current.markers.push(m)
      })
      if (pts.length >= 2) {
        layersRef.current.polygon = L.polygon(pts, {
          color:       previewColor,
          weight:      2,
          opacity:     0.9,
          fillColor:   previewColor,
          fillOpacity: 0.15,
          dashArray:   '6 4',
        }).addTo(map)
      }
    }, [map, clearPreview, previewColor])

    const handleFinish = useCallback(() => {
      if (pointsRef.current.length < 3) {
        toast.warning(t('zonesPage.need3Points'))
        return
      }
      const coords = [...pointsRef.current]
      clearPreview()
      pointsRef.current = []
      onPointsChange(0)
      onComplete(coords)
    }, [clearPreview, onComplete, onPointsChange])

    const handleUndo = useCallback(() => {
      if (pointsRef.current.length === 0) return
      pointsRef.current = pointsRef.current.slice(0, -1)
      onPointsChange(pointsRef.current.length)
      redrawPreview(pointsRef.current)
    }, [redrawPreview, onPointsChange])

    const handleCancel = useCallback(() => {
      clearPreview()
      pointsRef.current = []
      onPointsChange(0)
      onCancel()
    }, [clearPreview, onCancel, onPointsChange])

    useImperativeHandle(ref, () => ({
      finish: handleFinish,
      undo:   handleUndo,
      cancel: handleCancel,
    }), [handleFinish, handleUndo, handleCancel])

    useEffect(() => {
      if (!active) {
        clearPreview()
        pointsRef.current = []
        onPointsChange(0)
        map.getContainer().style.cursor = ''
        return
      }
      map.getContainer().style.cursor = 'crosshair'
      const onClick = (e: L.LeafletMouseEvent) => {
        pointsRef.current = [...pointsRef.current, [e.latlng.lat, e.latlng.lng]]
        onPointsChange(pointsRef.current.length)
        redrawPreview(pointsRef.current)
      }
      map.on('click', onClick)
      return () => { map.off('click', onClick); map.getContainer().style.cursor = '' }
    }, [active, map, redrawPreview, clearPreview, onPointsChange])

    return null
  }
)

// ─────────────────────────────────────────────────────────────────────────────
// VertexEditor — arrastra/agrega/elimina vértices de una zona existente
// ─────────────────────────────────────────────────────────────────────────────

interface VertexEditorProps {
  coords:   [number, number][]
  color:    string
  onChange: (coords: [number, number][]) => void
}

function VertexEditor({ coords, color, onChange }: VertexEditorProps) {
  const { t } = useI18n()
  const map         = useMap()
  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange }, [onChange])

  useEffect(() => {
    const live = { coords: [...coords] }

    const polygon = L.polygon(coords, {
      color,
      weight:      2.5,
      opacity:     1,
      fillColor:   color,
      fillOpacity: 0.18,
    }).addTo(map)

    const vertexMarkers: L.Marker[] = []
    const midMarkers:    L.Marker[] = []

    const buildMidMarkers = (pts: [number, number][]) => {
      midMarkers.forEach((m) => m.remove())
      midMarkers.length = 0
      pts.forEach((pt, i) => {
        const next = pts[(i + 1) % pts.length]
        const mid: [number, number] = [(pt[0] + next[0]) / 2, (pt[1] + next[1]) / 2]
        const icon = L.divIcon({
          className: '',
          html: `<div style="width:10px;height:10px;border-radius:50%;background:#fff;border:2px solid ${color};opacity:0.8;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.5)"></div>`,
          iconSize: [10, 10],
          iconAnchor: [5, 5],
        })
        const m = L.marker(mid, { icon, zIndexOffset: 900 }).addTo(map)
        m.on('click', (e) => {
          L.DomEvent.stopPropagation(e)
          const next = [...live.coords]
          next.splice(i + 1, 0, mid)
          onChangeRef.current(next)
        })
        midMarkers.push(m)
      })
    }

    coords.forEach((coord, i) => {
      const isFirst = i === 0
      const icon = L.divIcon({
        className: '',
        html: `<div style="
          width:${isFirst ? 16 : 14}px;
          height:${isFirst ? 16 : 14}px;
          border-radius:50%;
          background:${color};
          border:${isFirst ? '3px' : '2.5px'} solid white;
          box-shadow:0 2px 8px rgba(0,0,0,.65);
          cursor:grab;
        "></div>`,
        iconSize:   [isFirst ? 16 : 14, isFirst ? 16 : 14],
        iconAnchor: [isFirst ? 8 : 7,   isFirst ? 8 : 7],
      })

      const m = L.marker(coord, { icon, draggable: true, zIndexOffset: 1000 }).addTo(map)

      m.on('drag', () => {
        const ll = m.getLatLng()
        live.coords = live.coords.map((c, j) =>
          j === i ? [ll.lat, ll.lng] as [number, number] : c
        )
        polygon.setLatLngs(live.coords)
      })

      m.on('dragend', () => {
        onChangeRef.current([...live.coords])
      })

      // Clic derecho = eliminar vértice
      m.on('contextmenu', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e)
        if (live.coords.length > 3) {
          onChangeRef.current(live.coords.filter((_, j) => j !== i))
        } else {
          toast.warning(t('zonesPage.need3Vertices'))
        }
      })

      vertexMarkers.push(m)
    })

    buildMidMarkers(coords)

    return () => {
      polygon.remove()
      vertexMarkers.forEach((m) => m.remove())
      midMarkers.forEach((m) => m.remove())
    }
  }, [coords, color, map])

  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de mapa
// ─────────────────────────────────────────────────────────────────────────────

function AutoCenter() {
  const map = useMap()
  useEffect(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => map.setView([coords.latitude, coords.longitude], 13, { animate: false }),
      () => {},
      { timeout: 6000, maximumAge: 60_000 }
    )
  }, [map])
  return null
}

function MapFitEffect({ coords }: { coords: [number, number][] | null }) {
  const map = useMap()
  useEffect(() => {
    if (!coords || coords.length < 2) return
    try {
      map.fitBounds(
        L.latLngBounds(coords.map((c) => L.latLng(c[0], c[1]))).pad(0.35),
        { animate: true, duration: 0.6 }
      )
    } catch {}
  }, [coords, map])
  return null
}

interface ZonesDisplayProps {
  zones:      Zone[]
  selectedId: string | null
  excludeId:  string | null
  onSelect:   (id: string) => void
}

function ZonesDisplay({ zones, selectedId, excludeId, onSelect }: ZonesDisplayProps) {
  const map      = useMap()
  const layerRef = useRef<Record<string, L.Polygon>>({})

  useEffect(() => {
    const visible = zones.filter((z) => z.id !== excludeId)
    const ids = new Set(visible.map((z) => z.id))

    Object.keys(layerRef.current).forEach((id) => {
      if (!ids.has(id)) { layerRef.current[id].remove(); delete layerRef.current[id] }
    })

    visible.forEach((zone) => {
      const sel = zone.id === selectedId
      if (layerRef.current[zone.id]) layerRef.current[zone.id].remove()
      const poly = L.polygon(zone.coordinates, {
        color:       zone.color,
        weight:      sel ? 3 : 2,
        opacity:     sel ? 1 : 0.7,
        fillColor:   zone.color,
        fillOpacity: sel ? 0.22 : 0.1,
        dashArray:   zone.type === 'restricted' ? '8 4' : undefined,
      })
      poly.on('click', () => onSelect(zone.id))
      poly.addTo(map)
      layerRef.current[zone.id] = poly
    })

    return () => {
      Object.values(layerRef.current).forEach((l) => l.remove())
      layerRef.current = {}
    }
  }, [zones, selectedId, excludeId, map, onSelect])

  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Iconos y FormFields compartidos
// ─────────────────────────────────────────────────────────────────────────────

const ZONE_ICONS: Record<ZoneType, React.ReactNode> = {
  service_area: <Flag   className="w-3.5 h-3.5" />,
  restricted:   <Shield className="w-3.5 h-3.5" />,
  home_base:    <Home   className="w-3.5 h-3.5" />,
  checkpoint:   <Layers className="w-3.5 h-3.5" />,
}

function ZoneTypeIcon({ type, color }: { type: ZoneType; color: string }) {
  return <span style={{ color }}>{ZONE_ICONS[type]}</span>
}

interface FormFieldsProps {
  form:       ZoneFormData
  onChange:   (f: ZoneFormData) => void
  autoFocus?: boolean
}

function FormFields({ form, onChange, autoFocus }: FormFieldsProps) {
  const { t } = useI18n()
  return (
    <div className="space-y-4">
      {/* Nombre */}
      <div>
        <label className="block text-xs text-text-muted uppercase tracking-wider mb-1.5">{t('zonesPage.nameLabel')}</label>
        <input
          autoFocus={autoFocus}
          value={form.name}
          onChange={(e) => onChange({ ...form, name: e.target.value })}
          placeholder={t('zonesPage.namePlaceholder')}
          className="w-full bg-base border border-border-soft rounded-xl px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
        />
      </div>

      {/* Descripción */}
      <div>
        <label className="block text-xs text-text-muted uppercase tracking-wider mb-1.5">{t('zonesPage.descLabel')}</label>
        <input
          value={form.description}
          onChange={(e) => onChange({ ...form, description: e.target.value })}
          placeholder={t('zonesPage.descPlaceholder')}
          className="w-full bg-base border border-border-soft rounded-xl px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
        />
      </div>

      {/* Tipo */}
      <div>
        <label className="block text-xs text-text-muted uppercase tracking-wider mb-2">{t('zonesPage.zoneType')}</label>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(ZONE_TYPE_LABELS) as ZoneType[]).map((ztype) => (
            <button
              key={ztype}
              type="button"
              onClick={() => onChange({
                ...form,
                type: ztype,
                // auto-sync color solo si el color actual era del tipo anterior
                color: form.color === ZONE_TYPE_COLORS[form.type] ? ZONE_TYPE_COLORS[ztype] : form.color,
              })}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-all text-left',
                form.type === ztype
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-border-soft bg-base text-text-secondary hover:border-border hover:bg-surface-raised'
              )}
            >
              <span style={{ color: ZONE_TYPE_COLORS[ztype] }}>{ZONE_ICONS[ztype]}</span>
              {t(ZONE_TYPE_LABEL_KEYS[ztype])}
            </button>
          ))}
        </div>
      </div>

      {/* Color */}
      <div>
        <label className="block text-xs text-text-muted uppercase tracking-wider mb-2">{t('zonesPage.color')}</label>
        <div className="flex items-center gap-2 flex-wrap">
          {ZONE_PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChange({ ...form, color: c })}
              style={{ background: c }}
              className={cn(
                'w-7 h-7 rounded-full border-2 transition-all hover:scale-110',
                form.color === c ? 'border-white scale-110 shadow-lg' : 'border-transparent'
              )}
            />
          ))}
          <div className="relative">
            <input
              type="color"
              value={form.color}
              onChange={(e) => onChange({ ...form, color: e.target.value })}
              className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
              title={t('zonesPage.customColor')}
            />
            <div
              className="w-7 h-7 rounded-full border-2 border-dashed border-border flex items-center justify-center cursor-pointer hover:scale-110 transition-transform"
              style={{ background: ZONE_PALETTE.includes(form.color) ? 'transparent' : form.color }}
              title={t('zonesPage.customColor')}
            >
              {ZONE_PALETTE.includes(form.color) && (
                <span className="text-text-muted text-[10px] font-bold">+</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Vista previa */}
      <div
        className="rounded-xl border px-3 py-2 text-xs flex items-center gap-2 transition-all"
        style={{ borderColor: form.color + '60', background: form.color + '15' }}
      >
        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: form.color }} />
        <span style={{ color: form.color }} className="font-medium truncate">
          {form.name || t('zonesPage.previewName')}
        </span>
        <span className="text-text-muted ml-auto flex-shrink-0">{t(ZONE_TYPE_LABEL_KEYS[form.type])}</span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CityBoundaryPreview — muestra el polígono de ciudad antes de confirmarlo
// ─────────────────────────────────────────────────────────────────────────────

interface CityBoundaryPreviewProps {
  coords: [number, number][]
  color:  string
}

function CityBoundaryPreview({ coords, color }: CityBoundaryPreviewProps) {
  const map = useMap()
  useEffect(() => {
    if (coords.length < 3) return
    const poly = L.polygon(coords, {
      color,
      weight:      2,
      opacity:     0.85,
      fillColor:   color,
      fillOpacity: 0.1,
      dashArray:   '10 6',
    }).addTo(map)
    return () => { poly.remove() }
  }, [coords, color, map])
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Página principal
// ─────────────────────────────────────────────────────────────────────────────

export function Zones() {
  useZones()
  const navigate = useNavigate()
  const { t } = useI18n()

  const { zones, selectedZoneId, selectZone, addZone, updateZone, removeZone } = useZonesStore()

  const [mode,           setMode]           = useState<AppMode>('idle')
  const [newZoneForm,    setNewZoneForm]    = useState<ZoneFormData>({ ...defaultForm })
  const [drawnCoords,    setDrawnCoords]    = useState<[number, number][] | null>(null)
  const [editingZone,    setEditingZone]    = useState<Zone | null>(null)
  const [editCoords,     setEditCoords]     = useState<[number, number][]>([])
  const [editForm,       setEditForm]       = useState<ZoneFormData>({ ...defaultForm })
  const [drawPointCount, setDrawPointCount] = useState(0)
  const [deleteTarget,      setDeleteTarget]      = useState<Zone | null>(null)
  const [clearAllConfirm,   setClearAllConfirm]   = useState(false)
  const [saving,            setSaving]            = useState(false)
  const [deleting,          setDeleting]          = useState(false)
  const [clearingAll,       setClearingAll]       = useState(false)
  const [search,         setSearch]         = useState('')
  const [fitCoords,      setFitCoords]      = useState<[number, number][] | null>(null)
  const drawRef = useRef<DrawHandle>(null)

  const [isSuperAdmin,   setIsSuperAdmin]   = useState(false)
  const [defaultCountry, setDefaultCountry] = useState('Colombia')

  const [companies,      setCompanies]      = useState<{ id: string; name: string }[]>([])
  const [zoneCompanyId,  setZoneCompanyId]  = useState<string>('')
  const [zoneCampaignId, setZoneCampaignId] = useState<string>('')
  const [companyCampaigns, setCompanyCampaigns] = useState<{ id: string; name: string }[]>([])

  const [geocodeQuery,   setGeocodeQuery]   = useState('')
  const [geocodeResult,  setGeocodeResult]  = useState<GeocodingResult | null>(null)
  const [geocodeLoading, setGeocodeLoading] = useState(false)
  const [geocodeRadius,  setGeocodeRadius]  = useState(500) // metros, mínimo 150

  const [citySearch,         setCitySearch]         = useState('')
  const [cityLoading,        setCityLoading]        = useState(false)
  const [cityError,          setCityError]          = useState<string | null>(null)
  const [cityBoundary,       setCityBoundary]       = useState<CityBoundaryResult | null>(null)
  const [knownCities,        setKnownCities]        = useState<string[]>([])

  useEffect(() => {
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const role = session?.user?.app_metadata?.role as string | undefined

      let q = supabase.from('technicians').select('city, country').eq('active', true)
      if (role !== 'superadmin') {
        const { companyIds } = await getLeaderScope()
        if (companyIds.length === 0) { setKnownCities([]); return }
        q = (q as any).in('company_id', companyIds)
      }

      const { data } = await q
      const rows   = data ?? []
      const cities = [...new Set(rows.map((t: any) => t.city).filter(Boolean))] as string[]
      setKnownCities(cities.sort())
      // Detectar país más frecuente para usar en búsqueda de ciudades
      const counts: Record<string, number> = {}
      rows.forEach((t: any) => { if (t.country) counts[t.country] = (counts[t.country] || 0) + 1 })
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0]
      if (top) setDefaultCountry(top)
    })()
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const userId = session?.user?.id ?? ''
      const role   = session?.user?.app_metadata?.role as string | undefined
      setIsSuperAdmin(role === 'superadmin')
      const query  = supabase.from('companies').select('id, name').order('name')
      const scoped = role === 'superadmin' ? query : query.eq('created_by', userId)
      scoped.then(({ data }) => {
        const list = data ?? []
        setCompanies(list)
        // Líderes siempre tienen su empresa pre-seleccionada — no pueden dejarla vacía
        if (role !== 'superadmin' && list.length > 0) setZoneCompanyId(list[0].id)
        else if (list.length === 1) setZoneCompanyId(list[0].id)
      })
    })
  }, [])

  // Cargar campañas de la empresa seleccionada y resetear campaña al cambiar empresa
  useEffect(() => {
    setZoneCampaignId('')
    if (!zoneCompanyId) { setCompanyCampaigns([]); return }
    supabase.from('campaigns').select('id, name').eq('company_id', zoneCompanyId).eq('is_active', true).order('name')
      .then(({ data }) => setCompanyCampaigns(data ?? []))
  }, [zoneCompanyId])

  const defaultCenter: L.LatLngExpression = [4.7110, -74.0721] // Bogotá, Colombia

  // Escape cancela el modo actual
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (mode === 'drawing')  drawRef.current?.cancel()
      else if (mode === 'creating') { setMode('idle'); setDrawnCoords(null) }
      else if (mode === 'editing')  exitEditMode()
      else selectZone(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode])

  // ── Acciones ──

  function startCreate() {
    setNewZoneForm({ ...defaultForm })
    setDrawnCoords(null)
    setGeocodeQuery('')
    setGeocodeResult(null)
    setGeocodeRadius(500)
    setCitySearch('')
    setCityError(null)
    setCityBoundary(null)
    setMode('creating')
    selectZone(null)
  }

  async function handleGeocode() {
    if (!geocodeQuery.trim() || geocodeLoading) return
    setGeocodeLoading(true)
    setGeocodeResult(null)
    try {
      const raw = geocodeQuery.trim()

      const radiusKm = Math.max(geocodeRadius, 150) / 1000  // nunca menos de 150 m

      // 1. Link de Google Maps (largo o corto maps.app.goo.gl) → extraer coordenadas
      const isShort = isShortMapsLink(raw)
      if (isShort) toast.loading(t('zonesPage.resolvingLink'), { id: 'gm-resolve' })
      const gmCoords = await resolveMapsLink(raw)
      if (isShort) toast.dismiss('gm-resolve')
      if (gmCoords) {
        const result: GeocodingResult = { lat: gmCoords.lat, lng: gmCoords.lng, displayName: `📍 ${gmCoords.lat.toFixed(6)}, ${gmCoords.lng.toFixed(6)}` }
        setGeocodeResult(result)
        const circle = circlePolygon(gmCoords.lat, gmCoords.lng, radiusKm)
        setDrawnCoords(circle)
        setFitCoords(circle)
        return
      }
      if (isShort) {
        toast.error(t('zonesPage.shortLinkError'))
        return
      }

      // 2. Texto de dirección → buscar restringido al país de la campaña
      // Forzar país en la consulta para sesgar resultados
      const queryWithCountry = `${raw}, ${defaultCountry}`
      let result: GeocodingResult | null = null
      const claudeRes = await geocodeWithClaude(raw, '')
      result = claudeRes.result
      // Si Claude no devuelve resultado, usar Nominatim con país incluido
      if (!result) result = await geocodeAddress(queryWithCountry)

      if (!result) {
        toast.error(t('zonesPage.addressNotFound', { q: raw, country: defaultCountry }))
        return
      }

      // Validar que el resultado pertenece al país esperado
      const inCountry = result.displayName.toLowerCase().includes(defaultCountry.toLowerCase())
      if (!inCountry) {
        toast.error(t('zonesPage.addressWrongCountry', { country: defaultCountry }))
        return
      }

      setGeocodeResult(result)
      const circle = circlePolygon(result.lat, result.lng, radiusKm)
      setDrawnCoords(circle)
      setFitCoords(circle)
    } catch {
      toast.error(t('zonesPage.geocodeError'))
    } finally {
      setGeocodeLoading(false)
    }
  }

  function handleGenerateFromAddress() {
    if (!geocodeResult) return
    const coords = circlePolygon(geocodeResult.lat, geocodeResult.lng, Math.max(geocodeRadius, 150) / 1000)
    setDrawnCoords(coords)
    setFitCoords(coords)
  }

  function clearAddress() {
    setGeocodeQuery('')
    setGeocodeResult(null)
  }

  function clearCity() {
    setCitySearch('')
    setCityBoundary(null)
    setCityError(null)
  }

  async function handleFetchCityBoundary(name?: string) {
    const query = (name ?? citySearch).trim()
    if (!query || cityLoading) return
    setCityLoading(true)
    setCityError(null)
    setCityBoundary(null)
    try {
      const result = await fetchCityBoundary(query, defaultCountry)
      if (!result) {
        setCityError(t('zonesPage.cityNotFound', { q: query, country: defaultCountry }))
        return
      }
      setCityBoundary(result)
      setFitCoords(result.coords)
    } catch {
      setCityError(t('zonesPage.cityError'))
    } finally {
      setCityLoading(false)
    }
  }

  function handleApplyCityBoundary() {
    if (!cityBoundary) return
    setDrawnCoords(cityBoundary.coords)
    setFitCoords(cityBoundary.coords)
    if (!newZoneForm.name.trim()) {
      setNewZoneForm((f) => ({ ...f, name: cityBoundary.name }))
    }
    setCityBoundary(null)
    setCitySearch('')
    setCityError(null)
  }

  function startDraw() {
    setDrawPointCount(0)
    setMode('drawing')
  }

  function handleDrawComplete(coords: [number, number][]) {
    setDrawnCoords(coords)
    setMode('creating')
  }

  function handleDrawCancel() {
    setMode('creating')
  }

  function startEdit(zone: Zone) {
    setEditingZone(zone)
    setEditCoords([...zone.coordinates])
    setEditForm({
      name:        zone.name,
      description: zone.description ?? '',
      type:        zone.type,
      color:       zone.color,
    })
    setZoneCompanyId(zone.companyId   ?? '')
    setZoneCampaignId(zone.campaignId ?? '')
    setFitCoords([...zone.coordinates])
    setMode('editing')
    selectZone(zone.id)
  }

  function exitEditMode() {
    setMode('idle')
    setEditingZone(null)
    setEditCoords([])
    setFitCoords(null)
  }

  async function handleSaveNew() {
    if (!newZoneForm.name.trim()) { toast.error(t('zonesPage.nameRequired')); return }
    if (!drawnCoords)             { toast.error(t('zonesPage.drawFirst')); return }
    setSaving(true)
    try {
      const wkt = coordsToWkt(drawnCoords)
      const { data: session } = await supabase.auth.getSession()
      const userId = session?.session?.user?.id
      const { data: row, error } = await supabase
        .from('zones')
        .insert({
          name:        newZoneForm.name.trim(),
          description: newZoneForm.description.trim() || null,
          color:       newZoneForm.color,
          type:        newZoneForm.type,
          polygon:     wkt,
          created_by:  userId,
          company_id:  zoneCompanyId  || null,
          campaign_id: zoneCampaignId || null,
        })
        .select('id, created_at')
        .single()
      if (error) throw new Error(error.message)
      addZone({
        id:          row.id,
        name:        newZoneForm.name.trim(),
        description: newZoneForm.description.trim() || undefined,
        color:       newZoneForm.color,
        type:        newZoneForm.type,
        coordinates: drawnCoords,
        isActive:    true,
        createdAt:   row.created_at,
      })
      toast.success(t('zonesPage.zoneCreated'))
      setMode('idle')
      setDrawnCoords(null)
    } catch (e: any) {
      toast.error(e.message ?? t('zonesPage.saveError'))
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveEdit() {
    if (!editForm.name.trim()) { toast.error(t('zonesPage.nameRequired')); return }
    if (!editingZone) return
    setSaving(true)
    try {
      const wkt = coordsToWkt(editCoords)
      const { error } = await supabase
        .from('zones')
        .update({
          name:        editForm.name.trim(),
          description: editForm.description.trim() || null,
          color:       editForm.color,
          type:        editForm.type,
          polygon:     wkt,
          company_id:  zoneCompanyId  || null,
          campaign_id: zoneCampaignId || null,
        })
        .eq('id', editingZone.id)
      if (error) throw new Error(error.message)
      updateZone({
        ...editingZone,
        name:        editForm.name.trim(),
        description: editForm.description.trim() || undefined,
        color:       editForm.color,
        companyId:   zoneCompanyId  || null,
        campaignId:  zoneCampaignId || null,
        type:        editForm.type,
        coordinates: editCoords,
      })
      toast.success(t('zonesPage.zoneUpdated'))
      exitEditMode()
    } catch (e: any) {
      toast.error(e.message ?? t('zonesPage.updateError'))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    const { error } = await supabase
      .from('zones')
      .delete()
      .eq('id', deleteTarget.id)
    if (error) {
      toast.error(t('zonesPage.deleteError'))
    } else {
      removeZone(deleteTarget.id)
      if (selectedZoneId === deleteTarget.id) selectZone(null)
      if (editingZone?.id === deleteTarget.id) exitEditMode()
      toast.success(t('zonesPage.zoneDeleted'))
    }
    setDeleting(false)
    setDeleteTarget(null)
  }

  async function handleClearAll() {
    setClearingAll(true)
    try {
      const count = await deleteAllZones()
      zones.forEach((z) => removeZone(z.id))
      selectZone(null)
      if (mode !== 'idle') { setMode('idle'); setDrawnCoords(null) }
      toast.success(`${count} ${t('zonesPage.zoneNoun')}${count !== 1 ? 's' : ''} ${t('zonesPage.removedFem')}${count !== 1 ? 's' : ''}`)
    } catch (err: any) {
      toast.error(err.message ?? t('zonesPage.clearError'))
    } finally {
      setClearingAll(false)
      setClearAllConfirm(false)
    }
  }

  const filteredZones = search.trim()
    ? zones.filter((z) =>
        z.name.toLowerCase().includes(search.toLowerCase()) ||
        (z.description ?? '').toLowerCase().includes(search.toLowerCase())
      )
    : zones

  const selectedZone = zones.find((z) => z.id === selectedZoneId) ?? null

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen bg-base overflow-hidden">

      {/* ══════════════════════════════════ SIDEBAR ══════════════════════════════════ */}
      <div className="w-80 flex-shrink-0 bg-surface border-r border-border-soft flex flex-col overflow-hidden">

        {/* Header */}
        <div className="px-4 py-3 border-b border-border-soft flex items-center gap-3 flex-shrink-0">
          {mode === 'idle' ? (
            <button
              onClick={() => navigate(-1)}
              className="text-text-muted hover:text-text-primary transition-colors flex-shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={mode === 'creating' ? () => { setMode('idle'); setDrawnCoords(null) }
                     : mode === 'drawing'  ? () => drawRef.current?.cancel()
                     : exitEditMode}
              className="text-text-muted hover:text-text-primary transition-colors flex-shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}

          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Layers className="w-4 h-4 text-primary flex-shrink-0" />
            <span className="font-bold text-text-primary text-sm truncate">
              {mode === 'creating' ? t('zonesPage.newZone')
               : mode === 'drawing'  ? t('zonesPage.drawing')
               : mode === 'editing'  ? t('zonesPage.editZoneHeader')
               : t('zonesPage.title')}
            </span>
          </div>

          {mode === 'idle' && (
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <LanguageSwitcher />
              {zones.length > 0 && (
                <button
                  onClick={() => setClearAllConfirm(true)}
                  title={t('zonesPage.clearAllTitle')}
                  className="p-1.5 rounded-xl bg-danger/10 hover:bg-danger/20 text-danger transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={startCreate}
                title={t('zonesPage.newZoneTitle')}
                className="p-1.5 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* ── IDLE: lista de zonas ── */}
        {mode === 'idle' && (
          <>
            {/* Buscador (solo si hay zonas suficientes) */}
            {zones.length > 3 && (
              <div className="px-3 py-2 border-b border-border-soft flex-shrink-0">
                <div className="flex items-center gap-2 bg-base rounded-xl px-3 py-1.5 border border-border-soft">
                  <Search className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t('zonesPage.searchPlaceholder')}
                    className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
                  />
                  {search && (
                    <button onClick={() => setSearch('')} className="text-text-muted hover:text-text-primary transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Leyenda */}
            <div className="px-4 py-2 border-b border-border-soft grid grid-cols-2 gap-1.5 flex-shrink-0">
              {(Object.keys(ZONE_TYPE_LABELS) as ZoneType[]).map((ztype) => (
                <div key={ztype} className="flex items-center gap-1.5 text-xs text-text-muted">
                  <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: ZONE_TYPE_COLORS[ztype] }} />
                  {t(ZONE_TYPE_LABEL_KEYS[ztype])}
                </div>
              ))}
            </div>

            {/* Lista */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {filteredZones.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-text-muted gap-3">
                  <Layers className="w-10 h-10 opacity-20" />
                  {zones.length === 0 ? (
                    <>
                      <div className="text-center">
                        <p className="text-sm font-medium text-text-secondary">{t('zonesPage.noZones')}</p>
                        <p className="text-xs mt-1">{t('zonesPage.noZonesHint')}</p>
                      </div>
                      <button
                        onClick={startCreate}
                        className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        {t('zonesPage.createFirst')}
                      </button>
                    </>
                  ) : (
                    <p className="text-sm">{t('zonesPage.noResults', { q: search })}</p>
                  )}
                </div>
              ) : (
                <AnimatePresence>
                  {filteredZones.map((zone) => (
                    <motion.div
                      key={zone.id}
                      layout
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.97 }}
                      onClick={() => selectZone(selectedZoneId === zone.id ? null : zone.id)}
                      className={cn(
                        'flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all group',
                        selectedZoneId === zone.id
                          ? 'border-primary/30 bg-primary/10'
                          : 'border-border-soft bg-base hover:border-border hover:bg-surface-raised'
                      )}
                    >
                      {/* Franja de color */}
                      <div
                        className="w-1 self-stretch rounded-full flex-shrink-0 mt-0.5"
                        style={{ background: zone.color }}
                      />

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <ZoneTypeIcon type={zone.type} color={zone.color} />
                          <span className="font-semibold text-text-primary text-sm truncate">{zone.name}</span>
                        </div>
                        <span className="text-xs text-text-muted">{t(ZONE_TYPE_LABEL_KEYS[zone.type])}</span>
                        {zone.description && (
                          <p className="text-xs text-text-muted mt-0.5 truncate">{zone.description}</p>
                        )}
                        <span className="text-xs text-text-muted/50 mt-0.5 block">
                          {t('zonesPage.vertices', { n: zone.coordinates.length })}
                        </span>
                      </div>

                      {/* Botones de acción siempre visibles */}
                      <div className="flex flex-col gap-1 flex-shrink-0">
                        <button
                          onClick={(e) => { e.stopPropagation(); startEdit(zone) }}
                          title={t('zonesPage.editZone')}
                          className="p-1.5 rounded-lg hover:bg-primary/10 text-text-muted hover:text-primary transition-colors"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteTarget(zone) }}
                          title={t('zonesPage.deleteZone')}
                          className="p-1.5 rounded-lg hover:bg-danger/10 text-text-muted hover:text-danger transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </div>

            {/* Stats footer */}
            <div className="px-4 py-3 border-t border-border-soft flex-shrink-0">
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(ZONE_TYPE_LABELS) as ZoneType[]).map((ztype) => {
                  const count = zones.filter((z) => z.type === ztype).length
                  return (
                    <div key={ztype} className="bg-base rounded-xl px-3 py-2 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: ZONE_TYPE_COLORS[ztype] }} />
                      <span className="text-text-muted text-xs truncate">{t(ZONE_TYPE_LABEL_KEYS[ztype])}</span>
                      <span className="ml-auto text-text-primary text-xs font-mono font-bold">{count}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )}

        {/* ── DRAWING: indicador compacto ── */}
        {mode === 'drawing' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-5 p-6 text-center">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{ background: newZoneForm.color + '20', border: `2px solid ${newZoneForm.color}50` }}
            >
              <Pencil className="w-7 h-7" style={{ color: newZoneForm.color }} />
            </motion.div>
            <div>
              <p className="font-bold text-text-primary text-sm">{t('zonesPage.drawingPolygon')}</p>
              <p className="text-xs text-text-muted mt-1 leading-relaxed">
                {t('zonesPage.drawingHint')}
              </p>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border" style={{ borderColor: newZoneForm.color + '50', background: newZoneForm.color + '15' }}>
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: newZoneForm.color }} />
              <span className="text-xs font-medium" style={{ color: newZoneForm.color }}>
                {newZoneForm.name || 'Nueva Zona'}
              </span>
            </div>
            <p className="text-xs text-text-muted/50">{t('zonesPage.escToCancel')}</p>
          </div>
        )}

        {/* ── CREATING: formulario + dibujar/guardar ── */}
        {mode === 'creating' && (
          <div className="flex-1 overflow-y-auto p-4">
            {/* ── Visibilidad / scope de la zona ── */}
            <div className="mb-4 space-y-2">
              <label className="block text-xs text-text-muted uppercase tracking-wider mb-1">{t('zonesPage.visibleFor')}</label>

              <select
                value={zoneCompanyId}
                onChange={e => setZoneCompanyId(e.target.value)}
                className="w-full bg-base border border-border-soft rounded-xl px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
              >
                {isSuperAdmin && <option value="">{t('zonesPage.allCompanies')}</option>}
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>

              {zoneCompanyId && (
                <select
                  value={zoneCampaignId}
                  onChange={e => setZoneCampaignId(e.target.value)}
                  className="w-full bg-base border border-border-soft rounded-xl px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
                >
                  <option value="">{t('zonesPage.wholeCompany')}</option>
                  {companyCampaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}

              <p className="text-xs text-text-muted/70 italic px-0.5">
                {!zoneCompanyId
                  ? t('zonesPage.selectCompanyWarn')
                  : !zoneCampaignId
                    ? t('zonesPage.visibleCompanyOnly', { name: companies.find(c => c.id === zoneCompanyId)?.name ?? '' })
                    : t('zonesPage.visibleCampaignOnly', { name: companyCampaigns.find(c => c.id === zoneCampaignId)?.name ?? '' })
                }
              </p>
            </div>

            <FormFields form={newZoneForm} onChange={setNewZoneForm} autoFocus />

            {/* ── Dirección / Ciudad (bloqueo mutuo) ── */}
            {(() => {
              const addressActive = !!geocodeQuery.trim() || !!geocodeResult
              const cityActive    = !!citySearch.trim()   || !!cityBoundary
              return (<>

            {/* SECCIÓN 1: Buscar por dirección */}
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs text-text-muted uppercase tracking-wider">
                  {t('zonesPage.searchByAddress')}
                </label>
                {addressActive && !cityActive && (
                  <button onClick={clearAddress} className="text-text-muted hover:text-danger transition-colors p-0.5 rounded" title={t('zonesPage.clear')}>
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {cityActive ? (
                <div className="flex items-center gap-2 bg-surface-raised border border-border-soft rounded-xl px-3 py-2.5">
                  <span className="text-xs text-text-muted flex-1 leading-relaxed">
                    {t('zonesPage.cityBlockingAddress')}
                  </span>
                  <button
                    onClick={clearCity}
                    className="text-xs text-primary font-semibold whitespace-nowrap hover:underline flex-shrink-0 ml-1"
                  >
                    {t('zonesPage.clearCity')}
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex gap-2">
                    <input
                      value={geocodeQuery}
                      onChange={(e) => setGeocodeQuery(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !geocodeLoading) handleGeocode() }}
                      placeholder={t('zonesPage.addressPlaceholder')}
                      className="flex-1 bg-base border border-border-soft rounded-xl px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
                    />
                    <button
                      onClick={handleGeocode}
                      disabled={geocodeLoading || !geocodeQuery.trim()}
                      className="px-3 py-2 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary transition-colors disabled:opacity-50 flex items-center justify-center"
                    >
                      {geocodeLoading
                        ? <span className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin block" />
                        : <Search className="w-4 h-4" />
                      }
                    </button>
                  </div>

                  <p className="text-[11px] text-text-muted flex items-start gap-1.5 bg-primary/5 border border-primary/15 rounded-lg px-2.5 py-1.5 leading-relaxed">
                    <span className="flex-shrink-0">🗺️</span>
                    <span>{t('zonesPage.addressHintPre')}<strong className="text-text-secondary">{t('zonesPage.addressHintStrong')}</strong>{t('zonesPage.addressHintPost')}</span>
                  </p>

                  {geocodeResult && (
                    <div className="bg-base border border-primary/20 rounded-xl p-3 space-y-3">
                      <div className="flex items-start gap-2">
                        <MapPin className="w-3.5 h-3.5 text-primary flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-text-secondary leading-relaxed line-clamp-2">{geocodeResult.displayName}</p>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs text-text-muted">{t('zonesPage.zoneRadius')}</span>
                          <span className="text-xs font-mono text-text-primary">{Math.max(geocodeRadius, 150)} m</span>
                        </div>
                        <input
                          type="range"
                          min={150} max={5000} step={50}
                          value={Math.max(geocodeRadius, 150)}
                          onChange={(e) => setGeocodeRadius(Math.max(Number(e.target.value), 150))}
                          className="w-full accent-primary"
                        />
                      </div>
                      <button
                        onClick={handleGenerateFromAddress}
                        className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-semibold bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
                      >
                        <MapPin className="w-3.5 h-3.5" />
                        {t('zonesPage.updateCircular')}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* SECCIÓN 2: Importar ciudad */}
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs text-text-muted uppercase tracking-wider">
                  {t('zonesPage.importCity')}
                </label>
                {cityActive && !addressActive && (
                  <button onClick={clearCity} className="text-text-muted hover:text-danger transition-colors p-0.5 rounded" title={t('zonesPage.clear')}>
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {addressActive ? (
                <div className="flex items-center gap-2 bg-surface-raised border border-border-soft rounded-xl px-3 py-2.5">
                  <span className="text-xs text-text-muted flex-1 leading-relaxed">
                    {t('zonesPage.addressBlockingCity')}
                  </span>
                  <button
                    onClick={clearAddress}
                    className="text-xs text-primary font-semibold whitespace-nowrap hover:underline flex-shrink-0 ml-1"
                  >
                    {t('zonesPage.clearAddress')}
                  </button>
                </div>
              ) : (
                <>
                  {knownCities.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {knownCities.map((city) => (
                        <button
                          key={city}
                          type="button"
                          onClick={() => { setCitySearch(city); handleFetchCityBoundary(city) }}
                          className="px-2.5 py-1 rounded-lg border border-border-soft bg-base text-xs text-text-secondary hover:border-primary/40 hover:text-primary hover:bg-primary/5 transition-all"
                        >
                          {city}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <input
                      value={citySearch}
                      onChange={(e) => setCitySearch(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !cityLoading) handleFetchCityBoundary() }}
                      placeholder={t('zonesPage.cityPlaceholder')}
                      className="flex-1 bg-base border border-border-soft rounded-xl px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
                    />
                    <button
                      onClick={() => handleFetchCityBoundary()}
                      disabled={cityLoading || !citySearch.trim()}
                      className="px-3 py-2 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary transition-colors disabled:opacity-50 flex items-center justify-center"
                    >
                      {cityLoading
                        ? <span className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin block" />
                        : <Building2 className="w-4 h-4" />
                      }
                    </button>
                  </div>

                  {cityError && (
                    <p className="text-xs text-danger px-1">{cityError}</p>
                  )}

                  {cityBoundary && (
                    <div className="bg-base border border-primary/20 rounded-xl p-3 space-y-2.5">
                      <div className="flex items-start gap-2">
                        <Building2 className="w-3.5 h-3.5 text-primary flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-text-primary">{cityBoundary.name}</p>
                          <p className="text-xs text-text-muted line-clamp-1 mt-0.5">{cityBoundary.displayName}</p>
                          <p className="text-xs text-text-muted mt-0.5">{t('zonesPage.vertices', { n: cityBoundary.coords.length })}</p>
                        </div>
                      </div>
                      <button
                        onClick={handleApplyCityBoundary}
                        className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-semibold bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
                      >
                        <CheckCircle className="w-3.5 h-3.5" />
                        {t('zonesPage.useBoundary')}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            </> ) })()}

            <div className="mt-5 space-y-3">
              {drawnCoords ? (
                <>
                  {/* Badge: polígono listo */}
                  <div className="flex items-center gap-2.5 bg-success/10 border border-success/30 rounded-xl px-3 py-2.5">
                    <CheckCircle className="w-4 h-4 text-success flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-success">{t('zonesPage.polygonReady')}</p>
                      <p className="text-xs text-text-muted">{t('zonesPage.vertices', { n: drawnCoords.length })}</p>
                    </div>
                    <button
                      onClick={() => { setDrawnCoords(null); startDraw() }}
                      title={t('zonesPage.redrawTitle')}
                      className="flex items-center gap-1 text-xs text-text-muted hover:text-warning transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      {t('zonesPage.redraw')}
                    </button>
                  </div>

                  <button
                    onClick={handleSaveNew}
                    disabled={saving || !newZoneForm.name.trim()}
                    className={cn(
                      'w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-colors',
                      saving || !newZoneForm.name.trim()
                        ? 'bg-surface-raised text-text-muted cursor-not-allowed opacity-60'
                        : 'bg-primary hover:bg-primary/90 text-white'
                    )}
                  >
                    {saving
                      ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      : <><Save className="w-4 h-4" />{t('zonesPage.saveZone')}</>
                    }
                  </button>
                </>
              ) : (
                <button
                  onClick={startDraw}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold bg-primary hover:bg-primary/90 text-white transition-colors"
                >
                  <Pencil className="w-4 h-4" />
                  {t('zonesPage.drawOnMap')}
                </button>
              )}

              <button
                onClick={() => { setMode('idle'); setDrawnCoords(null) }}
                className="w-full py-2 rounded-xl text-sm text-text-muted hover:text-text-secondary hover:bg-surface-raised transition-colors"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}

        {/* ── EDITING: formulario + controles de vértices ── */}
        {mode === 'editing' && editingZone && (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="mb-4 space-y-2">
              <label className="block text-xs text-text-muted uppercase tracking-wider mb-1">{t('zonesPage.visibleFor')}</label>

              <select
                value={zoneCompanyId}
                onChange={e => setZoneCompanyId(e.target.value)}
                className="w-full bg-base border border-border-soft rounded-xl px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
              >
                {isSuperAdmin && <option value="">{t('zonesPage.allCompanies')}</option>}
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>

              {zoneCompanyId && (
                <select
                  value={zoneCampaignId}
                  onChange={e => setZoneCampaignId(e.target.value)}
                  className="w-full bg-base border border-border-soft rounded-xl px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
                >
                  <option value="">{t('zonesPage.wholeCompany')}</option>
                  {companyCampaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}

              <p className="text-xs text-text-muted/70 italic px-0.5">
                {!zoneCompanyId
                  ? t('zonesPage.selectCompanyWarn')
                  : !zoneCampaignId
                    ? t('zonesPage.visibleCompanyOnly', { name: companies.find(c => c.id === zoneCompanyId)?.name ?? '' })
                    : t('zonesPage.visibleCampaignOnly', { name: companyCampaigns.find(c => c.id === zoneCampaignId)?.name ?? '' })
                }
              </p>
            </div>
            <FormFields form={editForm} onChange={setEditForm} autoFocus />

            {/* Panel de ayuda para vértices */}
            <div className="mt-4 bg-base border border-border-soft rounded-xl px-3 py-3 space-y-2">
              <p className="text-xs font-semibold text-text-secondary flex items-center gap-1.5">
                <Move className="w-3.5 h-3.5 text-primary" />
                {t('zonesPage.vertexEditing')}
              </p>
              <ul className="space-y-1 text-xs text-text-muted">
                <li>• <strong className="text-text-secondary">{t('zonesPage.vtxDragStrong')}</strong>{t('zonesPage.vtxDragRest')}</li>
                <li>• <strong className="text-text-secondary">{t('zonesPage.vtxClickStrong')}</strong>{t('zonesPage.vtxClickRest')}</li>
                <li>• <strong className="text-text-secondary">{t('zonesPage.vtxRightStrong')}</strong>{t('zonesPage.vtxRightRest')}</li>
              </ul>
              <div className="flex items-center gap-1.5 pt-1 border-t border-border-soft">
                <span className="text-xs text-text-muted">{t('zonesPage.currentVertices', { n: editCoords.length })}</span>
                <button
                  onClick={() => setEditCoords([...editingZone.coordinates])}
                  className="ml-auto flex items-center gap-1 text-xs text-text-muted hover:text-warning transition-colors"
                  title={t('zonesPage.restoreTitle')}
                >
                  <RotateCcw className="w-3 h-3" />
                  {t('zonesPage.restore')}
                </button>
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                onClick={exitEditMode}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-surface-raised hover:bg-border-soft text-text-secondary transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={saving || !editForm.name.trim()}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-colors',
                  saving || !editForm.name.trim()
                    ? 'bg-surface-raised text-text-muted cursor-not-allowed opacity-60'
                    : 'bg-primary hover:bg-primary/90 text-white'
                )}
              >
                {saving
                  ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  : <><Save className="w-4 h-4" />{t('common.save')}</>
                }
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════ MAPA ══════════════════════════════════ */}
      <div className="flex-1 relative">

        {/* Banner modo dibujo */}
        {mode === 'drawing' && (
          <div
            className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] text-white text-xs font-medium px-4 py-2 rounded-xl shadow-2xl flex items-center gap-2 pointer-events-none"
            style={{ background: newZoneForm.color + 'ee', backdropFilter: 'blur(6px)' }}
          >
            <Pencil className="w-3.5 h-3.5" />
            {drawPointCount === 0
              ? t('zonesPage.clickFirstPoint')
              : `${drawPointCount} ${t('zonesPage.pointNoun')}${drawPointCount !== 1 ? 's' : ''} · ${
                  drawPointCount < 3 ? t('zonesPage.moreToFinish', { k: 3 - drawPointCount }) : t('zonesPage.readyFinish')
                }`
            }
          </div>
        )}

        {/* Banner modo edición */}
        {mode === 'editing' && (
          <motion.div
            initial={{ y: -40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] bg-warning/90 backdrop-blur-sm text-white text-xs font-medium px-4 py-2 rounded-xl shadow-2xl flex items-center gap-2 pointer-events-none"
          >
            <Move className="w-3.5 h-3.5" />
            {t('zonesPage.editBanner')}
          </motion.div>
        )}

        <MapContainer
          center={defaultCenter}
          zoom={12}
          style={{ height: '100%', width: '100%' }}
          zoomControl={false}
          attributionControl={false}
          doubleClickZoom={false}
        >
          <MapBaseLayer />
          <AutoCenter />
          <MapFitEffect coords={fitCoords} />
          <ZonesDisplay
            zones={zones}
            selectedId={selectedZoneId}
            excludeId={editingZone?.id ?? null}
            onSelect={(id) => {
              if (mode === 'idle') selectZone(id)
            }}
          />
          {mode === 'drawing' && (
            <DrawController
              ref={drawRef}
              active
              previewColor={newZoneForm.color}
              onComplete={handleDrawComplete}
              onCancel={handleDrawCancel}
              onPointsChange={setDrawPointCount}
            />
          )}
          {mode === 'editing' && editCoords.length >= 3 && (
            <VertexEditor
              coords={editCoords}
              color={editForm.color}
              onChange={setEditCoords}
            />
          )}
          {mode === 'creating' && drawnCoords && (
            <CityBoundaryPreview coords={drawnCoords} color={newZoneForm.color} />
          )}
          {mode === 'creating' && cityBoundary && !drawnCoords && (
            <CityBoundaryPreview coords={cityBoundary.coords} color={newZoneForm.color} />
          )}
        </MapContainer>

        {/* Toolbar de dibujo */}
        {mode === 'drawing' && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[500] pointer-events-auto">
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="bg-surface/95 backdrop-blur-sm border border-border-soft rounded-2xl px-4 py-3 shadow-2xl flex items-center gap-3"
            >
              <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: newZoneForm.color }} />
              <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                <MousePointer className="w-3.5 h-3.5 text-primary" />
                <span>
                  {drawPointCount === 0
                    ? t('zonesPage.clickForFirst')
                    : `${drawPointCount} ${t('zonesPage.vertexNoun')}${drawPointCount !== 1 ? 's' : ''} · ${drawPointCount < 3 ? t('zonesPage.min3') : t('zonesPage.ready')}`
                  }
                </span>
              </div>
              <div className="w-px h-4 bg-border-soft" />
              <button
                onClick={() => drawRef.current?.undo()}
                disabled={drawPointCount === 0}
                title={t('zonesPage.undoTitle')}
                className="p-1.5 rounded-lg text-text-muted hover:text-text-primary disabled:opacity-30 transition-colors hover:bg-surface-raised"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => drawRef.current?.finish()}
                disabled={drawPointCount < 3}
                className={cn(
                  'flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl transition-colors',
                  drawPointCount >= 3
                    ? 'bg-primary hover:bg-primary/90 text-white'
                    : 'bg-surface-raised text-text-muted cursor-not-allowed'
                )}
              >
                <CheckCircle className="w-3.5 h-3.5" />
                {t('zonesPage.finish')}
              </button>
              <button
                onClick={() => drawRef.current?.cancel()}
                title={t('zonesPage.cancelDrawTitle')}
                className="p-1.5 rounded-lg text-text-muted hover:text-danger transition-colors hover:bg-danger/10"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          </div>
        )}

        {/* Panel de detalle de zona seleccionada (solo modo idle) */}
        <AnimatePresence>
          {mode === 'idle' && selectedZoneId && selectedZone && (
            <div key="zone-detail" className="absolute bottom-6 left-4 z-[500]">
              <ZoneDetailPanel
                zone={selectedZone}
                onClose={() => selectZone(null)}
                actions={
                  <>
                    <button
                      onClick={() => startEdit(selectedZone)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      {t('zonesPage.editZone')}
                    </button>
                    <button
                      onClick={() => setDeleteTarget(selectedZone)}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-danger/10 text-danger hover:bg-danger/20 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                }
              />
            </div>
          )}
        </AnimatePresence>

        {/* Controles de zoom */}
        <div className="absolute top-4 right-4 z-[500]">
          <div className="bg-surface/90 backdrop-blur-sm border border-border-soft rounded-xl overflow-hidden shadow-xl">
            <button
              onClick={() => {
                const container = document.querySelector<HTMLElement & { _leaflet_map?: L.Map }>('.leaflet-container')
                if (container && (container as any)._leaflet_map) (container as any)._leaflet_map.zoomIn()
              }}
              className="flex items-center justify-center w-9 h-9 hover:bg-surface-raised transition-colors text-text-muted hover:text-text-primary border-b border-border-soft text-sm font-bold"
            >+</button>
            <button
              onClick={() => {
                const container = document.querySelector<HTMLElement>('.leaflet-container')
                if (container && (container as any)._leaflet_map) (container as any)._leaflet_map.zoomOut()
              }}
              className="flex items-center justify-center w-9 h-9 hover:bg-surface-raised transition-colors text-text-muted hover:text-text-primary text-sm font-bold"
            >−</button>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════ CONFIRMAR ELIMINACIÓN ══════════════════════════════════ */}
      <AnimatePresence>
        {deleteTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={(e) => { if (e.target === e.currentTarget) setDeleteTarget(null) }}
          >
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.65)' }} />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: '360px', margin: '0 16px' }}
              className="bg-surface border border-border-soft rounded-2xl shadow-2xl p-6"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-danger/10 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-5 h-5 text-danger" />
                </div>
                <div>
                  <p className="font-bold text-text-primary text-sm">{t('zonesPage.deleteZone')}</p>
                  <p className="text-text-muted text-xs mt-0.5">{t('zonesPage.cannotUndo')}</p>
                </div>
              </div>
              <p className="text-text-secondary text-sm mb-5">
                {t('zonesPage.confirmDeletePre')}<strong className="text-text-primary">"{deleteTarget.name}"</strong>{t('zonesPage.confirmDeletePost')}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteTarget(null)}
                  className="flex-1 bg-surface-raised hover:bg-border-soft text-text-secondary text-sm font-medium rounded-xl py-2.5 transition-colors"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex-1 bg-danger hover:bg-danger/90 text-white text-sm font-semibold rounded-xl py-2.5 transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {deleting
                    ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    : <><Trash2 className="w-4 h-4" />{t('common.delete')}</>
                  }
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ══ CONFIRMAR BORRAR TODAS ══ */}
      <AnimatePresence>
        {clearAllConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={(e) => { if (!clearingAll && e.target === e.currentTarget) setClearAllConfirm(false) }}
          >
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }} />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: '380px', margin: '0 16px' }}
              className="bg-surface border border-border-soft rounded-2xl shadow-2xl p-6"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-danger/10 flex items-center justify-center flex-shrink-0">
                  <Trash2 className="w-5 h-5 text-danger" />
                </div>
                <div>
                  <p className="font-bold text-text-primary text-sm">{t('zonesPage.clearAllTitle')}</p>
                  <p className="text-text-muted text-xs mt-0.5">{zones.length} {t('zonesPage.zoneNoun')}{zones.length !== 1 ? 's' : ''} {t('zonesPage.inDatabase')}</p>
                </div>
              </div>
              <p className="text-text-secondary text-sm mb-5 leading-relaxed">
                {t('zonesPage.clearAllConfirmPre')}<strong className="text-danger">{zones.length} {t('zonesPage.zoneNoun')}{zones.length !== 1 ? 's' : ''}</strong>{t('zonesPage.clearAllConfirmPost')}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setClearAllConfirm(false)}
                  disabled={clearingAll}
                  className="flex-1 bg-surface-raised hover:bg-border-soft text-text-secondary text-sm font-medium rounded-xl py-2.5 transition-colors disabled:opacity-50"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleClearAll}
                  disabled={clearingAll}
                  className="flex-1 bg-danger hover:bg-danger/90 text-white text-sm font-semibold rounded-xl py-2.5 transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {clearingAll
                    ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    : <><Trash2 className="w-4 h-4" />{t('zonesPage.clearAllBtn')}</>
                  }
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
