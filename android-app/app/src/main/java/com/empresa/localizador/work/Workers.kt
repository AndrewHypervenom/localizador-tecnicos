package com.empresa.localizador.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.empresa.localizador.data.AppInit
import com.empresa.localizador.data.Prefs
import com.empresa.localizador.device.DeviceAudit
import com.empresa.localizador.device.DeviceState
import com.empresa.localizador.sync.Heartbeat
import com.empresa.localizador.sync.Uploader
import com.empresa.localizador.tracking.TrackingService

/**
 * Vigilante periódico de respaldo.
 *
 * Corre cada ~15 minutos aunque el proceso haya muerto y aunque el teléfono se
 * haya reiniciado. Hace tres cosas, y las tres importan por separado:
 *
 *  1. **Late.** Aunque no haya ni GPS ni puntos que enviar, deja constancia en el
 *     servidor de que la app sigue viva. Es lo que mantiene al técnico en amarillo
 *     ("app activa — sin señal") en vez de en rojo ("desconectado") en la vista del
 *     líder, y lo que refuta el "la app no sirve".
 *  2. **Revive el rastreo** si la sesión seguía abierta pero el servicio no está.
 *  3. **Drena la cola** pendiente.
 */
class GuardianWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        AppInit.awaitAtMost(10_000)
        Prefs.technicianId ?: return Result.success()   // sin sesión: nada que vigilar

        // Evidencia si el rastreo se había interrumpido de verdad.
        DeviceAudit.auditTrackingKilled(applicationContext, TrackingService.isRunning)

        if (!TrackingService.isRunning) {
            TrackingService.start(applicationContext)
        } else {
            TrackingService.healthCheck(applicationContext)
        }

        // Auditar el estado del teléfono desde segundo plano: apagar el GPS, los
        // datos o el permiso con la app cerrada también debe dejar huella.
        DeviceAudit.auditGps(applicationContext, DeviceState.isGpsEnabled(applicationContext))
        DeviceAudit.auditNet(applicationContext, DeviceState.isOnline(applicationContext))
        DeviceAudit.auditPermission(applicationContext, DeviceState.permLevel(applicationContext))

        if (DeviceState.isOnline(applicationContext)) {
            runCatching { Uploader.flush(applicationContext) }
        }

        // force: el vigilante corre muy espaciado, siempre debe dejar su latido.
        Heartbeat.send(applicationContext, Heartbeat.AppState.BACKGROUND, force = true)

        // Re-armar la alarma: algunos fabricantes las borran al matar el proceso.
        Watchdogs.scheduleNextCheck(applicationContext)

        return Result.success()
    }
}

/**
 * Envío de la cola en cuanto haya red. WorkManager lo mantiene en espera hasta
 * que vuelve la cobertura, así que la cola se recupera sola sin que el técnico
 * tenga que abrir la app.
 */
class UploadWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        AppInit.awaitAtMost(10_000)
        if (Prefs.technicianId == null) return Result.success()

        val result = runCatching { Uploader.flush(applicationContext) }.getOrElse {
            return Result.retry()
        }

        Heartbeat.send(applicationContext, Heartbeat.AppState.BACKGROUND, force = true)

        // Si quedó cola por un fallo transitorio, reintentar con el backoff de
        // WorkManager en lugar de darlo por bueno.
        return if (result.remaining > 0 && result.error != null) Result.retry() else Result.success()
    }
}
