import * as BackgroundTask from 'expo-background-task';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { LOCATION_TASK } from './locationTask';
import { startTracking } from './locationService';
import { loadTechnicianId } from './offlineQueue';

export const WATCHDOG_TASK = 'TRACKING_WATCHDOG';

/**
 * Watchdog periódico: si había una sesión de rastreo activa (technicianId
 * persistido) pero el servicio de ubicación murió (el SO lo mató), lo reinicia.
 * Definido a nivel de módulo; index.js importa este archivo para registrarlo.
 */
TaskManager.defineTask(WATCHDOG_TASK, async () => {
  try {
    const technicianId = await loadTechnicianId();
    if (!technicianId) return BackgroundTask.BackgroundTaskResult.Success;

    const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
    if (!running) await startTracking(technicianId);
  } catch (e: any) {
    console.error('[Watchdog]', e?.message);
  }
  return BackgroundTask.BackgroundTaskResult.Success;
});

/** Registra el watchdog (intervalo mínimo en minutos; el SO decide el real). */
export async function registerWatchdog(): Promise<void> {
  try {
    await BackgroundTask.registerTaskAsync(WATCHDOG_TASK, { minimumInterval: 15 });
  } catch (e: any) {
    console.warn('[Watchdog] no se pudo registrar:', e?.message);
  }
}
