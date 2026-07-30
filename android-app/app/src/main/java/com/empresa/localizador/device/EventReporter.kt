package com.empresa.localizador.device

import android.content.Context
import com.empresa.localizador.data.Prefs
import com.empresa.localizador.data.db.AppDatabase
import com.empresa.localizador.data.db.MotionEntity
import com.empresa.localizador.net.ApiResult
import com.empresa.localizador.net.MotionPayload
import com.empresa.localizador.net.SupabaseClient
import com.empresa.localizador.tracking.TrackingConfig
import com.empresa.localizador.util.toIsoInstant
import com.empresa.localizador.util.toWktPoint
import java.util.concurrent.ConcurrentHashMap

/**
 * Bitácora de dispositivo, SOS y eventos de conducción.
 *
 * Todos acaban en la misma tabla `motion_events` del servidor, que es lo que el
 * líder ve en Alertas y en la hoja "Bitácora de dispositivo" de los reportes.
 */
object EventReporter {

    /** Acciones que sabotean el rastreo, o hitos que conviene poder demostrar. */
    enum class DeviceEvent(val wire: String) {
        GPS_OFF("gps_off"),
        GPS_ON("gps_on"),
        MOCK_ON("mock_on"),
        MOCK_OFF("mock_off"),
        TRACKING_START("tracking_start"),
        TRACKING_STOP("tracking_stop"),
        NET_OFF("net_off"),
        NET_ON("net_on"),
        BATTERY_RESTRICTED("battery_restricted"),
        BATTERY_UNRESTRICTED("battery_unrestricted"),
        TRACKING_KILLED("tracking_killed"),
        PERM_REVOKED("perm_revoked"),
        PERM_GRANTED("perm_granted"),
    }

    private val lastEventTs = ConcurrentHashMap<String, Long>()

    /**
     * Registra un evento de bitácora. Siempre pasa por la cola: así queda
     * garantizado que sobrevive a un corte de red, y el orden respecto a los
     * puntos de ubicación se mantiene.
     */
    suspend fun reportDeviceEvent(context: Context, technicianId: String, event: DeviceEvent) {
        if (technicianId.isBlank()) return
        enqueue(context, technicianId, event.wire, 0.0)
        Prefs.log("evento", event.wire)
    }

    /**
     * SOS del técnico. Salta cualquier cooldown e intenta enviarse de inmediato
     * para que el líder lo vea al instante; si no hay red, queda en cola.
     *
     * @return true si salió ya, false si quedó encolado.
     */
    suspend fun reportSos(context: Context, technicianId: String): Boolean {
        val location = lastKnownWkt(context)
        val payload = MotionPayload(
            technicianId = technicianId,
            ts = System.currentTimeMillis().toIsoInstant(),
            eventType = "sos",
            severity = 100.0,
            location = location,
        )
        val sent = SupabaseClient.insertMotions(listOf(payload)) is ApiResult.Ok
        if (!sent) {
            enqueueRaw(context, technicianId, "sos", 100.0, location)
        }
        Prefs.log("SOS", if (sent) "enviado al líder" else "sin red: encolado")
        return sent
    }

    /**
     * Evento de conducción brusca. Respeta un tiempo de gracia por tipo para no
     * inundar al líder con una ráfaga del mismo suceso.
     */
    suspend fun reportMotion(
        context: Context,
        technicianId: String,
        type: String,
        severity: Double,
    ) {
        if (technicianId.isBlank()) return
        val now = System.currentTimeMillis()
        val last = lastEventTs[type] ?: 0L
        if (now - last < TrackingConfig.MOTION_COOLDOWN_MS) return
        lastEventTs[type] = now
        enqueue(context, technicianId, type, severity)
    }

    private suspend fun enqueue(
        context: Context,
        technicianId: String,
        type: String,
        severity: Double,
    ) {
        val last = lastKnownLatLng(context)
        val dao = AppDatabase.get(context).queueDao()
        dao.insertMotion(
            MotionEntity(
                technicianId = technicianId,
                tsMillis = System.currentTimeMillis(),
                eventType = type,
                severity = severity,
                lat = last?.second,
                lng = last?.first,
            )
        )
        dao.trimMotions(TrackingConfig.MOTION_QUEUE_CAP)
    }

    private suspend fun enqueueRaw(
        context: Context,
        technicianId: String,
        type: String,
        severity: Double,
        wkt: String?,
    ) {
        val parsed = wkt?.let { parseWkt(it) }
        val dao = AppDatabase.get(context).queueDao()
        dao.insertMotion(
            MotionEntity(
                technicianId = technicianId,
                tsMillis = System.currentTimeMillis(),
                eventType = type,
                severity = severity,
                lat = parsed?.second,
                lng = parsed?.first,
            )
        )
        dao.trimMotions(TrackingConfig.MOTION_QUEUE_CAP)
    }

    /**
     * Última posición conocida SIN encender el GPS. Aunque el técnico haya
     * apagado la ubicación, el último fix sirve de evidencia de dónde estaba.
     */
    private fun lastKnownLatLng(context: Context): Pair<Double, Double>? {
        return try {
            val lm = context.getSystemService(Context.LOCATION_SERVICE)
                as? android.location.LocationManager ?: return null
            if (DeviceState.permLevel(context) == PermLevel.NONE) return null
            val providers = listOf(
                android.location.LocationManager.GPS_PROVIDER,
                android.location.LocationManager.NETWORK_PROVIDER,
                android.location.LocationManager.PASSIVE_PROVIDER,
            )
            val best = providers.mapNotNull {
                try {
                    lm.getLastKnownLocation(it)
                } catch (_: SecurityException) {
                    null
                } catch (_: Exception) {
                    null
                }
            }.maxByOrNull { it.time } ?: return null
            best.longitude to best.latitude
        } catch (_: Exception) {
            null
        }
    }

    private fun lastKnownWkt(context: Context): String? =
        lastKnownLatLng(context)?.let { (lng, lat) -> toWktPoint(lng, lat) }

    private val POINT_RE = Regex("""POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)""")

    private fun parseWkt(wkt: String): Pair<Double, Double>? {
        val m = POINT_RE.find(wkt) ?: return null
        val lng = m.groupValues[1].toDoubleOrNull() ?: return null
        val lat = m.groupValues[2].toDoubleOrNull() ?: return null
        return lng to lat
    }
}
