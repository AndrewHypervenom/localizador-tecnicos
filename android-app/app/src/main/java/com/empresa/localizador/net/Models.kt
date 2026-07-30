package com.empresa.localizador.net

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Fila de `location_events`. Los nombres coinciden exactamente con las columnas
 * de PostgREST, y `location` viaja como WKT (`POINT(lng lat)`) igual que en la
 * versión React Native: PostGIS lo convierte a geometría al insertar.
 */
@Serializable
data class LocationPayload(
    @SerialName("technician_id") val technicianId: String,
    val ts: String,
    val location: String,
    val speed: Double?,
    val altitude: Double?,
    val bearing: Double?,
    val accuracy: Double?,
    @SerialName("battery_level") val batteryLevel: Int?,
    val charging: Boolean?,
)

/** Fila de `motion_events`: conducción brusca, SOS y bitácora de dispositivo. */
@Serializable
data class MotionPayload(
    @SerialName("technician_id") val technicianId: String,
    val ts: String,
    @SerialName("event_type") val eventType: String,
    val severity: Double,
    val location: String?,
)

/**
 * Fila única por técnico en `technician_heartbeat`: la prueba de "la app sigue
 * viva" independiente del GPS. Es lo que permite al líder distinguir
 * "app activa sin señal" (amarillo) de "desconectado de verdad" (rojo).
 */
@Serializable
data class HeartbeatPayload(
    @SerialName("technician_id") val technicianId: String,
    @SerialName("last_heartbeat") val lastHeartbeat: String,
    @SerialName("gps_on") val gpsOn: Boolean?,
    @SerialName("net_on") val netOn: Boolean?,
    val perm: String?,
    val battery: Int?,
    val charging: Boolean?,
    @SerialName("last_fix_age_s") val lastFixAgeS: Int?,
    @SerialName("tracking_tier") val trackingTier: String?,
    @SerialName("app_version") val appVersion: String?,
    @SerialName("app_state") val appState: String?,
    @SerialName("updated_at") val updatedAt: String,
)

/** Respuesta de `GET /technicians?device_id=eq.X&select=id,name`. */
@Serializable
data class TechnicianRow(
    val id: String,
    val name: String,
)

/** Resultado de la RPC `register_device` (registro por QR). */
data class RegisterResult(
    val success: Boolean,
    val name: String?,
    val error: String?,
)

/**
 * Resultado de una llamada a la API, con la distinción que de verdad importa
 * para una cola offline: ¿el fallo es TRANSITORIO (reintentar sin perder nada) o
 * PERMANENTE (la fila es irrecuperable y hay que apartarla para no atascar la
 * cola para siempre)?
 */
sealed interface ApiResult<out T> {
    data class Ok<T>(val value: T) : ApiResult<T>

    data class Fail(
        val transient: Boolean,
        val message: String,
        val code: String? = null,
        val status: Int = 0,
    ) : ApiResult<Nothing>
}
