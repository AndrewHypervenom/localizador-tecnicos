import {
  loadTechnicianId,
  loadGpsState, storeGpsState,
  loadNetState, storeNetState,
  loadBattOptState, storeBattOptState,
  loadPermState, storePermState, type PermLevel,
  loadLastFixTs,
} from './offlineQueue';
import { reportDeviceEvent } from './sensorService';

// ── Auditoría de dispositivo (evidencia de sabotaje al rastreo) ───────────────
// Detecta TRANSICIONES de estado del teléfono (GPS, red, optimización de batería)
// comparando contra el último estado persistido, y deja un motion_event con hora
// y última posición conocida. Es la pieza que cierra el hueco principal: como el
// estado vive en AsyncStorage, funciona igual desde la UI (sondeo cada 4 s) que
// desde el watchdog/background task (app cerrada), así que apagar el GPS o los
// datos "a escondidas" en segundo plano TAMBIÉN deja huella.
//
// Reglas comunes a todas:
//   - Solo emite si hay una sesión de rastreo activa (technicianId persistido).
//   - El primer muestreo (estado previo == null) solo SIEMBRA el estado, no
//     dispara evento (evita un falso positivo al abrir la app).
//   - Siempre persiste el estado nuevo, haya o no sesión, para tener continuidad.

/** Siembra los estados con la foto actual al iniciar una sesión, sin emitir eventos. */
export async function seedDeviceState(opts: {
  gpsOn?: boolean;
  connected?: boolean;
  batteryOptimized?: boolean;
  perm?: PermLevel;
}): Promise<void> {
  if (opts.gpsOn !== undefined)            await storeGpsState(opts.gpsOn);
  if (opts.connected !== undefined)        await storeNetState(opts.connected);
  if (opts.batteryOptimized !== undefined) await storeBattOptState(opts.batteryOptimized);
  if (opts.perm !== undefined)             await storePermState(opts.perm);
}

/** GPS encendido/apagado. Devuelve el evento emitido (o null si no hubo transición). */
export async function auditGps(servicesOn: boolean): Promise<'gps_on' | 'gps_off' | null> {
  const prev = await loadGpsState();
  await storeGpsState(servicesOn);
  if (prev === null || prev === servicesOn) return null;
  const techId = await loadTechnicianId();
  if (!techId) return null;
  const ev = servicesOn ? 'gps_on' : 'gps_off';
  await reportDeviceEvent(techId, ev);
  return ev;
}

/** Datos/Wi-Fi conectados o no. Devuelve el evento emitido (o null). */
export async function auditNet(connected: boolean): Promise<'net_on' | 'net_off' | null> {
  const prev = await loadNetState();
  await storeNetState(connected);
  if (prev === null || prev === connected) return null;
  const techId = await loadTechnicianId();
  if (!techId) return null;
  const ev = connected ? 'net_on' : 'net_off';
  await reportDeviceEvent(techId, ev);
  return ev;
}

/**
 * Optimización de batería re-activada / quitada. `optimized = true` significa
 * que el SO la volvió a restringir (el truco clásico para matar el servicio).
 * Solo tiene sentido en Android no-Xiaomi (en Xiaomi la capa MIUI no es legible);
 * el llamador decide si invocarla.
 */
export async function auditBatteryOpt(optimized: boolean): Promise<'battery_restricted' | 'battery_unrestricted' | null> {
  const prev = await loadBattOptState();
  await storeBattOptState(optimized);
  if (prev === null || prev === optimized) return null;
  const techId = await loadTechnicianId();
  if (!techId) return null;
  const ev = optimized ? 'battery_restricted' : 'battery_unrestricted';
  await reportDeviceEvent(techId, ev);
  return ev;
}

/**
 * Permiso de ubicación. Solo importa la transición FUNCIONAL: perder o recuperar
 * "Permitir siempre" (full), que es lo que habilita el rastreo en segundo plano.
 * Bajar a "Solo en uso" (partial) o revocar (none) sin apagar el GPS es un truco
 * para que el rastreo deje de funcionar pareciendo que "la app no sirve".
 * Cambios entre partial/none no se reportan (ya no había rastreo de fondo).
 */
export async function auditPermission(level: PermLevel): Promise<'perm_revoked' | 'perm_granted' | null> {
  const prev = await loadPermState();
  await storePermState(level);
  if (prev === null || prev === level) return null;
  const techId = await loadTechnicianId();
  if (!techId) return null;
  const wasFull = prev === 'full';
  const isFull  = level === 'full';
  if (wasFull && !isFull) { await reportDeviceEvent(techId, 'perm_revoked'); return 'perm_revoked'; }
  if (!wasFull && isFull) { await reportDeviceEvent(techId, 'perm_granted'); return 'perm_granted'; }
  return null;
}

// Hueco mínimo sin fixes para considerar que el rastreo se INTERRUMPIÓ (no un
// simple reinicio rápido de la app). Por debajo de esto no se reporta para no
// generar ruido al reabrir la app a los pocos segundos. Bajado de 5→3 min para
// detectar el force-stop antes (con el heartbeat de fondo, 3 min ya descarta un
// reinicio rápido sin generar falsos positivos en equipos lentos).
const KILLED_GAP_MS = 3 * 60_000;

/**
 * Detecta que una sesión activa quedó sin servicio de ubicación corriendo
 * (force-stop, swipe de recientes, o el SO mató el proceso por memoria) y que
 * hubo un hueco real sin fixes. Se llama al arrancar la app ANTES de revivir el
 * rastreo. Deja un 'tracking_killed' como evidencia de la interrupción.
 *
 * `serviceRunning` = ¿el task de ubicación sigue iniciado? (isTracking()).
 * Devuelve true si registró el evento.
 */
export async function auditTrackingKilled(serviceRunning: boolean): Promise<boolean> {
  if (serviceRunning) return false;
  const techId = await loadTechnicianId();
  if (!techId) return false;                 // no había sesión: arranque limpio
  const lastFix = await loadLastFixTs();
  if (lastFix === null) return false;        // nunca entregó fixes: nada que interrumpir
  if (Date.now() - lastFix < KILLED_GAP_MS) return false;
  await reportDeviceEvent(techId, 'tracking_killed');
  return true;
}
