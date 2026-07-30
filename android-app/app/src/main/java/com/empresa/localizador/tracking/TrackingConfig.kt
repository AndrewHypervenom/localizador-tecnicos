package com.empresa.localizador.tracking

import com.google.android.gms.location.Priority

/**
 * Parámetros del rastreo, en un solo sitio.
 *
 * Los valores heredados de la app React Native se mantienen tal cual: están
 * ajustados con meses de campo y cambiarlos alteraría lo que ven los líderes en
 * el mapa y lo que sale en los reportes. Lo que cambia aquí es *cómo* se
 * consiguen, no *qué* se envía.
 */
object TrackingConfig {

    // ── Umbrales de movimiento (idénticos a la versión anterior) ─────────────

    /**
     * Umbral de "detenido". 0,7 m/s (~2,5 km/h) trata como parado solo a quien de
     * verdad no se mueve: caminar (1,1–1,5 m/s) cuenta como movimiento, que es lo
     * que hace útil el rastreo a pie dentro de un sitio.
     */
    const val STATIONARY_SPEED_MS = 0.7

    /** Distancia mínima para subir un punto nuevo yendo lento. */
    const val MIN_MOVE_M = 15.0

    /**
     * Cadencia de subida estando detenido. Debe ser MENOR que el intervalo de
     * captura en reposo, o el jitter de un fix que llega tarde lo descartaría y la
     * cadencia real en el servidor se duplicaría (el líder vería parpadeos).
     */
    const val STATIONARY_UPLOAD_MS = 25_000L

    /** Tiempo sin movimiento antes de bajar de MOVING a STATIONARY. */
    const val STATIONARY_AFTER_MS = 120_000L

    /** Radio de error por encima del cual el fix se descarta (causa de los "saltos"). */
    const val ACCURACY_MAX_M = 50.0

    // ── Ancla anti-deriva ────────────────────────────────────────────────────
    // Con el teléfono quieto el GPS "deriva": los fixes se dispersan decenas de
    // metros, pasan los filtros y el mapa del líder dibuja recorridos que nunca
    // ocurrieron (y la velocidad falsa mantenía el equipo en tier MOVING gastando
    // batería). Al confirmarse detenido se fija un ANCLA y todo fix que caiga
    // dentro del radio se sube con las coordenadas del ancla y velocidad 0.

    const val DRIFT_RADIUS_M = 30.0

    /** Fixes consecutivos fuera del radio que confirman desplazamiento real. */
    const val DRIFT_EXIT_FIXES = 2

    /** Velocidad franca: un solo fix a este ritmo basta para soltar el ancla. */
    const val DRIFT_EXIT_SPEED_MS = 1.2

    /**
     * Caminata lenta dentro del sitio, sin salir del radio: sin esta salida el
     * ancla se "comía" todo el movimiento interno y el líder no veía ningún
     * recorrido del técnico en el sitio.
     */
    const val WALK_EXIT_FIXES = 2

    // ── Envío por lotes ──────────────────────────────────────────────────────

    /** Cada cuánto se drena la cola hacia el servidor. */
    const val BATCH_INTERVAL_MS = 30_000L

    /** O antes, si se acumulan tantos puntos sin enviar. */
    const val BATCH_MAX_PENDING = 25

    /** Tamaño del lote FIFO en cada inserción. */
    const val FLUSH_BATCH = 100

    /** Capacidad de la cola local: cubre jornadas largas sin señal. */
    const val LOC_QUEUE_CAP = 20_000
    const val MOTION_QUEUE_CAP = 2_000
    const val DEAD_LETTER_CAP = 2_000

    /** Backoff exponencial entre reintentos de envío. */
    val BACKOFF_STEPS_MS = longArrayOf(5_000, 10_000, 30_000, 60_000, 120_000, 300_000)

    // ── Latido ───────────────────────────────────────────────────────────────

    const val HEARTBEAT_MIN_INTERVAL_MS = 25_000L

    /**
     * Latido de respaldo por alarma, independiente del GPS y de la interfaz. Es lo
     * que sostiene el estado "app activa — sin señal" en la vista del líder cuando
     * no hay fixes que enviar.
     */
    const val HEARTBEAT_ALARM_INTERVAL_MS = 5 * 60_000L

    // ── Salud del rastreo ────────────────────────────────────────────────────

    /**
     * Sin un fix en este lapso —con sesión activa y GPS encendido— el motor está
     * "vivo pero mudo" y hay que re-suscribirlo. Se calcula sobre el intervalo del
     * tier actual para no reiniciar en falso cuando la captura es lenta a
     * propósito.
     */
    fun staleFixThresholdMs(tier: TrackingTier): Long =
        (tier.intervalMs * 3) + tier.maxDelayMs + 30_000L

    /** Cada cuánto revisa el watchdog por alarma que sigan entrando fixes. */
    const val WATCHDOG_ALARM_INTERVAL_MS = 3 * 60_000L

    /**
     * Hueco mínimo sin fixes para dar por INTERRUMPIDO el rastreo (force-stop,
     * swipe de recientes o muerte por memoria). Por debajo no se reporta, para no
     * generar ruido al reabrir la app a los pocos segundos.
     */
    const val KILLED_GAP_MS = 3 * 60_000L

    // ── Reposo profundo ──────────────────────────────────────────────────────

    /**
     * Tiempo anclado y con el reconocimiento de actividad diciendo "quieto" antes
     * de bajar a captura muy espaciada. El ancla ya sabe dónde está el técnico, así
     * que verificar cada dos minutos basta: el regreso a MOVING no depende del GPS
     * sino de la transición de actividad y del sensor de movimiento significativo,
     * que reaccionan en segundos y no consumen prácticamente nada.
     */
    const val DEEP_IDLE_AFTER_MS = 10 * 60_000L

    // ── Detección de conducción brusca ───────────────────────────────────────

    const val ACCIDENT_THRESHOLD_MS2 = 25.0
    const val HARD_BRAKE_DELTA = 8.0
    const val RAPID_ACCEL_DELTA = 8.0
    const val HARSH_TURN_DEG = 45.0
    const val EVENT_SPEED_MIN_MS = 5.0
    const val MOTION_WINDOW_MS = 3_000L
    const val MOTION_COOLDOWN_MS = 3_000L
    const val SUSTAINED_ACCIDENT_MS = 150L
}

/**
 * Nivel de captura del GPS.
 *
 * La diferencia grande con la versión React Native es que aquí el tier controla
 * solo cada cuánto se pide un fix al chip GNSS. La cadencia de PUNTOS ENVIADOS al
 * servidor es independiente (la marca [TrackingConfig.STATIONARY_UPLOAD_MS]), así
 * que se puede espaciar mucho el GPS estando quieto sin que el líder note ningún
 * cambio en el mapa ni en el historial.
 */
enum class TrackingTier(
    val intervalMs: Long,
    val minIntervalMs: Long,
    /**
     * Margen que se concede al sistema para ENTREGAR los fixes agrupados. Permite
     * que el chip acumule varias posiciones y despierte la CPU una sola vez, que
     * es de donde sale buena parte del ahorro de batería.
     */
    val maxDelayMs: Long,
    val priority: Int,
) {
    /** El técnico se desplaza: máxima densidad de puntos para el recorrido. */
    MOVING(
        intervalMs = 5_000,
        minIntervalMs = 3_000,
        maxDelayMs = 15_000,
        priority = Priority.PRIORITY_HIGH_ACCURACY,
    ),

    /** Lleva un par de minutos parado. Se mantiene alta precisión a propósito:
     *  bajarla haría que el proveedor use red/wifi, que reporta velocidad 0 y
     *  posiciones imprecisas y rompe la velocidad al reanudar la marcha. */
    STATIONARY(
        intervalMs = 30_000,
        minIntervalMs = 20_000,
        maxDelayMs = 60_000,
        priority = Priority.PRIORITY_HIGH_ACCURACY,
    ),

    /** Anclado y confirmado quieto por el reconocimiento de actividad: basta con
     *  verificar la posición de vez en cuando. */
    DEEP_IDLE(
        intervalMs = 120_000,
        minIntervalMs = 60_000,
        maxDelayMs = 180_000,
        priority = Priority.PRIORITY_HIGH_ACCURACY,
    );
}
