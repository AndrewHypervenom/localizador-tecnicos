import * as Battery from 'expo-battery';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { ensureAuth } from '../lib/supabase';
import {
  enqueueLocation,
  flushLocationQueue,
  flushMotionQueue,
  getQueueCount,
  isOnline,
  loadLastUploaded,
  loadTechnicianId,
  storeLastError,
  storeLastUploaded,
  type LocationRow,
} from './offlineQueue';
import { applyTrackingTier } from './locationService';
import { detectMotionFromGPS, setTechIdForSensor } from './sensorService';
import { setMockDetected } from './mockLocationGuard';

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
const ACCURACY_MAX_M       = 50;       // descartar fixes con radio de error mayor (causan "saltos")
const BATTERY_TTL_MS       = 60_000;   // refrescar batería como mucho cada 60 s

// ── Envío por lotes (batch) ───────────────────────────────────────────────────
// En vez de un INSERT por cada fix (cada 3 s en movimiento → la radio celular
// nunca duerme y se generan ~48k paquetes por jornada), los puntos se acumulan
// en la cola local y se drenan en un solo envío cada BATCH_INTERVAL_MS, o antes
// si se juntan BATCH_MAX_PENDING. Recorta los envíos de red ~10× y baja el
// consumo de CPU y de wake locks, sin perder puntos (solo se difiere su envío).
const BATCH_INTERVAL_MS = 30_000;  // cada cuánto se vacía la cola hacia el servidor
const BATCH_MAX_PENDING = 25;      // o antes, si se acumulan tantos puntos sin enviar

// ── Estado a nivel de módulo (sobrevive entre invocaciones en el mismo hilo JS) ─
let _batteryLevel: number | null = null;
let _batteryTs     = 0;
let _lastMovingTs  = Date.now();
let _lastFlushTs   = 0;

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

    // ── Anti "Fake GPS": no subir fixes simulados ──
    // Android marca loc.mocked = true cuando la posición viene de una app de
    // ubicación falsa. Lo señalamos (para que la UI bloquee y suspenda el
    // rastreo) y descartamos el punto sin enviarlo.
    if (loc.mocked) { setMockDetected(true); return; }
    setMockDetected(false);

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

    // ── Flush por lotes: drenar la cola hacia el servidor solo cada
    // BATCH_INTERVAL_MS (o si ya se acumularon demasiados puntos), en lugar de un
    // INSERT por cada fix. Así la radio celular duerme entre envíos y bajan CPU
    // y wake locks. Estando offline, drainQueue no hace nada (lo verifica dentro).
    const timeToFlush    = now - _lastFlushTs >= BATCH_INTERVAL_MS;
    const tooManyPending = !timeToFlush && (await getQueueCount()) >= BATCH_MAX_PENDING;
    if (timeToFlush || tooManyPending) {
      _lastFlushTs = now;
      try {
        if (await isOnline()) {
          await ensureAuth();
          await flushLocationQueue();
          await flushMotionQueue();
        }
      } catch (e: any) {
        await storeLastError(e?.message ?? 'Error desconocido');
      }
    }

    // ── Descartar fixes imprecisos: son la causa de los "saltos" en el mapa ──
    // (un radio de error grande puede caer lejísimos del punto real). El backlog
    // ya se drenó arriba, así que ignorar este punto no detiene la sincronización.
    if (accuracy != null && accuracy > ACCURACY_MAX_M) return;

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

    // Siempre encolar: el envío real ocurre en el flush por lotes de arriba.
    // (Antes se insertaba aquí mismo en cada fix, lo que mantenía la radio
    // despierta cada 3 s. Ahora el punto se difiere y viaja junto con los demás.)
    await enqueueLocation(row);
    await storeLastUploaded({ lat: latitude, lng: longitude, ts: now });
  }
);
