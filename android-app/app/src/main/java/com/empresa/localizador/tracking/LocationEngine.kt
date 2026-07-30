package com.empresa.localizador.tracking

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.GnssStatus
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationAvailability
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices

/**
 * Motor de ubicación.
 *
 * Corrige el fallo estructural de la versión anterior: allí, cambiar de nivel de
 * captura obligaba a un stop + start del request nativo, y cada cambio abría una
 * ventana sin escucha en la que —en varios equipos— el re-arranque fallaba en
 * silencio y el servicio quedaba "iniciado pero mudo". De ahí venía el
 * "se les desconecta solo el GPS".
 *
 * Aquí se registra SIEMPRE el mismo objeto callback: pedir actualizaciones de
 * nuevo con otro [LocationRequest] **sustituye** la petición anterior de forma
 * atómica, sin hueco. El stop+start completo queda reservado para la reparación
 * explícita ([restart]), no para la operación normal.
 *
 * Además hay dos proveedores: el fusionado de Google (mejor precisión y consumo)
 * y, si el equipo no trae servicios de Google —Huawei y buena parte del mercado
 * gris—, el [LocationManager] del sistema.
 */
class LocationEngine(
    private val context: Context,
    private val onLocations: (List<Location>) -> Unit,
    private val onAvailability: (Boolean) -> Unit,
) {

    private companion object {
        const val TAG = "LocationEngine"
    }

    private val hasGms: Boolean by lazy {
        try {
            GoogleApiAvailability.getInstance()
                .isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS
        } catch (_: Throwable) {
            false
        }
    }

    /** Qué proveedor está sosteniendo el rastreo (para el diagnóstico). */
    val providerName: String get() = if (hasGms) "Google (fusionado)" else "GPS del sistema"

    private val fused: FusedLocationProviderClient? by lazy {
        if (hasGms) LocationServices.getFusedLocationProviderClient(context) else null
    }

    private val locationManager: LocationManager? by lazy {
        context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
    }

    @Volatile
    var currentTier: TrackingTier = TrackingTier.MOVING
        private set

    @Volatile
    var isRunning: Boolean = false
        private set

    /** Satélites usados en el último fix: distingue "sin cielo" de "motor muerto". */
    @Volatile
    var satellitesUsed: Int = -1
        private set

    // ── Callbacks ────────────────────────────────────────────────────────────

    private val fusedCallback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            val locations = result.locations.filterNotNull()
            if (locations.isNotEmpty()) onLocations(locations)
        }

        override fun onLocationAvailability(availability: LocationAvailability) {
            onAvailability(availability.isLocationAvailable)
        }
    }

    private val legacyListener = object : LocationListener {
        override fun onLocationChanged(location: Location) = onLocations(listOf(location))

        @Deprecated("Requerido por la interfaz en API < 29")
        override fun onStatusChanged(provider: String?, status: Int, extras: android.os.Bundle?) = Unit

        override fun onProviderEnabled(provider: String) = onAvailability(true)
        override fun onProviderDisabled(provider: String) = onAvailability(false)
    }

    private val gnssCallback = object : GnssStatus.Callback() {
        override fun onSatelliteStatusChanged(status: GnssStatus) {
            var used = 0
            for (i in 0 until status.satelliteCount) if (status.usedInFix(i)) used++
            satellitesUsed = used
        }

        override fun onStopped() {
            satellitesUsed = -1
        }
    }

    private var gnssRegistered = false

    // ── Control ──────────────────────────────────────────────────────────────

    fun hasPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    fun isGpsEnabled(): Boolean = try {
        locationManager?.isProviderEnabled(LocationManager.GPS_PROVIDER) == true ||
            locationManager?.isProviderEnabled(LocationManager.NETWORK_PROVIDER) == true
    } catch (_: Exception) {
        false
    }

    private fun buildRequest(tier: TrackingTier): LocationRequest =
        LocationRequest.Builder(tier.priority, tier.intervalMs)
            .setMinUpdateIntervalMillis(tier.minIntervalMs)
            // Agrupar entregas: el chip acumula posiciones y despierta la CPU una
            // sola vez en lugar de una por fix. Es una de las palancas grandes de
            // ahorro de batería, y no retrasa nada visible porque el envío al
            // servidor ya va por lotes.
            .setMaxUpdateDelayMillis(tier.maxDelayMs)
            .setWaitForAccurateLocation(false)
            .build()

    /**
     * Arranca o **reconfigura** la captura. Reutilizar el mismo callback hace que
     * el cambio de nivel no deje ningún hueco sin escucha.
     */
    @SuppressLint("MissingPermission")
    fun apply(tier: TrackingTier): Boolean {
        if (!hasPermission()) {
            Log.w(TAG, "Sin permiso de ubicación: no se puede capturar")
            return false
        }
        return try {
            if (hasGms) {
                fused?.requestLocationUpdates(buildRequest(tier), fusedCallback, Looper.getMainLooper())
            } else {
                locationManager?.removeUpdates(legacyListener)
                val provider = when {
                    locationManager?.isProviderEnabled(LocationManager.GPS_PROVIDER) == true ->
                        LocationManager.GPS_PROVIDER
                    locationManager?.isProviderEnabled(LocationManager.NETWORK_PROVIDER) == true ->
                        LocationManager.NETWORK_PROVIDER
                    else -> null
                }
                if (provider == null) return false
                locationManager?.requestLocationUpdates(
                    provider,
                    tier.intervalMs,
                    0f,
                    legacyListener,
                    Looper.getMainLooper(),
                )
            }
            registerGnss()
            currentTier = tier
            isRunning = true
            true
        } catch (e: SecurityException) {
            Log.w(TAG, "Permiso retirado en caliente: ${e.message}")
            isRunning = false
            false
        } catch (e: Exception) {
            Log.e(TAG, "No se pudo aplicar el nivel de captura: ${e.message}")
            false
        }
    }

    /**
     * Reparación fuerte: suelta la petición y vuelve a crearla desde cero. Es lo
     * único que reengancha un motor que quedó registrado pero mudo (caso típico
     * tras apagar y encender la ubicación del teléfono).
     */
    fun restart(tier: TrackingTier): Boolean {
        stopUpdates()
        return apply(tier)
    }

    private fun stopUpdates() {
        try {
            if (hasGms) fused?.removeLocationUpdates(fusedCallback)
            else locationManager?.removeUpdates(legacyListener)
        } catch (e: Exception) {
            Log.w(TAG, "Al detener la captura: ${e.message}")
        }
        isRunning = false
    }

    fun stop() {
        stopUpdates()
        unregisterGnss()
        satellitesUsed = -1
    }

    @SuppressLint("MissingPermission")
    private fun registerGnss() {
        if (gnssRegistered || !hasPermission()) return
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                locationManager?.registerGnssStatusCallback(gnssCallback, null)
                gnssRegistered = true
            }
        } catch (_: Exception) {
            // Diagnóstico opcional: su ausencia no afecta al rastreo.
        }
    }

    private fun unregisterGnss() {
        if (!gnssRegistered) return
        try {
            locationManager?.unregisterGnssStatusCallback(gnssCallback)
        } catch (_: Exception) {
        }
        gnssRegistered = false
    }

    /**
     * Última posición conocida sin encender el GPS. Sirve de evidencia para los
     * eventos de bitácora y el SOS: aunque el técnico haya apagado la ubicación,
     * deja constancia de DÓNDE estaba.
     */
    @SuppressLint("MissingPermission")
    fun lastKnown(): Location? {
        if (!hasPermission()) return null
        val lm = locationManager ?: return null
        return try {
            val providers = listOf(
                LocationManager.GPS_PROVIDER,
                LocationManager.NETWORK_PROVIDER,
                LocationManager.PASSIVE_PROVIDER,
            )
            providers.mapNotNull { p ->
                try {
                    lm.getLastKnownLocation(p)
                } catch (_: Exception) {
                    null
                }
            }.maxByOrNull { it.time }
        } catch (_: Exception) {
            null
        }
    }
}

/**
 * ¿Este fix viene de una app de ubicación simulada?
 *
 * Android marca los fixes falsos; la API cambió en el 12, así que hay que mirar
 * las dos. Es el detector de "Fake GPS".
 */
val Location.isMocked: Boolean
    get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) isMock else {
        @Suppress("DEPRECATION")
        isFromMockProvider
    }
