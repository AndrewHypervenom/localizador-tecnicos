package com.empresa.localizador.boot

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.empresa.localizador.data.AppInit
import com.empresa.localizador.data.Prefs
import com.empresa.localizador.device.DeviceAudit
import com.empresa.localizador.device.DeviceState
import com.empresa.localizador.sync.Heartbeat
import com.empresa.localizador.tracking.TrackingService
import com.empresa.localizador.work.Watchdogs
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Reanuda el rastreo tras reiniciar el teléfono o actualizar la app.
 *
 * La versión anterior levantaba aquí un runtime completo de React Native para
 * ejecutar unas pocas líneas de JavaScript: lento, con mucha memoria y con alta
 * probabilidad de que el sistema lo matara en plena tormenta de arranque. Aquí se
 * arranca el servicio nativo directamente.
 */
class BootReceiver : BroadcastReceiver() {

    private companion object {
        const val TAG = "BootReceiver"
        val ACTIONS = setOf(
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_LOCKED_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            "android.intent.action.QUICKBOOT_POWERON",
            "com.htc.intent.action.QUICKBOOT_POWERON",
        )
    }

    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        if (action !in ACTIONS) return

        // El receptor es directBootAware y recibe LOCKED_BOOT_COMPLETED, que llega
        // ANTES del primer desbloqueo. En ese momento el almacenamiento cifrado con
        // credencial —preferencias, cola de posiciones y credenciales de sesión— aún
        // no está montado, y `getSharedPreferences` lanza IllegalStateException.
        // Estaba fuera del try, así que el receptor moría ahí en cada arranque.
        //
        // No se puede reanudar de verdad hasta el desbloqueo (sin cola donde
        // encolar ni credenciales con las que subir), así que se sale limpiamente:
        // el BOOT_COMPLETED que llega justo después del desbloqueo hace el trabajo.
        // Medido: reanuda en el mismo segundo del desbloqueo.
        if (!DeviceState.isUserUnlocked(context)) {
            Log.i(TAG, "Arranque con el usuario aún bloqueado: se reanudará al desbloquear")
            return
        }

        Prefs.init(context)

        val pending = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.Default).launch {
            try {
                // En el primer arranque tras la actualización, la sesión todavía
                // puede estar viniendo de la app anterior: esperar a la herencia
                // antes de decidir que no hay nada que reanudar.
                AppInit.awaitAtMost(5_000)
                if (Prefs.technicianId == null) return@launch

                Prefs.log("arranque", "El teléfono arrancó: se reanuda el rastreo")

                // Dejar constancia de la interrupción ANTES de revivir: el hueco sin
                // posiciones durante el apagado es información para el líder.
                DeviceAudit.auditTrackingKilled(context, serviceRunning = false)

                TrackingService.start(context)
                Watchdogs.scheduleAll(context)
                Heartbeat.send(context, Heartbeat.AppState.BACKGROUND, force = true)
            } catch (e: Exception) {
                Log.e(TAG, "No se pudo reanudar el rastreo: ${e.message}")
            } finally {
                pending.finish()
            }
        }
    }
}

/**
 * Watchdog por alarma.
 *
 * Es la red de seguridad más fiable de todas: al dispararse una alarma, Android
 * concede a la app una ventana temporal fuera de las restricciones de segundo
 * plano, que es justo lo que hace falta para poder volver a levantar un servicio
 * en primer plano cuando el sistema lo mató.
 */
class WatchdogReceiver : BroadcastReceiver() {

    companion object {
        const val ACTION_CHECK = "com.empresa.localizador.WATCHDOG_CHECK"
        private const val TAG = "WatchdogReceiver"
    }

    override fun onReceive(context: Context, intent: Intent?) {
        // Reprogramar SIEMPRE lo primero: si algo más abajo falla, la cadena de
        // vigilancia no se debe romper. No toca preferencias (solo AlarmManager),
        // así que es seguro incluso con el usuario bloqueado.
        Watchdogs.scheduleNextCheck(context)

        // Una alarma puede dispararse con el usuario todavía bloqueado (reinicio de
        // madrugada). Igual que en el arranque, tocar las preferencias ahí lanza
        // IllegalStateException; se pospone, pero la cadena de arriba ya quedó viva.
        if (!DeviceState.isUserUnlocked(context)) {
            Log.i(TAG, "Comprobación con el usuario bloqueado: se pospone")
            return
        }

        Prefs.init(context)

        val pending = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.Default).launch {
            try {
                AppInit.awaitAtMost(5_000)
                if (Prefs.technicianId == null) return@launch

                if (!TrackingService.isRunning) {
                    DeviceAudit.auditTrackingKilled(context, serviceRunning = false)
                    TrackingService.start(context)
                } else {
                    TrackingService.healthCheck(context)
                }

                DeviceAudit.auditGps(context, DeviceState.isGpsEnabled(context))
                DeviceAudit.auditNet(context, DeviceState.isOnline(context))

                // Latido independiente del GPS: aunque no haya ni una posición que
                // enviar, el líder debe seguir viendo que la app está viva.
                Heartbeat.send(context, Heartbeat.AppState.BACKGROUND, force = true)

                if (DeviceState.isOnline(context)) Watchdogs.requestUpload(context)
            } catch (e: Exception) {
                Log.e(TAG, "Fallo en la comprobación: ${e.message}")
            } finally {
                pending.finish()
            }
        }
    }
}
