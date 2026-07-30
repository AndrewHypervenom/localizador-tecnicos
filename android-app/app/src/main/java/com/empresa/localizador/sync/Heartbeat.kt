package com.empresa.localizador.sync

import android.content.Context
import com.empresa.localizador.BuildConfig
import com.empresa.localizador.data.Prefs
import com.empresa.localizador.device.DeviceState
import com.empresa.localizador.net.ApiResult
import com.empresa.localizador.net.HeartbeatPayload
import com.empresa.localizador.net.SupabaseClient
import com.empresa.localizador.tracking.TrackingConfig
import com.empresa.localizador.util.toIsoInstant

/**
 * Latido de "la app sigue viva", independiente del GPS.
 *
 * Es la pieza que responde a la queja original: **el líder deja de ver al
 * técnico**. Con el latido, la vista del líder distingue
 *   - "app activa sin señal GPS" (latido fresco, sin puntos) → amarillo, y
 *   - "desconectado de verdad" (sin latido) → rojo,
 * y queda prueba en el servidor, minuto a minuto, de que la app estaba
 * trabajando, con el GPS, la red, el permiso y la batería como contexto.
 *
 * En la versión anterior el latido dependía del runtime de JavaScript: si el
 * sistema congelaba el proceso, dejaba de latir justo cuando más falta hacía.
 * Aquí se emite desde cuatro sitios nativos e independientes: el servicio, la
 * alarma periódica, el worker de respaldo y el arranque tras reinicio.
 */
object Heartbeat {

    @Volatile
    private var lastSentAt = 0L

    enum class AppState(val wire: String) {
        FOREGROUND("foreground"),
        BACKGROUND("background"),
    }

    /**
     * @param force salta el intervalo mínimo. Lo usan la alarma y el worker, que
     *   corren muy espaciados y siempre deben dejar constancia.
     */
    suspend fun send(context: Context, appState: AppState, force: Boolean = false): Boolean {
        val technicianId = Prefs.technicianId ?: return false  // sin sesión, nada que reportar

        val now = System.currentTimeMillis()
        if (!force && now - lastSentAt < TrackingConfig.HEARTBEAT_MIN_INTERVAL_MS) return false
        lastSentAt = now

        // Todas las lecturas son best-effort: ningún fallo debe impedir el latido,
        // porque el latido en sí ya es la información importante.
        val lastFixAgeS = Prefs.lastFixTs.takeIf { it > 0L }?.let { ((now - it) / 1000).toInt() }

        val payload = HeartbeatPayload(
            technicianId = technicianId,
            lastHeartbeat = now.toIsoInstant(),
            gpsOn = runCatching { DeviceState.isGpsEnabled(context) }.getOrNull(),
            netOn = runCatching { DeviceState.isOnline(context) }.getOrNull(),
            perm = runCatching { DeviceState.permLevel(context).wire }.getOrNull(),
            battery = runCatching { DeviceState.batteryLevel(context) }.getOrNull(),
            charging = runCatching { DeviceState.isCharging(context) }.getOrNull(),
            lastFixAgeS = lastFixAgeS,
            trackingTier = Prefs.tier,
            appVersion = BuildConfig.VERSION_NAME,
            appState = appState.wire,
            updatedAt = now.toIsoInstant(),
        )

        return when (SupabaseClient.upsertHeartbeat(payload)) {
            is ApiResult.Ok -> true
            is ApiResult.Fail -> {
                // Sin red: reabrir la ventana para reintentar en el próximo tick.
                // El latido es ESTADO, no historial: no se encola, se pisa.
                lastSentAt = 0L
                false
            }
        }
    }
}
