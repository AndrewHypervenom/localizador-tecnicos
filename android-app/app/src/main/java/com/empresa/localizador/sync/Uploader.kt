package com.empresa.localizador.sync

import android.content.Context
import com.empresa.localizador.data.Prefs
import com.empresa.localizador.data.db.AppDatabase
import com.empresa.localizador.data.db.DeadLetterEntity
import com.empresa.localizador.data.db.LocationEntity
import com.empresa.localizador.data.db.MotionEntity
import com.empresa.localizador.data.db.QueueDao
import com.empresa.localizador.device.DeviceState
import com.empresa.localizador.net.ApiResult
import com.empresa.localizador.net.LocationPayload
import com.empresa.localizador.net.MotionPayload
import com.empresa.localizador.net.SupabaseClient
import com.empresa.localizador.tracking.TrackingConfig
import com.empresa.localizador.util.toIsoInstant
import com.empresa.localizador.util.toWktPoint
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Drenado de las colas hacia el servidor.
 *
 * Reglas heredadas de la versión anterior, que son las que evitan perder datos:
 *  - FIFO estricto: primero los puntos más antiguos.
 *  - Solo se borra de la cola lo que el servidor CONFIRMA.
 *  - Un fallo transitorio (red, servidor ocupado) conserva todo y espera con
 *    backoff exponencial.
 *  - Un fallo permanente se reintenta fila por fila: las buenas pasan y la fila
 *    "veneno" se aparta a una tabla separada, de modo que la cola nunca queda
 *    bloqueada para siempre por un registro irrecuperable.
 */
object Uploader {

    /**
     * Un solo drenado a la vez. Sin esto, el servicio y un worker pueden leer el
     * mismo lote y enviarlo dos veces: el líder vería puntos duplicados.
     */
    private val mutex = Mutex()

    data class Result(
        val sent: Int,
        val remaining: Int,
        val error: String? = null,
    )

    /**
     * @param force ignora la ventana de backoff y la comprobación de red (lo usa
     *   el botón de sincronización manual y el cierre de sesión: el usuario pidió
     *   enviar AHORA).
     */
    suspend fun flush(context: Context, force: Boolean = false): Result = mutex.withLock {
        val dao = AppDatabase.get(context).queueDao()

        if (!force) {
            if (!canRetryNow()) {
                return@withLock Result(0, dao.countLocations(), "En espera del próximo reintento")
            }
            if (!DeviceState.isOnline(context)) {
                return@withLock Result(0, dao.countLocations(), "Sin conexión")
            }
        } else {
            Prefs.clearBackoff()
        }

        var sent = 0
        var error: String? = null

        // Ubicación: con backoff y diagnóstico visible para el técnico.
        val locResult = drainLocations(context, dao)
        sent += locResult.first
        error = locResult.second

        // Eventos: sin backoff propio; si la ubicación falló, este intento
        // probablemente también, pero conviene intentarlo porque una alerta (SOS,
        // sabotaje) importa más que un punto de recorrido.
        val motionResult = drainMotions(context, dao)
        sent += motionResult.first
        if (error == null) error = motionResult.second

        val remaining = dao.countLocations() + dao.countMotions()
        if (error == null && remaining == 0) {
            Prefs.clearBackoff()
            Prefs.clearLastError()
            Prefs.lastSentTs = System.currentTimeMillis()
        } else if (error == null && sent > 0) {
            Prefs.lastSentTs = System.currentTimeMillis()
        }

        Result(sent, remaining, error)
    }

    // ── Cola de ubicación ────────────────────────────────────────────────────

    private suspend fun drainLocations(context: Context, dao: QueueDao): Pair<Int, String?> {
        var sent = 0
        while (true) {
            val batch = dao.oldestLocations(TrackingConfig.FLUSH_BATCH)
            if (batch.isEmpty()) return sent to null

            when (val r = SupabaseClient.insertLocations(batch.map { it.toPayload() })) {
                is ApiResult.Ok -> {
                    dao.deleteLocations(batch.map { it.id })
                    sent += batch.size
                }

                is ApiResult.Fail -> {
                    if (r.transient) {
                        bumpBackoff()
                        Prefs.setLastError(r.message)
                        return sent to r.message
                    }
                    // Hay al menos una fila irrecuperable en el lote: separarlas.
                    val (ok, err) = drainLocationsOneByOne(dao, batch)
                    sent += ok
                    if (err != null) return sent to err
                }
            }
        }
    }

    private suspend fun drainLocationsOneByOne(
        dao: QueueDao,
        batch: List<LocationEntity>,
    ): Pair<Int, String?> {
        var sent = 0
        for (row in batch) {
            when (val r = SupabaseClient.insertLocations(listOf(row.toPayload()))) {
                is ApiResult.Ok -> {
                    dao.deleteLocations(listOf(row.id))
                    sent++
                }

                is ApiResult.Fail -> {
                    if (r.transient) {
                        bumpBackoff()
                        Prefs.setLastError(r.message)
                        return sent to r.message
                    }
                    dao.insertDeadLetter(
                        DeadLetterEntity(
                            kind = "location",
                            payload = row.toString(),
                            error = r.message,
                        )
                    )
                    dao.trimDeadLetters(TrackingConfig.DEAD_LETTER_CAP)
                    dao.deleteLocations(listOf(row.id))
                    Prefs.setLastError("Registro apartado (rechazado por el servidor): ${r.message}")
                    Prefs.log("envío", "Punto apartado por rechazo permanente: ${r.message}")
                }
            }
        }
        return sent to null
    }

    // ── Cola de eventos ──────────────────────────────────────────────────────

    private suspend fun drainMotions(context: Context, dao: QueueDao): Pair<Int, String?> {
        var sent = 0
        while (true) {
            val batch = dao.oldestMotions(TrackingConfig.FLUSH_BATCH)
            if (batch.isEmpty()) return sent to null

            when (val r = SupabaseClient.insertMotions(batch.map { it.toPayload() })) {
                is ApiResult.Ok -> {
                    dao.deleteMotions(batch.map { it.id })
                    sent += batch.size
                }

                is ApiResult.Fail -> {
                    if (r.transient) return sent to r.message
                    for (row in batch) {
                        when (val one = SupabaseClient.insertMotions(listOf(row.toPayload()))) {
                            is ApiResult.Ok -> {
                                dao.deleteMotions(listOf(row.id))
                                sent++
                            }

                            is ApiResult.Fail -> {
                                if (one.transient) return sent to one.message
                                dao.insertDeadLetter(
                                    DeadLetterEntity(
                                        kind = "motion",
                                        payload = row.toString(),
                                        error = one.message,
                                    )
                                )
                                dao.trimDeadLetters(TrackingConfig.DEAD_LETTER_CAP)
                                dao.deleteMotions(listOf(row.id))
                            }
                        }
                    }
                }
            }
        }
    }

    // ── Backoff ──────────────────────────────────────────────────────────────

    private fun canRetryNow(): Boolean {
        val at = Prefs.nextRetryAt
        return at == 0L || System.currentTimeMillis() >= at
    }

    private fun bumpBackoff() {
        val step = (Prefs.backoffStep + 1)
            .coerceAtMost(TrackingConfig.BACKOFF_STEPS_MS.size - 1)
        Prefs.backoffStep = step
        Prefs.nextRetryAt = System.currentTimeMillis() + TrackingConfig.BACKOFF_STEPS_MS[step]
    }

    // ── Conversión a la forma que espera PostgREST ───────────────────────────

    private fun LocationEntity.toPayload() = LocationPayload(
        technicianId = technicianId,
        ts = tsMillis.toIsoInstant(),
        location = toWktPoint(lng, lat),
        speed = speed,
        altitude = altitude,
        bearing = bearing,
        accuracy = accuracy,
        batteryLevel = batteryLevel,
        charging = charging,
    )

    private fun MotionEntity.toPayload() = MotionPayload(
        technicianId = technicianId,
        ts = tsMillis.toIsoInstant(),
        eventType = eventType,
        severity = severity,
        location = if (lat != null && lng != null) toWktPoint(lng, lat) else null,
    )
}
