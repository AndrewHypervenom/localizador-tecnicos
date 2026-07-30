package com.empresa.localizador.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface QueueDao {

    // ── Cola de ubicación ────────────────────────────────────────────────────

    @Insert
    suspend fun insertLocation(row: LocationEntity): Long

    @Insert
    suspend fun insertLocations(rows: List<LocationEntity>)

    /** Lote FIFO: siempre se envían primero los puntos más antiguos. */
    @Query("SELECT * FROM location_queue ORDER BY id ASC LIMIT :limit")
    suspend fun oldestLocations(limit: Int): List<LocationEntity>

    @Query("DELETE FROM location_queue WHERE id IN (:ids)")
    suspend fun deleteLocations(ids: List<Long>)

    @Query("SELECT COUNT(*) FROM location_queue")
    suspend fun countLocations(): Int

    @Query("SELECT COUNT(*) FROM location_queue")
    fun countLocationsFlow(): Flow<Int>

    /**
     * Recorta la cola por capacidad descartando los MÁS ANTIGUOS (FIFO), igual que
     * hacía el `slice(-CAP)` de la versión React Native. Dimensionada para cubrir
     * jornadas largas sin señal.
     */
    @Query(
        "DELETE FROM location_queue WHERE id NOT IN " +
            "(SELECT id FROM location_queue ORDER BY id DESC LIMIT :cap)"
    )
    suspend fun trimLocations(cap: Int)

    // ── Cola de eventos (movimiento / SOS / bitácora) ────────────────────────

    @Insert
    suspend fun insertMotion(row: MotionEntity): Long

    @Insert
    suspend fun insertMotions(rows: List<MotionEntity>)

    @Query("SELECT * FROM motion_queue ORDER BY id ASC LIMIT :limit")
    suspend fun oldestMotions(limit: Int): List<MotionEntity>

    @Query("DELETE FROM motion_queue WHERE id IN (:ids)")
    suspend fun deleteMotions(ids: List<Long>)

    @Query("SELECT COUNT(*) FROM motion_queue")
    suspend fun countMotions(): Int

    @Query(
        "DELETE FROM motion_queue WHERE id NOT IN " +
            "(SELECT id FROM motion_queue ORDER BY id DESC LIMIT :cap)"
    )
    suspend fun trimMotions(cap: Int)

    // ── Apartadas (rechazo permanente del servidor) ──────────────────────────

    @Insert
    suspend fun insertDeadLetter(row: DeadLetterEntity)

    @Query("SELECT COUNT(*) FROM dead_letter")
    suspend fun countDeadLetters(): Int

    @Query(
        "DELETE FROM dead_letter WHERE id NOT IN " +
            "(SELECT id FROM dead_letter ORDER BY id DESC LIMIT :cap)"
    )
    suspend fun trimDeadLetters(cap: Int)
}
