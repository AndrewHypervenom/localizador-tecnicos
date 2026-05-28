import * as Location from 'expo-location';
import { PermissionsAndroid, Platform } from 'react-native';
import { LOCATION_TASK } from './locationTask';
import { removeTechnicianId, storeTechnicianId } from './offlineQueue';
import { setTechIdForSensor, startAccelerometer, stopAccelerometer } from './sensorService';
import { supabase } from '../lib/supabase';

// ── Niveles (tiers) de captura GPS para ahorrar batería ───────────────────────
// MOVING: alta precisión y frecuencia cuando el técnico se desplaza.
// STATIONARY: baja frecuencia cuando lleva rato detenido (igual envía heartbeat).
export type TrackingTier = 'MOVING' | 'STATIONARY';

const TIER_OPTIONS: Record<TrackingTier, Location.LocationTaskOptions> = {
  MOVING: {
    accuracy:         Location.Accuracy.High,
    timeInterval:     3_000,
    distanceInterval: 0,
  },
  STATIONARY: {
    accuracy:         Location.Accuracy.Balanced,
    timeInterval:     20_000,
    distanceInterval: 10,
  },
};

let _currentTier: TrackingTier = 'MOVING';

const FOREGROUND_SERVICE = {
  notificationTitle: 'Localizador PositivoS+ Activo',
  notificationBody:  'Rastreando ubicación en segundo plano...',
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
}

export async function stopTracking(): Promise<void> {
  stopAccelerometer();
  const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  if (running) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  await removeTechnicianId();
}

export async function isTracking(): Promise<boolean> {
  return Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
}
