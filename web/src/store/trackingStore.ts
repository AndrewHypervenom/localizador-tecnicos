import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

export type TechnicianStatus = 'moving' | 'idle' | 'stopped' | 'offline' | 'accident'

// Thresholds for determining technician status based on time since last GPS event.
// The mobile app sends every 2s, so these catch app stops / connection loss quickly.
export const STATUS_THRESHOLDS = {
  MOVING_FRESH_S: 30,   // speed > 1 km/h only counts as "moving" if data is < 30s old
  IDLE_S:         60,   // < 1 min since last event → idle (active but not moving)
  STOPPED_S:      600,  // < 10 min → stopped (sin rastreo)
  // > 10 min → offline (desconectado)
}

export interface TechnicianState {
  id: string
  name: string
  deviceId: string
  phone?: string
  supervisorId?: string
  // Estado en tiempo real
  lastSeen?: string
  lat?: number
  lng?: number
  lastSpeed?: number   // m/s
  altitude?: number
  bearing?: number
  battery?: number
  status: TechnicianStatus
  // Ruta del día (últimos N puntos)
  trail: [number, number][]  // [lat, lng][]
  // Datos de casa
  home_lat?:     number
  home_lng?:     number
  home_address?: string
}

export interface MotionAlert {
  id: string
  technicianId: string
  technicianName: string
  type: 'accident' | 'hard_brake' | 'rapid_accel' | 'harsh_turn'
  severity: number
  ts: string
  lat?: number
  lng?: number
  acknowledged: boolean
}

export interface ZoneAlert {
  id: string
  technicianId: string
  technicianName: string
  zoneId: string
  zoneName: string
  zoneColor: string
  eventType: 'enter' | 'exit'
  ts: string
  acknowledged: boolean
}

interface TrackingStore {
  technicians: Record<string, TechnicianState>
  alerts: MotionAlert[]
  zoneAlerts: ZoneAlert[]
  selectedTechnicianId: string | null
  showHeatmap: boolean
  realtimeStatus: 'connecting' | 'connected' | 'error' | 'disconnected'
  lastRealtimeEvent: string | null   // ISO timestamp del último evento recibido
  // Actions
  setTechnicians: (techs: TechnicianState[]) => void
  updateTechnicianPosition: (payload: LocationPayload) => void
  updateTechnicianMeta: (id: string, patch: { name?: string; phone?: string; home_lat?: number | null; home_lng?: number | null; home_address?: string | null }) => void
  addAlert: (alert: MotionAlert) => void
  acknowledgeAlert: (alertId: string) => void
  acknowledgeAllAlerts: () => void
  addZoneAlert: (alert: ZoneAlert) => void
  acknowledgeZoneAlert: (alertId: string) => void
  selectTechnician: (id: string | null) => void
  toggleHeatmap: () => void
  setRealtimeStatus: (status: TrackingStore['realtimeStatus']) => void
  markRealtimeEvent: () => void
  refreshStatuses: () => void
}

interface LocationPayload {
  technician_id: string
  ts: string
  lat: number
  lng: number
  speed?: number
  altitude?: number
  bearing?: number
  battery_level?: number
}

const MAX_TRAIL_POINTS = 200

function computeStatus(lastSeen: string | undefined, lastSpeed: number | undefined, now: number): TechnicianStatus {
  if (!lastSeen) return 'offline'
  const secsSinceLast = (now - new Date(lastSeen).getTime()) / 1000
  const speedKmh = (lastSpeed ?? 0) * 3.6
  if (speedKmh > 1 && secsSinceLast < STATUS_THRESHOLDS.MOVING_FRESH_S) return 'moving'
  if (secsSinceLast < STATUS_THRESHOLDS.IDLE_S)                          return 'idle'
  if (secsSinceLast < STATUS_THRESHOLDS.STOPPED_S)                       return 'stopped'
  return 'offline'
}

export const useTrackingStore = create<TrackingStore>()(
  immer((set) => ({
    technicians: {},
    alerts: [],
    zoneAlerts: [],
    selectedTechnicianId: null,
    showHeatmap: false,
    realtimeStatus: 'connecting',
    lastRealtimeEvent: null,

    setTechnicians: (techs) =>
      set((state) => {
        const now = Date.now()
        techs.forEach((t) => {
          const status = t.status === 'accident' ? 'accident' : computeStatus(t.lastSeen, t.lastSpeed, now)
          state.technicians[t.id] = {
            ...t,
            status,
            trail:        state.technicians[t.id]?.trail ?? [],
            home_lat:     t.home_lat,
            home_lng:     t.home_lng,
            home_address: t.home_address,
          }
        })
      }),

    updateTechnicianMeta: (id, patch) =>
      set((state) => {
        const t = state.technicians[id]
        if (!t) return
        if (patch.name         !== undefined) t.name         = patch.name
        if (patch.phone        !== undefined) t.phone        = patch.phone ?? undefined
        if (patch.home_lat     !== undefined) t.home_lat     = patch.home_lat ?? undefined
        if (patch.home_lng     !== undefined) t.home_lng     = patch.home_lng ?? undefined
        if (patch.home_address !== undefined) t.home_address = patch.home_address ?? undefined
      }),

    updateTechnicianPosition: (payload) =>
      set((state) => {
        const tech = state.technicians[payload.technician_id]
        if (!tech) return

        let status = computeStatus(payload.ts, payload.speed, Date.now())

        // Mantener estado de accidente si hay alerta reciente no reconocida
        const recentAccident = state.alerts.find(
          (a) => a.technicianId === payload.technician_id
            && a.type === 'accident'
            && !a.acknowledged
            && Date.now() - new Date(a.ts).getTime() < 60_000
        )
        if (recentAccident) status = 'accident'

        // Limpiar trail si hubo una pausa larga (nueva sesión de rastreo)
        const TRAIL_RESET_GAP_S = 120
        if (tech.lastSeen) {
          const gapSecs = (new Date(payload.ts).getTime() - new Date(tech.lastSeen).getTime()) / 1000
          if (gapSecs > TRAIL_RESET_GAP_S) tech.trail = []
        }

        tech.lastSeen   = payload.ts
        tech.lat        = payload.lat
        tech.lng        = payload.lng
        tech.lastSpeed  = payload.speed
        tech.altitude   = payload.altitude
        tech.bearing    = payload.bearing
        tech.battery    = payload.battery_level
        tech.status     = status

        // Agregar al trail
        if (payload.lat && payload.lng) {
          tech.trail.push([payload.lat, payload.lng])
          if (tech.trail.length > MAX_TRAIL_POINTS) {
            tech.trail.splice(0, tech.trail.length - MAX_TRAIL_POINTS)
          }
        }
      }),

    addAlert: (alert) =>
      set((state) => {
        // Evitar duplicados
        if (!state.alerts.find((a) => a.id === alert.id)) {
          state.alerts.unshift(alert)
          if (state.alerts.length > 100) state.alerts.pop()
        }
      }),

    acknowledgeAlert: (alertId) =>
      set((state) => {
        const alert = state.alerts.find((a) => a.id === alertId)
        if (alert) alert.acknowledged = true
      }),

    acknowledgeAllAlerts: () =>
      set((state) => {
        state.alerts.forEach((a) => { a.acknowledged = true })
        state.zoneAlerts.forEach((a) => { a.acknowledged = true })
      }),

    addZoneAlert: (alert) =>
      set((state) => {
        if (!state.zoneAlerts.find((a) => a.id === alert.id)) {
          state.zoneAlerts.unshift(alert)
          if (state.zoneAlerts.length > 100) state.zoneAlerts.pop()
        }
      }),

    acknowledgeZoneAlert: (alertId) =>
      set((state) => {
        const alert = state.zoneAlerts.find((a) => a.id === alertId)
        if (alert) alert.acknowledged = true
      }),

    selectTechnician: (id) =>
      set((state) => {
        state.selectedTechnicianId = id
      }),

    toggleHeatmap: () =>
      set((state) => {
        state.showHeatmap = !state.showHeatmap
      }),

    setRealtimeStatus: (status) =>
      set((state) => { state.realtimeStatus = status }),

    markRealtimeEvent: () =>
      set((state) => { state.lastRealtimeEvent = new Date().toISOString() }),

    refreshStatuses: () =>
      set((state) => {
        const now = Date.now()
        Object.values(state.technicians).forEach((tech) => {
          if (tech.status === 'accident') return
          tech.status = computeStatus(tech.lastSeen, tech.lastSpeed, now)
        })
      }),
  }))
)
