import * as Battery from 'expo-battery';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { ensureAuth, supabase } from '../lib/supabase';
import {
  enqueueLocation,
  flushLocationQueue,
  flushMotionQueue,
  loadTechnicianId,
  storeLastError,
  storeLastSent,
  clearLastError,
  type LocationRow,
} from './offlineQueue';
import { detectMotionFromGPS, setTechIdForSensor } from './sensorService';

export const LOCATION_TASK = 'BACKGROUND_LOCATION_TASK';

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

    detectMotionFromGPS(speed ?? 0, heading ?? 0);

    let batteryLevel: number | null = null;
    try {
      const level = await Battery.getBatteryLevelAsync();
      if (level >= 0) batteryLevel = Math.round(level * 100);
    } catch { /* not critical */ }

    const row: LocationRow = {
      technician_id: technicianId,
      ts:            new Date(loc.timestamp).toISOString(),
      location:      `POINT(${longitude} ${latitude})`,
      speed:         speed ?? null,
      altitude:      altitude ?? null,
      bearing:       heading ?? null,
      accuracy:      accuracy ?? null,
      battery_level: batteryLevel,
    };

    try {
      await ensureAuth();
      await flushLocationQueue();
      await flushMotionQueue();
      const { error: err } = await supabase.from('location_events').insert(row);
      if (err) throw new Error(err.message);
      await storeLastSent();
      await clearLastError();
    } catch (e: any) {
      const msg = e?.message ?? 'Error desconocido';
      console.error('[LocationTask] fallo al enviar:', msg);
      await storeLastError(msg);
      await enqueueLocation(row);
    }
  }
);
