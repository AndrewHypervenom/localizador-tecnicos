import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useFleetStore } from '@/store/fleetStore'

export function useFleetLocations() {
  const { setLocations } = useFleetStore()

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('fleet_locations')
        .select('*')
        .eq('is_active', true)
        .order('name')
      if (data) setLocations(data)
    }

    load()

    const channel = supabase
      .channel('fleet_locations_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fleet_locations' }, load)
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [setLocations])
}
