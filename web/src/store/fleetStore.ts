import { create } from 'zustand'
import { FleetLocation } from '@/types/fleet'

interface FleetState {
  locations:          FleetLocation[]
  showLocations:      boolean
  setLocations:       (locs: FleetLocation[]) => void
  toggleShowLocations: () => void
}

export const useFleetStore = create<FleetState>((set) => ({
  locations:     [],
  showLocations: true,
  setLocations:  (locations) => set({ locations }),
  toggleShowLocations: () => set((s) => ({ showLocations: !s.showLocations })),
}))
