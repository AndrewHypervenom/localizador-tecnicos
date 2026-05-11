import * as Location from 'expo-location';
import { PermissionsAndroid, Platform } from 'react-native';
import { LOCATION_TASK } from './locationTask';
import { removeTechnicianId, storeTechnicianId } from './offlineQueue';
import { setTechIdForSensor, startAccelerometer, stopAccelerometer } from './sensorService';
import { supabase } from '../lib/supabase';

const UPDATE_INTERVAL_MS = 2_000;

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

  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy:                         Location.Accuracy.High,
    timeInterval:                     UPDATE_INTERVAL_MS,
    distanceInterval:                 0,
    pausesUpdatesAutomatically:       false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Localizador PositivoS+ Activo',
      notificationBody:  'Rastreando ubicación en segundo plano...',
      notificationColor: '#00D632',
    },
  });
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
