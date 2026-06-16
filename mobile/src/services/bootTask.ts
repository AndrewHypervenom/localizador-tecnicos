import { AppRegistry } from 'react-native';
import { ensureTrackingHealthy } from './locationService';
import { sendHeartbeat } from './heartbeat';
import { registerWatchdog } from './watchdog';

// ── Reanudar el rastreo tras reiniciar el celular ─────────────────────────────
// El BroadcastReceiver nativo (ver plugins/withBootReceiver.js) arranca un
// HeadlessJsTaskService al recibir BOOT_COMPLETED, que ejecuta ESTA tarea sin
// que el técnico abra la app. Si había una sesión activa (technicianId
// persistido), ensureTrackingHealthy() vuelve a arrancar el servicio de
// ubicación (su propio foreground service); si no, no hace nada. Así "nunca
// toca reiniciar el celular": tras un reinicio el rastreo se reanuda solo.
//
// El nombre debe coincidir con el que devuelve BootTaskService.getTaskConfig().
export const BOOT_TASK = 'BOOT_RESUME_TASK';

AppRegistry.registerHeadlessTask(BOOT_TASK, () => async () => {
  try {
    await ensureTrackingHealthy();
    // Reprogramar el watchdog tras el reinicio: si el proceso arranca SOLO en
    // segundo plano (BootReceiver, sin que el técnico abra la app) y la
    // programación de WorkManager se perdió (algunos OEM la borran en force-stop
    // o al reiniciar), HomeScreen nunca llega a llamar registerWatchdog y la app
    // se quedaría sin la red de seguridad que revive el servicio si el SO lo mata.
    // registerTaskAsync es idempotente, así que llamarlo de más no hace daño.
    await registerWatchdog();
    await sendHeartbeat({ appState: 'background', force: true });
  } catch (e: any) {
    console.error('[BootTask]', e?.message);
  }
});
