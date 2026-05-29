import * as Battery from 'expo-battery';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { ensureAuth, supabase } from '../lib/supabase';
import {
  enqueueLocation,
  flushLocationQueue,
  flushMotionQueue,
  getQueueCount,
  isOnline,
  loadLastUploaded,
  loadTechnicianId,
  storeLastError,
  storeLastSent,
  storeLastUploaded,
  clearLastError,
  type LocationRow,
} from './offlineQueue';
import { applyTrackingTier } from './locationService';
import { detectMotionFromGPS, setTechIdForSensor } from './sensorService';

export const LOCATION_TASK = 'BACKGROUND_LOCATION_TASK';

// ── Parámetros del throttle adaptativo ────────────────────────────────────────
// Umbral de "detenido". Antes 1.4 m/s (≈5 km/h) confundía a quien camina
// (≈1.1–1.5 m/s) con alguien parado, lo que silenciaba el rastreo y la velocidad.
// 0.7 m/s (≈2.5 km/h) solo trata como detenido a quien está realmente quieto,
// dejando que caminar cuente como movimiento (sirve tanto a pie como en vehículo).
const STATIONARY_SPEED_MS  = 0.7;
const MIN_MOVE_M           = 15;       // distancia mínima para subir estando lento
const STATIONARY_UPLOAD_MS = 30_000;   // heartbeat estando detenido
const STATIONARY_AFTER_MS  = 120_000;  // tiempo detenido antes de bajar a tier STATIONARY
const BATTERY_TTL_MS       = 60_000;   // refrescar batería como mucho cada 60 s

// ── Estado a nivel de módulo (sobrevive entre invocaciones en el mismo hilo JS) ─
let _batteryLevel: number | null = null;
let _batteryTs     = 0;
let _lastMovingTs  = Date.now();

async function getBatteryCached(): Promise<number | null> {
  const now = Date.now();
  if (_batteryLevel !== null && now - _batteryTs < BATTERY_TTL_MS) return _batteryLevel;
  try {
    const level = await Battery.getBatteryLevelAsync();
    if (level >= 0) { _batteryLevel = Math.round(level * 100); _batteryTs = now; }
  } catch { /* no crítico */ }
  return _batteryLevel;
}

function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const dLat = (bLat - aLat) * Math.PI / 180;
  const dLng = (bLng - aLng) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** ¿Vale la pena subir este punto, o el técnico está detenido y basta el heartbeat? */
async function shouldUpload(lat: number, lng: number, speedMs: number, now: number): Promise<boolean> {
  if (speedMs > STATIONARY_SPEED_MS) return true;
  const last = await loadLastUploaded();
  if (!last) return true;
  if (now - last.ts >= STATIONARY_UPLOAD_MS) return true;          // heartbeat
  if (haversineM(last.lat, last.lng, lat, lng) >= MIN_MOVE_M) return true;
  return false;
}

// Must be defined at module level, before any React rendering.
// index.js imports this file first to guarantee registration.
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
  LOCATION_TASK,
  async ({ data, error }) => {
    if (error) { console.error('[LocationTask]', error.message); return; }
    if (!data?.locations?.length) return;

    const technicianId = await loadTechnicianId();
    if (!technicianId) return;

    setTechIdForSensor(technicianId);

    const loc = data.locations[data.locations.length - 1];
    const { latitude, longitude, altitude, accuracy, speed, heading } = loc.coords;
    // iOS/Android reportan speed = -1 (o null) cuando el fix no tiene velocidad
    // fiable. Lo normalizamos a null para que no contamine los promedios (un -1
    // arrastraría AVG(speed) hacia abajo y falsearía la "Vel. prom").
    const validSpeed = speed != null && speed >= 0 ? speed : null;
    const speedMs = validSpeed ?? 0;
    const now = Date.now();

    detectMotionFromGPS(speedMs, heading ?? 0);

    // ── Ajustar nivel de captura GPS (con histéresis para no oscilar) ──
    if (speedMs > STATIONARY_SPEED_MS) {
      _lastMovingTs = now;
      void applyTrackingTier('MOVING');
    } else if (now - _lastMovingTs >= STATIONARY_AFTER_MS) {
      void applyTrackingTier('STATIONARY');
    }

    // ── Drenar backlog SIEMPRE (respeta red, backoff y cola vacía) ──
    try {
      await ensureAuth();
      await flushLocationQueue();
      await flushMotionQueue();
    } catch (e: any) {
      await storeLastError(e?.message ?? 'Error desconocido');
    }

    // ── Throttle: si está detenido y ya envió hace poco, no subir el punto nuevo ──
    if (!(await shouldUpload(latitude, longitude, speedMs, now))) return;

    const row: LocationRow = {
      technician_id: technicianId,
      ts:            new Date(loc.timestamp).toISOString(),
      location:      `POINT(${longitude} ${latitude})`,
      speed:         validSpeed,
      altitude:      altitude ?? null,
      bearing:       heading ?? null,
      accuracy:      accuracy ?? null,
      battery_level: await getBatteryCached(),
    };

    try {
      if (!(await isOnline())) {
        await enqueueLocation(row);
        await storeLastUploaded({ lat: latitude, lng: longitude, ts: now });
        return;
      }
      // Si quedó backlog (flush parcial por backoff/error), encolar para preservar el orden FIFO.
      if (await getQueueCount() > 0) {
        await enqueueLocation(row);
      } else {
        const { error: err } = await supabase.from('location_events').insert(row);
        if (err) throw new Error(err.message);
        await storeLastSent();
        await clearLastError();
      }
      await storeLastUploaded({ lat: latitude, lng: longitude, ts: now });
    } catch (e: any) {
      const msg = e?.message ?? 'Error desconocido';
      console.error('[LocationTask] fallo al enviar:', msg);
      await storeLastError(msg);
      await enqueueLocation(row);
      await storeLastUploaded({ lat: latitude, lng: longitude, ts: now });
    }
  }
);
