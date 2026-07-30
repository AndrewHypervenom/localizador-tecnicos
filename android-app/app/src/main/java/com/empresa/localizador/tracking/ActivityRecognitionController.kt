package com.empresa.localizador.tracking

import android.Manifest
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import com.google.android.gms.location.ActivityRecognition
import com.google.android.gms.location.ActivityTransition
import com.google.android.gms.location.ActivityTransitionRequest
import com.google.android.gms.location.ActivityTransitionResult
import com.google.android.gms.location.DetectedActivity

/**
 * Reconocimiento de actividad: la clave del ahorro de batería.
 *
 * El sistema ya sabe —usando los sensores de movimiento, no el GPS— si el
 * teléfono está quieto, andando o en un vehículo. Escuchando esas transiciones,
 * la app puede espaciar muchísimo la captura de GPS mientras el técnico está
 * parado y volver a la captura densa **en segundos** cuando arranca, sin tener
 * que mantener el GNSS encendido solo para enterarse.
 *
 * La versión anterior no tenía nada de esto: deducía el movimiento de la
 * velocidad del propio GPS, lo que obligaba a mantenerlo encendido todo el día.
 */
object ActivityRecognitionController {

    private const val TAG = "ActivityRecognition"
    const val ACTION_TRANSITION = "com.empresa.localizador.ACTIVITY_TRANSITION"

    fun hasPermission(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true
        return ContextCompat.checkSelfPermission(
            context, Manifest.permission.ACTIVITY_RECOGNITION,
        ) == PackageManager.PERMISSION_GRANTED
    }

    private fun pendingIntent(context: Context): PendingIntent {
        val intent = Intent(context, ActivityTransitionReceiver::class.java)
            .setAction(ACTION_TRANSITION)
        return PendingIntent.getBroadcast(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
        )
    }

    private val transitions: List<ActivityTransition> by lazy {
        val kinds = listOf(
            DetectedActivity.STILL,
            DetectedActivity.WALKING,
            DetectedActivity.ON_FOOT,
            DetectedActivity.RUNNING,
            DetectedActivity.ON_BICYCLE,
            DetectedActivity.IN_VEHICLE,
        )
        kinds.flatMap { kind ->
            listOf(
                ActivityTransition.Builder()
                    .setActivityType(kind)
                    .setActivityTransition(ActivityTransition.ACTIVITY_TRANSITION_ENTER)
                    .build(),
                ActivityTransition.Builder()
                    .setActivityType(kind)
                    .setActivityTransition(ActivityTransition.ACTIVITY_TRANSITION_EXIT)
                    .build(),
            )
        }
    }

    @SuppressLint("MissingPermission")
    fun start(context: Context): Boolean {
        if (!hasPermission(context)) {
            // Sin este permiso el rastreo sigue funcionando igual: solo se pierde
            // el ahorro de batería, porque el nivel de captura vuelve a decidirse
            // con la velocidad del GPS, como en la versión anterior.
            Log.i(TAG, "Sin permiso de reconocimiento de actividad; se usa solo el GPS")
            return false
        }
        return try {
            val request = ActivityTransitionRequest(transitions)
            ActivityRecognition.getClient(context)
                .requestActivityTransitionUpdates(request, pendingIntent(context))
            true
        } catch (e: Exception) {
            Log.w(TAG, "No se pudo activar el reconocimiento de actividad: ${e.message}")
            false
        }
    }

    fun stop(context: Context) {
        try {
            ActivityRecognition.getClient(context)
                .removeActivityTransitionUpdates(pendingIntent(context))
        } catch (_: Exception) {
        }
    }
}

/**
 * Recibe las transiciones y se las pasa al servicio. Se declara en el manifiesto
 * porque el sistema lo despierta aunque el proceso esté dormido.
 */
class ActivityTransitionReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (!ActivityTransitionResult.hasResult(intent)) return
        val result = ActivityTransitionResult.extractResult(intent) ?: return

        // Solo interesa la última transición del lote: es el estado actual.
        val last = result.transitionEvents.lastOrNull() ?: return
        val moving = when (last.activityType) {
            DetectedActivity.STILL ->
                last.transitionType == ActivityTransition.ACTIVITY_TRANSITION_EXIT
            DetectedActivity.WALKING,
            DetectedActivity.ON_FOOT,
            DetectedActivity.RUNNING,
            DetectedActivity.ON_BICYCLE,
            DetectedActivity.IN_VEHICLE,
            -> last.transitionType == ActivityTransition.ACTIVITY_TRANSITION_ENTER

            else -> return
        }

        TrackingService.notifyActivityChange(context, moving)
    }
}
