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

export const ASSIGNMENT_STATUS_CFG: Record<AssignmentStatus, { color: string; labelKey: string }> = {
  pending:     { color: '#F59E0B', labelKey: 'assign.status.pending'     },
  in_progress: { color: '#3B82F6', labelKey: 'assign.status.in_progress' },
  completed:   { color: '#10B981', labelKey: 'assign.status.completed'   },
  cancelled:   { color: '#EF4444', labelKey: 'assign.status.cancelled'   },
}
