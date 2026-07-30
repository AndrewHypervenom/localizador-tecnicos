package com.empresa.localizador.device

import android.content.Context
import com.empresa.localizador.data.Prefs
import com.empresa.localizador.device.EventReporter.DeviceEvent
import com.empresa.localizador.tracking.TrackingConfig
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.ConcurrentHashMap

/**
 * Auditoría de dispositivo: deja evidencia con hora y última posición conocida de
 * las acciones que rompen el rastreo.
 *
 * Detecta TRANSICIONES comparando contra el último estado persistido. Como el
 * estado vive en disco, funciona igual desde la interfaz que desde el servicio o
 * un watchdog con la app cerrada: apagar el GPS o los datos "a escondidas"
 * también deja huella.
 *
 * Reglas comunes:
 *  - Solo se emite si hay sesión de rastreo activa.
 *  - El primer muestreo (estado previo desconocido) solo SIEMBRA, no dispara
 *    evento: abrir la app no debe parecer un sabotaje.
 *  - El estado nuevo se persiste siempre, haya sesión o no, para tener continuidad.
 */
object DeviceAudit {

    private val mutexes = ConcurrentHashMap<String, Mutex>()

    /**
     * Serializa cada auditoría por clave. Sin esto, dos comprobaciones
     * concurrentes de lo mismo (la interfaz sondeando y el servicio a la vez)
     * pueden leer ambas el estado anterior antes de que ninguna guarde el nuevo,
     * detectar las dos la transición y emitir el evento DOS veces.
     */
    private suspend fun <T> locked(key: String, block: suspend () -> T): T =
        mutexes.getOrPut(key) { Mutex() }.withLock { block() }

    fun seed(gpsOn: Boolean? = null, connected: Boolean? = null, perm: PermLevel? = null, batteryOptimized: Boolean? = null) {
        gpsOn?.let { Prefs.gpsState = it }
        connected?.let { Prefs.netState = it }
        perm?.let { Prefs.permState = it.wire }
        batteryOptimized?.let { Prefs.battOptState = it }
    }

    suspend fun auditGps(context: Context, servicesOn: Boolean): DeviceEvent? = locked("gps") {
        val prev = Prefs.gpsState
        Prefs.gpsState = servicesOn
        if (prev == null || prev == servicesOn) return@locked null
        val techId = Prefs.technicianId ?: return@locked null
        val event = if (servicesOn) DeviceEvent.GPS_ON else DeviceEvent.GPS_OFF
        EventReporter.reportDeviceEvent(context, techId, event)
        event
    }

    suspend fun auditNet(context: Context, connected: Boolean): DeviceEvent? = locked("net") {
        val prev = Prefs.netState
        Prefs.netState = connected
        if (prev == null || prev == connected) return@locked null
        val techId = Prefs.technicianId ?: return@locked null
        val event = if (connected) DeviceEvent.NET_ON else DeviceEvent.NET_OFF
        EventReporter.reportDeviceEvent(context, techId, event)
        event
    }

    /**
     * `optimized = true` significa que el sistema volvió a restringir la app: el
     * truco clásico para que el SO mate el servicio.
     */
    suspend fun auditBatteryOpt(context: Context, optimized: Boolean): DeviceEvent? = locked("battopt") {
        val prev = Prefs.battOptState
        Prefs.battOptState = optimized
        if (prev == null || prev == optimized) return@locked null
        val techId = Prefs.technicianId ?: return@locked null
        val event = if (optimized) DeviceEvent.BATTERY_RESTRICTED else DeviceEvent.BATTERY_UNRESTRICTED
        EventReporter.reportDeviceEvent(context, techId, event)
        event
    }

    /**
     * Solo importa la transición FUNCIONAL: perder o recuperar "Permitir siempre",
     * que es lo que habilita el rastreo en segundo plano. Bajarlo a "solo en uso"
     * sin apagar el GPS es la forma silenciosa de romper el rastreo aparentando
     * que "la app no sirve". Los cambios entre parcial y denegado no se reportan:
     * en ambos casos ya no había rastreo de fondo.
     */
    suspend fun auditPermission(context: Context, level: PermLevel): DeviceEvent? = locked("perm") {
        val prev = PermLevel.fromWire(Prefs.permState)
        Prefs.permState = level.wire
        if (prev == null || prev == level) return@locked null
        val techId = Prefs.technicianId ?: return@locked null
        val wasFull = prev == PermLevel.FULL
        val isFull = level == PermLevel.FULL
        when {
            wasFull && !isFull -> {
                EventReporter.reportDeviceEvent(context, techId, DeviceEvent.PERM_REVOKED)
                DeviceEvent.PERM_REVOKED
            }
            !wasFull && isFull -> {
                EventReporter.reportDeviceEvent(context, techId, DeviceEvent.PERM_GRANTED)
                DeviceEvent.PERM_GRANTED
            }
            else -> null
        }
    }

    /**
     * Detecta que una sesión activa se quedó sin servicio corriendo (force-stop,
     * swipe de recientes o muerte por memoria) con un hueco real sin fixes. Se
     * llama al arrancar, ANTES de revivir el rastreo.
     *
     * @return true si registró la interrupción.
     */
    suspend fun auditTrackingKilled(context: Context, serviceRunning: Boolean): Boolean {
        if (serviceRunning) return false
        val techId = Prefs.technicianId ?: return false      // no había sesión
        val lastFix = Prefs.lastFixTs.takeIf { it > 0L } ?: return false  // nunca entregó
        if (System.currentTimeMillis() - lastFix < TrackingConfig.KILLED_GAP_MS) return false
        EventReporter.reportDeviceEvent(context, techId, DeviceEvent.TRACKING_KILLED)
        Prefs.log("watchdog", "El rastreo se había interrumpido; se reanuda")
        return true
    }
}
