package com.empresa.localizador.tracking

import android.content.Context
import com.empresa.localizador.data.Prefs
import com.empresa.localizador.device.DeviceAudit
import com.empresa.localizador.device.DeviceState
import com.empresa.localizador.device.EventReporter
import com.empresa.localizador.device.OemGuides
import com.empresa.localizador.net.SupabaseClient
import com.empresa.localizador.sync.Heartbeat
import com.empresa.localizador.work.Watchdogs
import java.util.TimeZone

/**
 * Operaciones de sesión: arrancar y detener el rastreo.
 *
 * La convención se hereda de la versión anterior y de ella dependen la auditoría
 * y el latido: **hay sesión activa si —y solo si— hay un técnico guardado**.
 */
object TrackingManager {

    val isSessionActive: Boolean get() = Prefs.technicianId != null

    /**
     * Inicia el rastreo. Solo debe llamarse desde una acción explícita del técnico
     * o desde el auto-arranque con permisos ya concedidos.
     *
     * @param explicit true si viene del botón INICIAR. Solo entonces se registra el
     *   evento `tracking_start`, para que la línea de tiempo del líder distinga
     *   "el técnico la activó" de "el sistema la revivió".
     */
    suspend fun startSession(context: Context, technicianId: String, explicit: Boolean) {
        Prefs.technicianId = technicianId

        // Sembrar el estado con la foto actual para que la auditoría no dispare un
        // falso "apagó el GPS" ni un falso "revocó el permiso" al primer muestreo.
        DeviceAudit.seed(
            gpsOn = DeviceState.isGpsEnabled(context),
            connected = DeviceState.isOnline(context),
            perm = DeviceState.permLevel(context),
            batteryOptimized = if (OemGuides.isXiaomi) null else DeviceState.isBatteryOptimized(context),
        )

        TrackingService.clearMockFlag()
        TrackingService.start(context)
        Watchdogs.scheduleAll(context)

        if (explicit) {
            EventReporter.reportDeviceEvent(context, technicianId, EventReporter.DeviceEvent.TRACKING_START)
        }

        // La zona horaria del teléfono decide cómo se agrupan las jornadas en los
        // reportes del líder.
        runCatching { SupabaseClient.updateTimezone(technicianId, TimeZone.getDefault().id) }

        Heartbeat.send(context, Heartbeat.AppState.FOREGROUND, force = true)
        Prefs.log("sesión", if (explicit) "El técnico inició la localización" else "Rastreo reanudado")
    }

    /**
     * Detiene el rastreo por decisión del técnico. El evento se registra ANTES de
     * cerrar la sesión, para que viaje con el envío final que hace el servicio.
     */
    suspend fun stopSession(context: Context) {
        val technicianId = Prefs.technicianId
        if (technicianId != null) {
            EventReporter.reportDeviceEvent(context, technicianId, EventReporter.DeviceEvent.TRACKING_STOP)
        }
        // El servicio hace un envío forzado antes de soltarse; por eso se detiene
        // ANTES de borrar el técnico (si no, no sabría a quién pertenecen los
        // puntos que quedan en la cola).
        TrackingService.stop(context)
        Watchdogs.cancelAll(context)
        Prefs.clearSession()
        Prefs.log("sesión", "El técnico detuvo la localización")
    }

    /** Arranque silencioso al abrir la app si la sesión seguía viva. */
    fun resumeIfNeeded(context: Context) {
        if (!isSessionActive) return
        if (DeviceState.permLevel(context) == com.empresa.localizador.device.PermLevel.NONE) return
        TrackingService.start(context)
        Watchdogs.scheduleAll(context)
    }
}
