export type FleetLocationType = 'warehouse' | 'office' | 'depot' | 'checkpoint' | 'other'
export type AssignmentStatus  = 'pending' | 'in_progress' | 'completed' | 'cancelled'

export interface FleetLocation {
  id:         string
  company_id: string | null
  name:       string
  address:    string | null
  type:       FleetLocationType
  lat:        number
  lng:        number
  color:      string
  notes:      string | null
  is_active:  boolean
  created_at: string
}

export interface TechnicianAssignment {
  id:                         string
  technician_id:              string
  title:                      string
  address:                    string | null
  lat:                        number | null
  lng:                        number | null
  scheduled_at:               string
  estimated_duration_minutes: number
  status:                     AssignmentStatus
  notes:                      string | null
  fleet_location_id:          string | null
  created_at:                 string
}

export const FLEET_LOCATION_TYPES: Record<FleetLocationType, { label: string; emoji: string; defaultColor: string }> = {
  warehouse:  { label: 'Bodega',          emoji: '🏭', defaultColor: '#3B82F6' },
  office:     { label: 'Oficina',         emoji: '🏢', defaultColor: '#8B5CF6' },
  depot:      { label: 'Depósito',        emoji: '📦', defaultColor: '#F97316' },
  checkpoint: { label: 'Punto control',   emoji: '🚩', defaultColor: '#14B8A6' },
  other:      { label: 'Otro',            emoji: '📌', defaultColor: '#6B7280' },
}

export const ASSIGNMENT_STATUS_CFG: Record<AssignmentStatus, { label: string; color: string }> = {
  pending:     { label: 'Pendiente',   color: '#F59E0B' },
  in_progress: { label: 'En curso',    color: '#3B82F6' },
  completed:   { label: 'Completado',  color: '#10B981' },
  cancelled:   { label: 'Cancelado',   color: '#64748B' },
}

export const LOCATION_COLORS = [
  '#3B82F6', '#8B5CF6', '#F97316', '#14B8A6',
  '#EF4444', '#10B981', '#F59E0B', '#EC4899',
]
