import { Accelerometer } from 'expo-sensors';
import * as Location from 'expo-location';
import { ensureAuth, supabase } from '../lib/supabase';
import { enqueueMotion, type MotionRow } from './offlineQueue';

// Thresholds (mirrors the Kotlin SensorMonitorService)
const ACCIDENT_THRESHOLD_MS2 = 25.0;  // m/s² net magnitude
const HARD_BRAKE_DELTA       = 8.0;   // m/s drop in 3s window
const RAPID_ACCEL_DELTA      = 8.0;   // m/s gain in 3s window
const HARSH_TURN_DEG         = 45.0;  // degrees in 2s window
const EVENT_SPEED_MIN_MS     = 5.0;   // only above ~18 km/h
const TIME_WINDOW_MS         = 3_000;
const COOLDOWN_MS            = 3_000;
const SUSTAINED_ACCIDENT_MS  = 150;   // ms above threshold to confirm accident

// Module-level state (survives background task re-invocations in the same JS thread)
let _technicianId    = '';
let _lastSpeedMs     = 0;
let _lastSpeedTs     = 0;
let _lastBearingDeg  = 0;
let _lastBearingTs   = 0;
let _highGStartTs    = 0;
const _lastEventTs   = new Map<string, number>();

let _subscription: ReturnType<typeof Accelerometer.addListener> | null = null;

export function setTechIdForSensor(id: string) {
  _technicianId = id;
}

// ── Foreground-only: accelerometer crash detection ───────────────────────────

export function startAccelerometer() {
  if (_subscription) return;
  Accelerometer.setUpdateInterval(100);
  _subscription = Accelerometer.addListener(({ x, y, z }) => {
    // Remove gravity component (same approach as Kotlin TYPE_ACCELEROMETER fallback)
    const rawMag = Math.sqrt(x * x + y * y + z * z);
    const netMag = Math.max(rawMag - 9.81, 0);
    const now = Date.now();

    if (netMag > ACCIDENT_THRESHOLD_MS2) {
      if (_highGStartTs === 0) {
        _highGStartTs = now;
      } else if (now - _highGStartTs >= SUSTAINED_ACCIDENT_MS) {
        reportMotionEvent('accident', netMag);
        _highGStartTs = 0;
      }
    } else {
      _highGStartTs = 0;
    }
  });
}

export function stopAccelerometer() {
  _subscription?.remove();
  _subscription  = null;
  _highGStartTs  = 0;
}

// ── GPS-based motion detection (called from background location task) ─────────

export function detectMotionFromGPS(speedMs: number, bearingDeg: number) {
  const now = Date.now();

  if (_lastSpeedTs > 0 && now - _lastSpeedTs <= TIME_WINDOW_MS) {
    const brakeDelta = _lastSpeedMs - speedMs;
    if (brakeDelta >= HARD_BRAKE_DELTA && _lastSpeedMs > EVENT_SPEED_MIN_MS) {
      reportMotionEvent('hard_brake', brakeDelta);
    }
    const accelDelta = speedMs - _lastSpeedMs;
    if (accelDelta >= RAPID_ACCEL_DELTA) {
      reportMotionEvent('rapid_accel', accelDelta);
    }
  }

  if (_lastBearingTs > 0 && speedMs > EVENT_SPEED_MIN_MS && now - _lastBearingTs <= 2_000) {
    let delta = Math.abs(bearingDeg - _lastBearingDeg);
    if (delta > 180) delta = 360 - delta;
    if (delta >= HARSH_TURN_DEG) {
      reportMotionEvent('harsh_turn', delta);
    }
  }

  _lastSpeedMs    = speedMs;
  _lastSpeedTs    = now;
  _lastBearingDeg = bearingDeg;
  _lastBearingTs  = now;
}

// ── Internal ─────────────────────────────────────────────────────────────────

// ── SOS / pánico manual ────────────────────────────────────────────────────
// Alerta crítica disparada por el técnico. Salta el cooldown y el throttle:
// se intenta enviar de inmediato y, si no hay red, queda en cola.
export async function reportSosEvent(technicianId: string): Promise<'sent' | 'queued'> {
  let location: string | null = null;
  try {
    const pos = await Location.getLastKnownPositionAsync();
    if (pos) location = `POINT(${pos.coords.longitude} ${pos.coords.latitude})`;
  } catch { /* sin ubicación: igual se envía el SOS */ }

  const row: MotionRow = {
    technician_id: technicianId,
    ts:            new Date().toISOString(),
    event_type:    'sos',
    severity:      100,
    location,
  };

  try {
    await ensureAuth();
    const { error } = await supabase.from('motion_events').insert(row);
    if (error) throw new Error(error.message);
    return 'sent';
  } catch {
    await enqueueMotion(row);
    return 'queued';
  }
}

// ── Bitácora de dispositivo (evidencia para el líder) ──────────────────────
// Registra acciones que sabotean el rastreo —apagar el GPS o usar Fake GPS— como
// motion_events, para que el líder tenga un historial con hora y última posición
// conocida. Best-effort de ubicación: aunque el GPS esté apagado, el último fix
// sirve de evidencia de DÓNDE estaba. Sin red, queda en cola y se envía al
// reconectar (igual que el SOS).
export type DeviceEventType =
  | 'gps_off' | 'gps_on'        // apagó / encendió la ubicación del dispositivo
  | 'mock_on' | 'mock_off'      // detectó / cesó Fake GPS
  | 'tracking_start'            // pulsó INICIAR LOCALIZACIÓN (acción explícita)
  | 'tracking_stop'             // pulsó DETENER LOCALIZACIÓN (acción explícita)
  | 'net_off' | 'net_on'        // apagó / reactivó datos o Wi-Fi con rastreo activo
  | 'battery_restricted'        // volvió a poner la app en "ahorro de batería"
  | 'battery_unrestricted'      // quitó la restricción de batería
  | 'tracking_killed'           // la app/servicio murió y se reanudó tras un hueco
  | 'perm_revoked'              // bajó el permiso de "Permitir siempre"
  | 'perm_granted';             // restauró el permiso "Permitir siempre"

export async function reportDeviceEvent(
  technicianId: string,
  eventType: DeviceEventType,
): Promise<void> {
  if (!technicianId) return;

  let location: string | null = null;
  try {
    const pos = await Location.getLastKnownPositionAsync();
    if (pos) location = `POINT(${pos.coords.longitude} ${pos.coords.latitude})`;
  } catch { /* sin ubicación: igual se registra el evento */ }

  const row: MotionRow = {
    technician_id: technicianId,
    ts:            new Date().toISOString(),
    event_type:    eventType,
    severity:      0,
    location,
  };

  try {
    await ensureAuth();
    const { error } = await supabase.from('motion_events').insert(row);
    if (error) throw new Error(error.message);
  } catch {
    await enqueueMotion(row);
  }
}

async function reportMotionEvent(type: string, severity: number) {
  const now    = Date.now();
  const lastTs = _lastEventTs.get(type) ?? 0;
  if (now - lastTs < COOLDOWN_MS) return;
  _lastEventTs.set(type, now);

  if (!_technicianId) return;

  const row: MotionRow = {
    technician_id: _technicianId,
    ts:            new Date().toISOString(),
    event_type:    type,
    severity,
    location:      null,
  };

  try {
    const { error } = await supabase.from('motion_events').insert(row);
    if (error) throw error;
  } catch {
    await enqueueMotion(row);
  }
}
