import * as Location from 'expo-location';
import { PermissionsAndroid, Platform } from 'react-native';
import { LOCATION_TASK } from './locationTask';
import { removeTechnicianId, storeTechnicianId, loadTechnicianId, loadLastFixTs, flushLocationQueue, flushMotionQueue } from './offlineQueue';
import { setTechIdForSensor, startAccelerometer, stopAccelerometer } from './sensorService';
import { auditGps, seedDeviceState } from './deviceAudit';
import { supabase, ensureAuth } from '../lib/supabase';

// ── Niveles (tiers) de captura GPS para ahorrar batería ───────────────────────
// MOVING: alta precisión y frecuencia cuando el técnico se desplaza.
// STATIONARY: baja frecuencia cuando lleva rato detenido (igual envía heartbeat).
export type TrackingTier = 'MOVING' | 'STATIONARY';

const TIER_OPTIONS: Record<TrackingTier, Location.LocationTaskOptions> = {
  MOVING: {
    accuracy:         Location.Accuracy.High,
    // 5 s alinea con los reportes: la ruta de viaje agrupa en buckets de 5 s,
    // así que capturar más rápido (antes 3 s) solo quemaba batería sin sumar
    // detalle visible en el mapa ni en las distancias.
    timeInterval:     5_000,
    distanceInterval: 0,
  },
  STATIONARY: {
    // Mantener High: Balanced usa ubicación de red/fusionada que reporta
    // speed=0 y posiciones imprecisas, rompiendo la velocidad al reanudar.
    // El ahorro real de batería viene del intervalo, no de bajar la precisión.
    accuracy:         Location.Accuracy.High,
    // 30 s: antes (10 s) el throttle de subida descartaba 2 de cada 3 fixes —
    // el GPS trabajaba 3× para nada. Con 30 s cada fix capturado se sube
    // (cadencia en el servidor: igual que antes, ~1 punto/30 s detenido).
    timeInterval:     30_000,
    distanceInterval: 0,
  },
};

let _currentTier: TrackingTier = 'MOVING';

/** Nivel de captura GPS actual (para el latido/heartbeat). */
export function getCurrentTier(): TrackingTier {
  return _currentTier;
}

const FOREGROUND_SERVICE = {
  notificationTitle: 'Localizador PositivoS+ Activo',
  notificationBody:  'Localizando ubicación en segundo plano...',
  notificationColor: '#00D632',
};

function tierConfig(tier: TrackingTier): Location.LocationTaskOptions {
  return {
    ...TIER_OPTIONS[tier],
    pausesUpdatesAutomatically:       false,
    showsBackgroundLocationIndicator: true,
    foregroundService:                FOREGROUND_SERVICE,
  };
}

export async function requestPermissions(): Promise<boolean> {
  const servicesOn = await Location.hasServicesEnabledAsync();
  if (!servicesOn) return false;

  if (Platform.OS === 'android' && Platform.Version >= 33) {
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  }

  const { status: fg } = await Location.requestForegroundPermissionsAsync();
  if (fg !== 'granted') return false;

  // Verificar primero para no abrir Ajustes si ya está concedido
  const { status: bgExisting } = await Location.getBackgroundPermissionsAsync();
  if (bgExisting === 'granted') return true;

  const { status: bg } = await Location.requestBackgroundPermissionsAsync();
  return bg === 'granted';
}

/** Comprueba permisos sin mostrar ningún diálogo ni abrir Ajustes. */
export async function hasAllPermissions(): Promise<boolean> {
  const servicesOn = await Location.hasServicesEnabledAsync();
  if (!servicesOn) return false;
  const { status: fg } = await Location.getForegroundPermissionsAsync();
  if (fg !== 'granted') return false;
  const { status: bg } = await Location.getBackgroundPermissionsAsync();
  return bg === 'granted';
}

export async function startTracking(technicianId: string): Promise<void> {
  await storeTechnicianId(technicianId);
  setTechIdForSensor(technicianId);
  startAccelerometer();

  // Sembrar el estado de GPS y permiso con la foto actual para que la auditoría
  // no dispare un falso "se encendió/apagó" ni un falso "revocó permiso" en el
  // primer muestreo de la sesión.
  const { status: fgPerm } = await Location.getForegroundPermissionsAsync();
  const { status: bgPerm } = await Location.getBackgroundPermissionsAsync();
  const permSeed = fgPerm !== 'granted' ? 'none' : bgPerm === 'granted' ? 'full' : 'partial';
  await seedDeviceState({ gpsOn: await Location.hasServicesEnabledAsync(), perm: permSeed });

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  supabase.from('technicians').update({ timezone: tz }).eq('id', technicianId).then(
    ({ error }) => { if (error) console.warn('[startTracking] timezone update:', error.message) }
  );

  _currentTier = 'MOVING';
  await Location.startLocationUpdatesAsync(LOCATION_TASK, tierConfig('MOVING'));
}

/**
 * Cambia el nivel de captura GPS (frecuencia/precisión) en caliente. Se llama
 * desde el background task según la velocidad detectada. No hace nada si el
 * nivel no cambió, para no reiniciar el servicio innecesariamente.
 */
export async function applyTrackingTier(tier: TrackingTier): Promise<void> {
  if (tier === _currentTier) return;
  const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  if (!running) return;
  _currentTier = tier;
  await Location.startLocationUpdatesAsync(LOCATION_TASK, tierConfig(tier));
  // Acelerómetro solo cuando hay desplazamiento: parado no hay choque/frenada
  // que detectar y el sensor a 10 lecturas/seg consume todo el día. Ventana
  // ciega asumida: los primeros segundos al arrancar, hasta el primer fix en
  // movimiento. startAccelerometer es idempotente (guard interno).
  if (tier === 'STATIONARY') stopAccelerometer();
  else startAccelerometer();
}

export async function stopTracking(): Promise<void> {
  stopAccelerometer();

  // Enviar lo que quede en cola ANTES de soltar el servicio: tras detener, el
  // background task ya no se ejecuta, así que esta es la última oportunidad de
  // mapear los puntos finales de una sesión corta. force=true ignora el backoff.
  try {
    await ensureAuth();
    await flushLocationQueue(true);
    await flushMotionQueue(true);
  } catch (e: any) {
    console.warn('[stopTracking] flush final:', e?.message);
  }

  const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  if (running) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  await removeTechnicianId();
}

export async function isTracking(): Promise<boolean> {
  return Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
}

// Si con sesión activa y GPS encendido no entra un fix en este lapso, el request
// nativo está "vivo pero mudo" (caso típico: el técnico apagó y volvió a encender
// el GPS) y hay que re-suscribir. En STATIONARY los fixes llegan cada ~30 s, así
// que 90 s (3× el intervalo) tolera un fix perdido sin reiniciar el servicio en
// falso. La recuperación rápida del caso "apagó/encendió GPS" sigue cubierta por
// la transición gps_on que dispara ensureTrackingHealthy desde HomeScreen.
const STALE_FIX_MS = 90_000;

/**
 * Re-suscribe el servicio de ubicación (stop + start). Es necesario cuando el
 * request nativo sigue "iniciado" pero dejó de entregar fixes: un
 * startLocationUpdatesAsync por sí solo NO reengancha la petición vieja; hay que
 * detenerla y volver a arrancarla. A diferencia de startTracking, no re-guarda
 * el técnico: la sesión ya está en curso.
 */
export async function restartTracking(): Promise<void> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    }
  } catch { /* el servicio ya no estaba; seguimos a arrancar */ }
  _currentTier = 'MOVING';
  // El tier vuelve a MOVING sin pasar por applyTrackingTier (que es quien
  // gestiona el acelerómetro según tier): re-armarlo aquí explícitamente.
  startAccelerometer();
  await Location.startLocationUpdatesAsync(LOCATION_TASK, tierConfig('MOVING'));
}

/**
 * Verifica que el rastreo siga ENTREGANDO ubicaciones, no solo que esté
 * "iniciado" (hasStartedLocationUpdatesAsync devuelve true aunque el servicio
 * haya dejado de entregar fixes). Es el watchdog real contra el bug de
 * "apago/enciendo el GPS y no vuelve". Si no hay sesión, no hace nada. Si la hay:
 *   - no está iniciado                              → arranca de cero
 *   - iniciado, GPS apagado                         → nada que reanudar todavía
 *   - iniciado, GPS encendido, sin fixes recientes  → re-suscribe (stop+start)
 * Devuelve la acción tomada (útil para diagnóstico).
 */
export async function ensureTrackingHealthy(): Promise<
  'idle' | 'started' | 'restarted' | 'ok' | 'gps-off'
> {
  const technicianId = await loadTechnicianId();
  if (!technicianId) return 'idle';

  if (!(await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK))) {
    await startTracking(technicianId);
    return 'started';
  }

  // Auditar la transición del GPS también desde el watchdog en SEGUNDO PLANO:
  // si el técnico apagó la ubicación con la app cerrada, esto deja la evidencia
  // (gps_off) aunque el sondeo en primer plano de HomeScreen no esté corriendo.
  const servicesOn = await Location.hasServicesEnabledAsync();
  await auditGps(servicesOn);

  // Si el GPS está apagado no hay fix que esperar; el banner de HomeScreen ya lo
  // avisa y la transición a "encendido" dispara el re-enganche.
  if (!servicesOn) return 'gps-off';

  const lastFix = await loadLastFixTs();
  const stale = lastFix === null || Date.now() - lastFix >= STALE_FIX_MS;
  if (stale) {
    await restartTracking();
    return 'restarted';
  }
  return 'ok';
}
