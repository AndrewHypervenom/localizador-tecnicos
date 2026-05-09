import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { Zone } from '@/types/zones'

interface ZonesStore {
  zones: Zone[]
  showZones: boolean
  selectedZoneId: string | null

  setZones: (zones: Zone[]) => void
  addZone: (zone: Zone) => void
  updateZone: (zone: Zone) => void
  removeZone: (id: string) => void
  selectZone: (id: string | null) => void
  toggleShowZones: () => void
}

export const useZonesStore = create<ZonesStore>()(
  immer((set) => ({
    zones: [],
    showZones: true,
    selectedZoneId: null,

    setZones: (zones) => set((s) => { s.zones = zones }),

    addZone: (zone) => set((s) => {
      const idx = s.zones.findIndex((z) => z.id === zone.id)
      if (idx !== -1) s.zones[idx] = zone
      else s.zones.push(zone)
    }),

    updateZone: (zone) => set((s) => {
      const idx = s.zones.findIndex((z) => z.id === zone.id)
      if (idx !== -1) s.zones[idx] = zone
    }),

    removeZone: (id) => set((s) => {
      s.zones = s.zones.filter((z) => z.id !== id)
    }),

    selectZone: (id) => set((s) => { s.selectedZoneId = id }),

    toggleShowZones: () => set((s) => { s.showZones = !s.showZones }),
  }))
)
