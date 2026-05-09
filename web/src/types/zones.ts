export type ZoneType = 'service_area' | 'restricted' | 'home_base' | 'checkpoint'

export interface Zone {
  id: string
  name: string
  description?: string
  color: string
  type: ZoneType
  coordinates: [number, number][]  // [lat, lng][] — orden Leaflet
  isActive: boolean
  createdAt: string
}

export const ZONE_TYPE_LABELS: Record<ZoneType, string> = {
  service_area: 'Área de servicio',
  restricted:   'Zona restringida',
  home_base:    'Base / Depósito',
  checkpoint:   'Punto de control',
}

export const ZONE_TYPE_COLORS: Record<ZoneType, string> = {
  service_area: '#00D632',
  restricted:   '#EF4444',
  home_base:    '#10B981',
  checkpoint:   '#F59E0B',
}

export const ZONE_PALETTE = [
  '#00D632', // verde primario
  '#10B981', // esmeralda
  '#F59E0B', // ámbar
  '#EF4444', // rojo
  '#7B2FF7', // violeta
  '#06B6D4', // cian
  '#F97316', // naranja
  '#EC4899', // rosa
]
