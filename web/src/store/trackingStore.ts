import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

// 'no_signal' = la app sigue LATIENDO (viva) pero no llegan puntos GPS (túnel,
// edificio, GPS apagado, sin red): NO es lo mismo que 'offline' (app muerta).
export type TechnicianStatus = 'moving' | 'idle' | 'stopped' | 'no_signal' | 'offline' | 'accident'

// Thresholds for determining technician status based on time since last GPS event.
// La app móvil captura cada 5 s en movimiento y cada ~30 s detenida, y sube los
// puntos en lotes cada 30 s: el punto más reciente puede llegar con hasta ~35 s
// (en movimiento) o ~65 s (detenida) de antigüedad SIN que nada esté mal. Los
// umbrales deben cubrir ese desfase para no parpadear entre estados.
// OJO: estos umbrales tienen que ir SIEMPRE alineados con los de la vista
// `technician_current_status` en la base. El front no consume el `status` que
// calcula la vista: lo recalcula aquí (ver `computeStatus`), así que si los dos
// juegos de números se separan, el sitio contradice a la base y gana el front.
// Pasó el 2026-08-24: se corrigió la vista y en pantalla no cambió nada.
export const STATUS_THRESHOLDS = {
  MOVING_FRESH_S:    90,    // = '00:01:30' de la vista. Cubre el lote de 30 s + red.
  IDLE_S:            300,   // = '00:05:00' de la vista. Por debajo estaba en 150 s y
                            // un técnico entre 2.5 y 5 min salía ÁMBAR en el sitio y
                            // verde en la base: la misma fila con dos colores.
  // 8 h = "envió algo hoy" → ÁMBAR, no rojo. Subido desde 15 min el 2026-08-24:
  // la flota está en la APK 1.2.8, cuyo servicio de subida lo duerme el SO
  // durante horas mientras el técnico trabaja con normalidad. Con 15 min, un
  // técnico normal caía a 'offline' (rojo, "hay que llamarlo") y los líderes
  // dejaron de creerse el color. PARCHE: estrechar cuando la flota esté en Kotlin.
  STOPPED_S:         28800,
  // Sin punto GPS dentro de STOPPED_S: si la app sigue latiendo dentro de este
  // lapso → 'no_signal' (app viva sin señal); si no → 'offline' (muerta).
  // 7200 s = 2 h: el latido de la 1.2.8 se duerme junto al resto del proceso.
  HEARTBEAT_FRESH_S: 7200,
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
  // Latido (heartbeat): prueba de "app viva" independiente del GPS. Distingue
  // "app activa sin señal" de "desconectado de verdad".
  lastHeartbeat?: string
  hbGpsOn?: boolean    // ¿el GPS estaba encendido en el último latido?
  hbNetOn?: boolean    // ¿había datos/Wi-Fi?
  hbPerm?: 'full' | 'partial' | 'none'  // nivel de permiso de ubicación
  hbBattery?: number
  hbCharging?: boolean
  // Ruta del día (últimos N puntos)
  trail: [number, number][]  // [lat, lng][]
  // Datos de casa
  home_lat?:     number
  home_lng?:     number
  home_address?: string
  home_radius?:  number   // metros — radio del círculo alrededor de la casa
}

export type MotionAlertType =
  | 'accident' | 'hard_brake' | 'rapid_accel' | 'harsh_turn' | 'sos'
  | 'offline' | 'battery_low' | 'home_enter' | 'home_exit'
  // Bitácora de dispositivo (evidencia de sabotaje al rastreo)
  | 'gps_off' | 'gps_on' | 'mock_on' | 'mock_off'
  | 'tracking_start' | 'tracking_stop'
  | 'net_off' | 'net_on'
  | 'battery_restricted' | 'battery_unrestricted'
  | 'tracking_killed'
  | 'perm_revoked' | 'perm_granted'
  | 'clock_skew'

export interface MotionAlert {
  id: string
  technicianId: string
  technicianName: string
  type: MotionAlertType
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
  replaceTechnicians: (techs: TechnicianState[]) => void
  updateTechnicianPosition: (payload: LocationPayload) => void
  updateTechnicianHeartbeat: (payload: HeartbeatPayload) => void
  updateTechnicianMeta: (id: string, patch: { name?: string; phone?: string; home_lat?: number | null; home_lng?: number | null; home_address?: string | null; home_radius?: number | null }) => void
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
  /** Limpia todos los datos (al cerrar sesión / cambiar de líder). */
  reset: () => void
}

interface LocationPayload {
  technician_id: string
  /** Reloj del TELÉFONO. No usar para decidir estado: viene desajustado. */
  ts: string
  /** Reloj del SERVIDOR al insertar. Es el bueno. Opcional porque las filas
   *  anteriores a la columna no lo traen. */
  received_at?: string
  lat: number
  lng: number
  speed?: number
  altitude?: number
  bearing?: number
  battery_level?: number
}

interface HeartbeatPayload {
  technician_id: string
  last_heartbeat: string
  gps_on?: boolean | null
  net_on?: boolean | null
  perm?: 'full' | 'partial' | 'none' | null
  battery?: number | null
  charging?: boolean | null
}

const MAX_TRAIL_POINTS = 200

// Deriva GPS: detenido, los fixes se dispersan 10-50 m. Un punto a velocidad ~0
// y a menos de este radio del último punto del trail es deriva, no movimiento.
const DRIFT_COLLAPSE_M    = 25
const DRIFT_MAX_SPEED_KMH = 1

function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLng = ((bLng - aLng) * Math.PI) / 180
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

function computeStatus(
  lastSeen: string | undefined,
  lastSpeed: number | undefined,
  now: number,
  lastHeartbeat?: string,
): TechnicianStatus {
  const locSecs = lastSeen ? (now - new Date(lastSeen).getTime()) / 1000 : Infinity
  const speedKmh = (lastSpeed ?? 0) * 3.6
  if (speedKmh > 1 && locSecs < STATUS_THRESHOLDS.MOVING_FRESH_S) return 'moving'
  if (locSecs < STATUS_THRESHOLDS.IDLE_S)                         return 'idle'
  // Sin punto GPS fresco: si la app sigue LATIENDO está viva (bajo techo, túnel,
  // GPS sin fix) → mostrar "App activa — sin señal" DE INMEDIATO. Antes este
  // chequeo iba después de 'stopped' y durante 2.5-15 min el técnico se veía
  // "Inactivo"/"Detenido" gris con la app perfectamente sana (queja de líderes:
  // parecía desconectado sin estarlo).
  const hbSecs = lastHeartbeat ? (now - new Date(lastHeartbeat).getTime()) / 1000 : Infinity
  if (hbSecs < STATUS_THRESHOLDS.HEARTBEAT_FRESH_S) return 'no_signal'
  // Ni puntos ni latido reciente: visto hace poco → 'stopped'; si no → 'offline'.
  if (locSecs < STATUS_THRESHOLDS.STOPPED_S) return 'stopped'
  return 'offline'
}

// El motivo legible de 'no_signal' vivía aquí con los textos en español fijos
// (se saltaba el i18n) y solo lo usaba un panel. Ahora es parte del descriptor
// único de estado: ver `describeStatus` en @/lib/technicianStatus.

export const useTrackingStore = create<TrackingStore>()(
  immer((set) => ({
    technicians: {},
    alerts: [],
    zoneAlerts: [],
    selectedTechnicianId: null,
    showHeatmap: false,
    realtimeStatus: 'connecting',
    lastRealtimeEvent: null,

    reset: () =>
      set((state) => {
        state.technicians = {}
        state.alerts = []
        state.zoneAlerts = []
        state.selectedTechnicianId = null
        state.lastRealtimeEvent = null
      }),

    setTechnicians: (techs) =>
      set((state) => {
        const now = Date.now()
        techs.forEach((t) => {
          const status = t.status === 'accident' ? 'accident' : computeStatus(t.lastSeen, t.lastSpeed, now, t.lastHeartbeat)
          state.technicians[t.id] = {
            ...t,
            status,
            trail:        state.technicians[t.id]?.trail ?? [],
            home_lat:     t.home_lat,
            home_lng:     t.home_lng,
            home_address: t.home_address,
            home_radius:  t.home_radius,
          }
        })
      }),

    replaceTechnicians: (techs) =>
      set((state) => {
        const now = Date.now()
        state.technicians = {}
        techs.forEach((t) => {
          const status = t.status === 'accident' ? 'accident' : computeStatus(t.lastSeen, t.lastSpeed, now, t.lastHeartbeat)
          state.technicians[t.id] = {
            ...t,
            status,
            trail:        [],
            home_lat:     t.home_lat,
            home_lng:     t.home_lng,
            home_address: t.home_address,
            home_radius:  t.home_radius,
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
        if (patch.home_radius  !== undefined) t.home_radius  = patch.home_radius ?? undefined
      }),

    updateTechnicianPosition: (payload) =>
      set((state) => {
        const tech = state.technicians[payload.technician_id]
        if (!tech) return

        let status = computeStatus(payload.ts, payload.speed, Date.now(), tech.lastHeartbeat)

        // Mantener estado de accidente si hay alerta reciente no reconocida
        const recentAccident = state.alerts.find(
          (a) => a.technicianId === payload.technician_id
            && a.type === 'accident'
            && !a.acknowledged
            && Date.now() - new Date(a.ts).getTime() < 60_000
        )
        if (recentAccident) status = 'accident'

        // Igual que en la carga inicial: manda el reloj del SERVIDOR. Si no
        // viniera `received_at` en el payload se cae a `ts`, pero entonces el
        // hueco se mide contra un reloj distinto, así que se comparan las dos
        // marcas homólogas y no una de cada tipo.
        const contact = payload.received_at ?? payload.ts

        // Limpiar trail si hubo una pausa larga (nueva sesión de rastreo)
        const TRAIL_RESET_GAP_S = 120
        if (tech.lastSeen) {
          const gapSecs = (new Date(contact).getTime() - new Date(tech.lastSeen).getTime()) / 1000
          if (gapSecs > TRAIL_RESET_GAP_S) tech.trail = []
        }

        tech.lastSeen   = contact
        tech.lat        = payload.lat
        tech.lng        = payload.lng
        tech.lastSpeed  = payload.speed
        tech.altitude   = payload.altitude
        tech.bearing    = payload.bearing
        tech.battery    = payload.battery_level
        tech.status     = status

        // Agregar al trail — colapsando la "deriva" GPS: con el técnico detenido
        // los fixes se dispersan 10-50 m y dibujarían líneas aleatorias de
        // movimiento que nunca ocurrió. Si el punto reporta velocidad ~0 y cae a
        // menos de DRIFT_COLLAPSE_M del último punto del trail, no se agrega
        // (el marcador sí se actualiza arriba; solo se omite la línea).
        if (payload.lat && payload.lng) {
          const last = tech.trail[tech.trail.length - 1]
          const isDrift = last !== undefined
            && (payload.speed ?? 0) * 3.6 < DRIFT_MAX_SPEED_KMH
            && haversineM(last[0], last[1], payload.lat, payload.lng) < DRIFT_COLLAPSE_M
          if (!isDrift) {
            tech.trail.push([payload.lat, payload.lng])
            if (tech.trail.length > MAX_TRAIL_POINTS) {
              tech.trail.splice(0, tech.trail.length - MAX_TRAIL_POINTS)
            }
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

    updateTechnicianHeartbeat: (hb) =>
      set((state) => {
        const tech = state.technicians[hb.technician_id]
        if (!tech) return
        tech.lastHeartbeat = hb.last_heartbeat
        tech.hbGpsOn   = hb.gps_on   ?? undefined
        tech.hbNetOn   = hb.net_on   ?? undefined
        tech.hbPerm    = hb.perm     ?? undefined
        tech.hbBattery = hb.battery  ?? undefined
        tech.hbCharging = hb.charging ?? undefined
        // El latido puede sacar a un técnico de 'offline' a 'no_signal' (sigue
        // vivo) sin esperar a que llegue un punto GPS.
        if (tech.status !== 'accident') {
          tech.status = computeStatus(tech.lastSeen, tech.lastSpeed, Date.now(), tech.lastHeartbeat)
        }
      }),

    refreshStatuses: () =>
      set((state) => {
        const now = Date.now()
        Object.values(state.technicians).forEach((tech) => {
          if (tech.status === 'accident') return
          tech.status = computeStatus(tech.lastSeen, tech.lastSpeed, now, tech.lastHeartbeat)
        })
      }),
  }))
)
