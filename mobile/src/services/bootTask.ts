import { AppRegistry } from 'react-native';
import { ensureTrackingHealthy } from './locationService';
import { sendHeartbeat } from './heartbeat';

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
    await sendHeartbeat({ appState: 'background', force: true });
  } catch (e: any) {
    console.error('[BootTask]', e?.message);
  }
});
