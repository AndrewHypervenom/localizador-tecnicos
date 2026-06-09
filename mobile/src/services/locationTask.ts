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
  storeLastFixTs,
  storeLastUploaded,
  type LocationRow,
} from './offlineQueue';
import { applyTrackingTier } from './locationService';
import { detectMotionFromGPS, setTechIdForSensor } from './sensorService';
import { auditGps, auditNet } from './deviceAudit';
import { setMockDetected } from './mockLocationGuard';
import { sendHeartbeat } from './heartbeat';

export const LOCATION_TASK = 'BACKGROUND_LOCATION_TASK';

// ── Parámetros del throttle adaptativo ────────────────────────────────────────
// Umbral de "detenido". Antes 1.4 m/s (≈5 km/h) confundía a quien camina
// (≈1.1–1.5 m/s) con alguien parado, lo que silenciaba el rastreo y la velocidad.
// 0.7 m/s (≈2.5 km/h) solo trata como detenido a quien está realmente quieto,
// dejando que caminar cuente como movimiento (sirve tanto a pie como en vehículo).
const STATIONARY_SPEED_MS  = 0.7;
const MIN_MOVE_M           = 15;       // distancia mínima para subir estando lento
// En tier STATIONARY los fixes llegan cada ~30 s: el throttle debe ser MENOR que
// ese intervalo, o el jitter (un fix que llega a los 29.8 s) lo descartaría y la
// cadencia real en el servidor se duplicaría a 60 s (y el líder vería parpadeos).
const STATIONARY_UPLOAD_MS = 25_000;
const STATIONARY_AFTER_MS  = 120_000;  // tiempo detenido antes de bajar a tier STATIONARY
const ACCURACY_MAX_M       = 50;       // descartar fixes con radio de error mayor (causan "saltos")
const BATTERY_TTL_MS       = 60_000;   // refrescar batería como mucho cada 60 s

// ── Ancla anti-deriva ─────────────────────────────────────────────────────────
// Con el teléfono quieto, el GPS "deriva": los fixes se dispersan 10-50 m
// alrededor del punto real, pasan el filtro de precisión y el umbral de 15 m, y
// el mapa del líder dibuja líneas aleatorias de movimiento que nunca ocurrió
// (además la deriva trae velocidades falsas > 0.7 m/s que mantenían el tier
// MOVING gastando batería). Al confirmarse detenido se fija un ANCLA: mientras
// los fixes caigan dentro del radio se suben con las coordenadas del ancla y
// speed 0 (punto fijo en el mapa, cero distancia fantasma en reportes). El ancla
// se suelta solo con movimiento real: velocidad franca o varios fixes seguidos
// fuera del radio.
const DRIFT_RADIUS_M      = 30;   // dispersión típica de la deriva con Accuracy.High
const DRIFT_EXIT_FIXES    = 2;    // fixes consecutivos fuera del radio = movimiento real
const DRIFT_EXIT_SPEED_MS = 1.2;  // un solo fix confiable a este ritmo = se mueve seguro
// Caminata lenta DENTRO del sitio (2-3 km/h, sin salir del radio de 30 m): la
// velocidad no llega a DRIFT_EXIT_SPEED_MS ni la distancia al radio, y sin esta
// salida el ancla se "comía" todo el movimiento interno (el líder no veía ningún
// recorrido del técnico en el sitio). N fixes seguidos confiables por encima del
// umbral de "detenido" = caminata real, no deriva (la deriva con buena precisión
// casi nunca repite velocidades > 0.7 m/s en fixes consecutivos).
const WALK_EXIT_FIXES     = 2;

// ── Envío por lotes (batch) ───────────────────────────────────────────────────
// En vez de un INSERT por cada fix (cada 5 s en movimiento → la radio celular
// nunca duerme y se generan ~29k paquetes por jornada), los puntos se acumulan
// en la cola local y se drenan en un solo envío cada BATCH_INTERVAL_MS, o antes
// si se juntan BATCH_MAX_PENDING. Recorta los envíos de red ~10× y baja el
// consumo de CPU y de wake locks, sin perder puntos (solo se difiere su envío).
const BATCH_INTERVAL_MS = 30_000;  // cada cuánto se vacía la cola hacia el servidor
const BATCH_MAX_PENDING = 25;      // o antes, si se acumulan tantos puntos sin enviar

// ── Estado a nivel de módulo (sobrevive entre invocaciones en el mismo hilo JS) ─
let _batteryLevel: number | null = null;
let _batteryTs     = 0;
let _charging: boolean | null = null;
let _chargingTs    = 0;
let _lastMovingTs  = Date.now();
let _lastFlushTs   = 0;
let _anchor: { lat: number; lng: number } | null = null;
let _driftExitCount = 0;
let _walkExitCount  = 0;

async function getBatteryCached(): Promise<number | null> {
  const now = Date.now();
  if (_batteryLevel !== null && now - _batteryTs < BATTERY_TTL_MS) return _batteryLevel;
  try {
    const level = await Battery.getBatteryLevelAsync();
    if (level >= 0) { _batteryLevel = Math.round(level * 100); _batteryTs = now; }
  } catch { /* no crítico */ }
  return _batteryLevel;
}

/** ¿El dispositivo está cargando? Cacheado (sirve para medir el drenaje real). */
async function getChargingCached(): Promise<boolean | null> {
  const now = Date.now();
  if (_charging !== null && now - _chargingTs < BATTERY_TTL_MS) return _charging;
  try {
    const st = await Battery.getBatteryStateAsync();
    _charging = st === Battery.BatteryState.CHARGING || st === Battery.BatteryState.FULL;
    _chargingTs = now;
  } catch { /* no crítico */ }
  return _charging;
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

    // Heartbeat de "GPS vivo": el servicio acaba de entregar un fix. Se marca
    // ANTES de los filtros (precisión/throttle) para que el watchdog sepa que
    // el GPS sigue entregando aunque este punto en concreto no se suba.
    void storeLastFixTs();

    // Llegó un fix → el GPS está encendido. Cierra la bitácora (gps_on) si venía
    // de un apagado detectado en segundo plano, sin esperar a que se abra la UI.
    void auditGps(true);

    const { latitude, longitude, altitude, accuracy, speed, heading } = loc.coords;
    // iOS/Android reportan speed = -1 (o null) cuando el fix no tiene velocidad
    // fiable. Lo normalizamos a null para que no contamine los promedios (un -1
    // arrastraría AVG(speed) hacia abajo y falsearía la "Vel. prom").
    const validSpeed = speed != null && speed >= 0 ? speed : null;
    const speedMs = validSpeed ?? 0;
    const now = Date.now();

    // ── Ancla anti-deriva: ¿este fix es deriva o movimiento real? ──
    // Mientras esté anclado, el punto se sube con las coordenadas del ancla y
    // speed 0, y la velocidad falsa de la deriva NO cuenta para el tier ni para
    // los eventos de conducción.
    let upLat = latitude, upLng = longitude;
    let upSpeed = validSpeed;
    let effSpeedMs = speedMs;
    let snapped = false;
    if (_anchor) {
      // Solo los fixes CONFIABLES (precisión aceptable) cuentan como evidencia
      // de movimiento: bajo techo la precisión se degrada a 60-100 m y esa
      // dispersión soltaría el ancla con posiciones basura.
      const trustedFix = accuracy == null || accuracy <= ACCURACY_MAX_M;
      const driftDist = haversineM(_anchor.lat, _anchor.lng, latitude, longitude);
      if (trustedFix) {
        _driftExitCount = driftDist >= DRIFT_RADIUS_M ? _driftExitCount + 1 : 0;
        _walkExitCount  = speedMs > STATIONARY_SPEED_MS ? _walkExitCount + 1 : 0;
      }
      const realMove = trustedFix && (
        speedMs > DRIFT_EXIT_SPEED_MS ||        // velocidad franca: un solo fix basta
        _walkExitCount  >= WALK_EXIT_FIXES ||   // caminata lenta sostenida (en el sitio)
        _driftExitCount >= DRIFT_EXIT_FIXES     // desplazamiento sin velocidad fiable
      );
      if (realMove) {
        _anchor = null;            // movimiento real confirmado → soltar el ancla
        _driftExitCount = 0;
        _walkExitCount  = 0;
        // Subir de una vez a tier MOVING (5 s) para capturar el recorrido en el
        // sitio con buena densidad aunque la velocidad cruda sea baja.
        _lastMovingTs = now;
      } else {
        upLat = _anchor.lat;
        upLng = _anchor.lng;
        upSpeed = 0;
        effSpeedMs = 0;
        snapped = true;
      }
    }

    detectMotionFromGPS(effSpeedMs, heading ?? 0);

    // ── Ajustar nivel de captura GPS (con histéresis para no oscilar) ──
    if (effSpeedMs > STATIONARY_SPEED_MS) {
      _lastMovingTs = now;
      void applyTrackingTier('MOVING');
    } else if (now - _lastMovingTs >= STATIONARY_AFTER_MS) {
      // Confirmado detenido: fijar el ancla (si no estaba) en la última posición
      // SUBIDA — esa ya pasó el filtro de precisión; el fix actual puede venir
      // degradado si el técnico está bajo techo.
      if (!_anchor) {
        const lastUp = await loadLastUploaded();
        _anchor = lastUp
          ? { lat: lastUp.lat, lng: lastUp.lng }
          : { lat: latitude, lng: longitude };
        _driftExitCount = 0;
        _walkExitCount  = 0;
      }
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
        const online = await isOnline();
        // Auditar la conexión en segundo plano: si el técnico apagó los datos /
        // Wi-Fi con la app cerrada (pero el GPS sigue entregando fixes), esto deja
        // la evidencia (net_off) y registra net_on al reconectar.
        void auditNet(online);
        if (online) {
          await ensureAuth();
          await flushLocationQueue();
          await flushMotionQueue();
          // Latido de "app viva" desde segundo plano (piggyback del flush).
          void sendHeartbeat({ appState: 'background' });
        }
      } catch (e: any) {
        await storeLastError(e?.message ?? 'Error desconocido');
      }
    }

    // ── Descartar fixes imprecisos: son la causa de los "saltos" en el mapa ──
    // (un radio de error grande puede caer lejísimos del punto real). El backlog
    // ya se drenó arriba, así que ignorar este punto no detiene la sincronización.
    // EXCEPCIÓN: anclado (snapped) las coordenadas subidas son las del ANCLA, no
    // las del fix, así que su precisión no importa. Descartarlo dejaba al técnico
    // "mudo" bajo techo (accuracy 60-100 m) y el líder lo veía Inactivo/Detenido
    // con la app perfectamente sana.
    if (!snapped && accuracy != null && accuracy > ACCURACY_MAX_M) return;

    // ── Throttle: si está detenido y ya envió hace poco, no subir el punto nuevo ──
    // (con ancla activa upLat/upLng = ancla → dist 0, solo manda la cadencia de 25 s)
    if (!(await shouldUpload(upLat, upLng, effSpeedMs, now))) return;

    const row: LocationRow = {
      technician_id: technicianId,
      ts:            new Date(loc.timestamp).toISOString(),
      location:      `POINT(${upLng} ${upLat})`,
      speed:         upSpeed,
      altitude:      altitude ?? null,
      bearing:       heading ?? null,
      // Anclado, la coordenada subida es la del ANCLA (confiable), no la del fix:
      // reportar la precisión cruda del fix (60-100 m bajo techo) haría que las
      // consultas del historial (filtro accuracy < 30 m) descartaran el punto y
      // el técnico quieto "desapareciera" del recorrido. null = posición confiable
      // sin radio de error aplicable.
      accuracy:      snapped ? null : (accuracy ?? null),
      battery_level: await getBatteryCached(),
      charging:      await getChargingCached(),
    };

    // Siempre encolar: el envío real ocurre en el flush por lotes de arriba.
    // (Antes se insertaba aquí mismo en cada fix, lo que mantenía la radio
    // despierta en cada captura. Ahora el punto se difiere y viaja con los demás.)
    await enqueueLocation(row);
    await storeLastUploaded({ lat: upLat, lng: upLng, ts: now });
  }
);
