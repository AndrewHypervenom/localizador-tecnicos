package com.empresa.localizador.work

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import android.util.Log
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.empresa.localizador.boot.WatchdogReceiver
import com.empresa.localizador.data.Prefs
import com.empresa.localizador.tracking.TrackingConfig
import java.util.concurrent.TimeUnit

/**
 * Las redes de seguridad que mantienen vivo el rastreo.
 *
 * El fallo de fondo de la versión anterior era que **el vigilante y el vigilado
 * eran el mismo proceso**: cuando el sistema congelaba el runtime de JavaScript,
 * se caían a la vez las posiciones y el mecanismo que debía repararlas. Aquí hay
 * cuatro mecanismos independientes, y basta con que uno sobreviva:
 *
 *  1. `START_STICKY` — el sistema recrea el servicio si lo mata por memoria.
 *  2. **Alarma repetida** — despierta el proceso incluso en Doze. Al dispararse,
 *     Android concede una ventana temporal en la que SÍ se puede arrancar un
 *     servicio en primer plano desde segundo plano; por eso es la vía más fiable
 *     para resucitar el rastreo.
 *  3. **WorkManager periódico** — sobrevive a reinicios y a que el proceso muera,
 *     y además reintenta los envíos cuando vuelve la red.
 *  4. **Arranque del teléfono** — ver `BootReceiver`.
 */
object Watchdogs {

    private const val TAG = "Watchdogs"

    private const val WORK_GUARDIAN = "guardian"
    private const val WORK_UPLOAD = "upload"

    private const val REQUEST_WATCHDOG = 100
    private const val REQUEST_RESTART = 101

    // ── Alarmas ──────────────────────────────────────────────────────────────

    private fun alarmManager(context: Context): AlarmManager? =
        context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager

    private fun watchdogIntent(context: Context, requestCode: Int): PendingIntent =
        PendingIntent.getBroadcast(
            context,
            requestCode,
            Intent(context, WatchdogReceiver::class.java).setAction(WatchdogReceiver.ACTION_CHECK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    /**
     * ¿Se pueden programar alarmas exactas? Desde Android 12 hace falta permiso
     * explícito. Sin él se usa la variante inexacta, que sigue atravesando Doze
     * pero con menos precisión: el rastreo se repara igual, solo que puede tardar
     * unos minutos más.
     */
    fun canScheduleExact(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
        return alarmManager(context)?.canScheduleExactAlarms() == true
    }

    fun scheduleNextCheck(context: Context, delayMs: Long = TrackingConfig.WATCHDOG_ALARM_INTERVAL_MS) {
        val am = alarmManager(context) ?: return
        val triggerAt = SystemClock.elapsedRealtime() + delayMs
        val pi = watchdogIntent(context, REQUEST_WATCHDOG)
        try {
            if (canScheduleExact(context)) {
                am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi)
            } else {
                am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi)
            }
        } catch (e: Exception) {
            Log.w(TAG, "No se pudo programar la alarma: ${e.message}")
        }
    }

    /** Resurrección inmediata tras un cierre desde Recientes o una muerte del servicio. */
    fun scheduleImmediateRestart(context: Context) {
        val am = alarmManager(context) ?: return
        val triggerAt = SystemClock.elapsedRealtime() + 2_000
        val pi = watchdogIntent(context, REQUEST_RESTART)
        try {
            if (canScheduleExact(context)) {
                am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi)
            } else {
                am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi)
            }
        } catch (e: Exception) {
            Log.w(TAG, "No se pudo programar la resurrección: ${e.message}")
        }
    }

    // ── WorkManager ──────────────────────────────────────────────────────────

    private fun workManager(context: Context): WorkManager? = try {
        WorkManager.getInstance(context)
    } catch (e: Exception) {
        Log.w(TAG, "WorkManager no disponible: ${e.message}")
        null
    }

    fun scheduleAll(context: Context) {
        scheduleNextCheck(context)

        val guardian = PeriodicWorkRequestBuilder<GuardianWorker>(15, TimeUnit.MINUTES)
            .setBackoffCriteria(androidx.work.BackoffPolicy.LINEAR, 1, TimeUnit.MINUTES)
            .build()

        workManager(context)?.enqueueUniquePeriodicWork(
            WORK_GUARDIAN,
            // KEEP: no reiniciar el contador cada vez que se llama (esto se invoca
            // en cada arranque del servicio y reemplazarlo retrasaría la ejecución
            // indefinidamente).
            ExistingPeriodicWorkPolicy.KEEP,
            guardian,
        )
    }

    /**
     * Envío diferido con espera de red. Es la vía que recupera la cola cuando el
     * técnico vuelve a tener cobertura sin necesidad de que abra la app.
     */
    fun requestUpload(context: Context) {
        val request = OneTimeWorkRequestBuilder<UploadWorker>()
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build()
            )
            .setBackoffCriteria(androidx.work.BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        workManager(context)?.enqueueUniqueWork(WORK_UPLOAD, ExistingWorkPolicy.REPLACE, request)
    }

    fun cancelAll(context: Context) {
        try {
            alarmManager(context)?.cancel(watchdogIntent(context, REQUEST_WATCHDOG))
            alarmManager(context)?.cancel(watchdogIntent(context, REQUEST_RESTART))
        } catch (_: Exception) {
        }
        workManager(context)?.cancelUniqueWork(WORK_GUARDIAN)
        Prefs.log("watchdog", "Vigilancia desactivada (sesión cerrada)")
    }
}
