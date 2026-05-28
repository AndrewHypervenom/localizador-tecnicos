export type AssignmentStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'

export interface TechnicianAssignment {
  id:                          string
  technician_id:               string
  title:                       string
  address?:                    string | null
  lat?:                        number | null
  lng?:                        number | null
  scheduled_at:                string
  estimated_duration_minutes:  number
  status:                      AssignmentStatus
  notes?:                      string | null
  created_at?:                 string
}

export const ASSIGNMENT_STATUS_CFG: Record<AssignmentStatus, { color: string; label: string }> = {
  pending:     { color: '#F59E0B', label: 'Pendiente'    },
  in_progress: { color: '#3B82F6', label: 'En progreso'  },
  completed:   { color: '#10B981', label: 'Completado'   },
  cancelled:   { color: '#EF4444', label: 'Cancelado'    },
}
