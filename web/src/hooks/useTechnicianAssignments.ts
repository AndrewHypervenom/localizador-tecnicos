import { useEffect, useState, useCallback } from 'react'
import { addDays, startOfDay } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { TechnicianAssignment } from '@/types/fleet'

export function useTechnicianAssignments(technicianId: string | null, daysAhead = 7) {
  const [assignments, setAssignments] = useState<TechnicianAssignment[]>([])
  const [loading, setLoading]         = useState(false)

  const reload = useCallback(async () => {
    if (!technicianId) return
    const from = startOfDay(new Date()).toISOString()
    const to   = addDays(new Date(), daysAhead).toISOString()
    const { data } = await supabase
      .from('technician_assignments')
      .select('*')
      .eq('technician_id', technicianId)
      .gte('scheduled_at', from)
      .lte('scheduled_at', to)
      .order('scheduled_at')
    setAssignments((data as TechnicianAssignment[]) ?? [])
  }, [technicianId, daysAhead])

  useEffect(() => {
    if (!technicianId) { setAssignments([]); return }

    // Sufijo aleatorio: único incluso si HMR resetea el módulo o StrictMode remonta
    const channelName = `assignments_${technicianId}_${Math.random().toString(36).slice(2)}`

    setLoading(true)
    reload().finally(() => setLoading(false))

    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', {
        event:  '*',
        schema: 'public',
        table:  'technician_assignments',
        filter: `technician_id=eq.${technicianId}`,
      }, reload)
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [technicianId, reload])

  return { assignments, loading, reload }
}
