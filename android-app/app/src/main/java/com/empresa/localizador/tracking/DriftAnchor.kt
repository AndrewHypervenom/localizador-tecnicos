package com.empresa.localizador.tracking

import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/** Distancia en metros entre dos coordenadas. */
fun haversineM(aLat: Double, aLng: Double, bLat: Double, bLng: Double): Double {
    val r = 6_371_000.0
    val dLat = Math.toRadians(bLat - aLat)
    val dLng = Math.toRadians(bLng - aLng)
    val s = sin(dLat / 2) * sin(dLat / 2) +
        cos(Math.toRadians(aLat)) * cos(Math.toRadians(bLat)) * sin(dLng / 2) * sin(dLng / 2)
    return 2 * r * asin(sqrt(s.coerceIn(0.0, 1.0)))
}

/**
 * Ancla anti-deriva.
 *
 * Con el teléfono quieto los fixes se dispersan alrededor del punto real; pasan
 * el filtro de precisión y el umbral de distancia, y el mapa del líder acaba
 * dibujando recorridos que nunca ocurrieron (con velocidades falsas que además
 * mantenían el equipo en captura rápida gastando batería).
 *
 * Al confirmarse detenido se fija un ANCLA: mientras los fixes caigan dentro del
 * radio se suben con las coordenadas del ancla y velocidad 0 —punto fijo en el
 * mapa, cero distancia fantasma en los reportes—. El ancla solo se suelta con
 * movimiento real: velocidad franca, caminata sostenida, o varios fixes seguidos
 * fuera del radio.
 *
 * Lógica portada tal cual de la versión React Native, que ya estaba afinada en
 * campo.
 */
class DriftAnchor {

    private data class Point(val lat: Double, val lng: Double)

    private var anchor: Point? = null
    private var driftExitCount = 0
    private var walkExitCount = 0

    val isAnchored: Boolean get() = anchor != null

    fun anchorAt(lat: Double, lng: Double) {
        anchor = Point(lat, lng)
        driftExitCount = 0
        walkExitCount = 0
    }

    fun release() {
        anchor = null
        driftExitCount = 0
        walkExitCount = 0
    }

    /**
     * Coordenadas y velocidad con las que debe subirse este fix.
     *
     * @param snapped true si el punto se pegó al ancla; en ese caso la precisión
     *   del fix original deja de ser relevante (y no debe reportarse, o el
     *   historial descartaría el punto por impreciso y el técnico quieto
     *   "desaparecería" del recorrido).
     * @param released true si este fix confirmó movimiento real y soltó el ancla.
     */
    data class Result(
        val lat: Double,
        val lng: Double,
        val speed: Double?,
        val effectiveSpeedMs: Double,
        val snapped: Boolean,
        val released: Boolean,
    )

    fun apply(
        lat: Double,
        lng: Double,
        validSpeed: Double?,
        speedMs: Double,
        accuracy: Double?,
    ): Result {
        val a = anchor ?: return Result(lat, lng, validSpeed, speedMs, snapped = false, released = false)

        // Solo los fixes CONFIABLES cuentan como evidencia de movimiento: bajo
        // techo la precisión se degrada a 60-100 m y esa dispersión soltaría el
        // ancla con posiciones basura.
        val trustedFix = accuracy == null || accuracy <= TrackingConfig.ACCURACY_MAX_M
        val driftDist = haversineM(a.lat, a.lng, lat, lng)

        if (trustedFix) {
            driftExitCount = if (driftDist >= TrackingConfig.DRIFT_RADIUS_M) driftExitCount + 1 else 0
            walkExitCount = if (speedMs > TrackingConfig.STATIONARY_SPEED_MS) walkExitCount + 1 else 0
        }

        val realMove = trustedFix && (
            speedMs > TrackingConfig.DRIFT_EXIT_SPEED_MS ||
                walkExitCount >= TrackingConfig.WALK_EXIT_FIXES ||
                driftExitCount >= TrackingConfig.DRIFT_EXIT_FIXES
            )

        return if (realMove) {
            release()
            Result(lat, lng, validSpeed, speedMs, snapped = false, released = true)
        } else {
            Result(a.lat, a.lng, 0.0, 0.0, snapped = true, released = false)
        }
    }

    /** Coordenadas del ancla, para emitir puntos en reposo sin encender el GPS. */
    fun anchorLatLng(): Pair<Double, Double>? = anchor?.let { it.lat to it.lng }
}
