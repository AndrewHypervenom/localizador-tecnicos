import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { ensureTrackingHealthy } from './locationService';
import { sendHeartbeat } from './heartbeat';

export const WATCHDOG_TASK = 'TRACKING_WATCHDOG';

/**
 * Watchdog periódico: si había una sesión de rastreo activa (technicianId
 * persistido) pero el servicio de ubicación murió O quedó "iniciado pero mudo"
 * (el SO lo mató, o el técnico apagó/encendió el GPS y Android no lo reanudó),
 * lo revive/re-suscribe. La lógica vive en ensureTrackingHealthy, que mira si
 * realmente ENTRAN fixes, no solo si el task figura como iniciado.
 * Definido a nivel de módulo; index.js importa este archivo para registrarlo.
 */
TaskManager.defineTask(WATCHDOG_TASK, async () => {
  try {
    await ensureTrackingHealthy();
    // Latido de "app viva" AUNQUE el GPS esté apagado o sin fixes: es lo que
    // permite distinguir "app activa sin señal" de "app muerta" en la vista del
    // líder cuando todo lo demás está en silencio. force: el watchdog corre cada
    // ~15 min, muy por encima del throttle del latido.
    await sendHeartbeat({ appState: 'background', force: true });
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
