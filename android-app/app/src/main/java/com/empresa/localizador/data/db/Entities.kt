package com.empresa.localizador.data.db

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Punto de ubicación pendiente de enviar.
 *
 * En la app React Native la cola era un array JSON completo en AsyncStorage: cada
 * punto obligaba a leer, parsear y reescribir hasta 1,5 MB, y una escritura
 * interrumpida se llevaba la cola entera. Aquí cada punto es un INSERT
 * transaccional en SQLite: microsegundos, sin reescribir nada y a prueba de
 * cortes de corriente.
 */
@Entity(tableName = "location_queue", indices = [Index("id")])
data class LocationEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val technicianId: String,
    /** Momento del fix (del propio GPS, no del reloj de proceso). */
    val tsMillis: Long,
    val lat: Double,
    val lng: Double,
    val speed: Double?,
    val altitude: Double?,
    val bearing: Double?,
    val accuracy: Double?,
    val batteryLevel: Int?,
    val charging: Boolean?,
)

/**
 * Evento de conducción (frenada, acelerón, giro brusco, accidente), SOS o entrada
 * de bitácora de dispositivo (gps_off, net_off, perm_revoked…). Todos viajan a la
 * misma tabla `motion_events` del servidor.
 */
@Entity(tableName = "motion_queue", indices = [Index("id")])
data class MotionEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val technicianId: String,
    val tsMillis: Long,
    val eventType: String,
    val severity: Double,
    /** Última posición conocida como evidencia; puede faltar. */
    val lat: Double?,
    val lng: Double?,
)

/**
 * Fila que el servidor rechazó de forma PERMANENTE (p.ej. `ts` fuera de una
 * partición existente, geometría inválida). Se aparta en vez de reintentarla para
 * siempre —que atascaría la cola— pero no se pierde: queda aquí para diagnóstico.
 */
@Entity(tableName = "dead_letter")
data class DeadLetterEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    /** "location" | "motion" */
    val kind: String,
    val payload: String,
    val error: String,
    val tsMillis: Long = System.currentTimeMillis(),
)
