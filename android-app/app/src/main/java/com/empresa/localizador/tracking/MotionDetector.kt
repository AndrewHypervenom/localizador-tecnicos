package com.empresa.localizador.tracking

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.hardware.TriggerEvent
import android.hardware.TriggerEventListener
import android.os.SystemClock
import kotlin.math.abs
import kotlin.math.sqrt

/**
 * Detección de conducción brusca y de accidentes.
 *
 * Dos fuentes, con los mismos umbrales que la versión anterior:
 *  - El acelerómetro, para el impacto (solo mientras hay desplazamiento: parado no
 *    hay choque que detectar y el sensor a 10 lecturas por segundo consume todo el
 *    día para nada).
 *  - La propia serie de posiciones, para frenadas, acelerones y giros.
 */
class MotionDetector(
    private val context: Context,
    private val onEvent: (type: String, severity: Double) -> Unit,
) {

    private val sensorManager: SensorManager? =
        context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager

    private var accelerometerActive = false
    private var highGStartMs = 0L

    private val accelerometerListener = object : SensorEventListener {
        override fun onSensorChanged(event: SensorEvent) {
            val x = event.values[0]
            val y = event.values[1]
            val z = event.values[2]
            // Magnitud neta quitando la gravedad.
            val rawMag = sqrt((x * x + y * y + z * z).toDouble())
            val netMag = (rawMag - SensorManager.GRAVITY_EARTH).coerceAtLeast(0.0)
            val now = SystemClock.elapsedRealtime()

            if (netMag > TrackingConfig.ACCIDENT_THRESHOLD_MS2) {
                // Un pico aislado es el teléfono cayéndose al suelo o un bache.
                // Solo cuenta como accidente si se SOSTIENE.
                if (highGStartMs == 0L) {
                    highGStartMs = now
                } else if (now - highGStartMs >= TrackingConfig.SUSTAINED_ACCIDENT_MS) {
                    onEvent("accident", netMag)
                    highGStartMs = 0L
                }
            } else {
                highGStartMs = 0L
            }
        }

        override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
    }

    fun startAccelerometer() {
        if (accelerometerActive) return
        val sensor = sensorManager?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) ?: return
        sensorManager.registerListener(
            accelerometerListener,
            sensor,
            100_000, // 100 ms, igual que antes
        )
        accelerometerActive = true
    }

    fun stopAccelerometer() {
        if (!accelerometerActive) return
        sensorManager?.unregisterListener(accelerometerListener)
        accelerometerActive = false
        highGStartMs = 0L
    }

    // ── Movimiento significativo ─────────────────────────────────────────────
    // Sensor de hardware que dispara UNA vez cuando el teléfono se desplaza de
    // verdad. Consumo prácticamente nulo (lo resuelve el coprocesador de
    // movimiento) y es la red de seguridad para salir del reposo profundo en
    // equipos sin servicios de Google.

    private var significantMotionArmed = false
    private var onSignificantMotion: (() -> Unit)? = null

    private val triggerListener = object : TriggerEventListener() {
        override fun onTrigger(event: TriggerEvent?) {
            significantMotionArmed = false   // es de un solo disparo: hay que re-armarlo
            onSignificantMotion?.invoke()
        }
    }

    fun armSignificantMotion(callback: () -> Unit) {
        if (significantMotionArmed) return
        val sensor = sensorManager?.getDefaultSensor(Sensor.TYPE_SIGNIFICANT_MOTION) ?: return
        onSignificantMotion = callback
        significantMotionArmed = sensorManager.requestTriggerSensor(triggerListener, sensor)
    }

    fun disarmSignificantMotion() {
        if (!significantMotionArmed) return
        val sensor = sensorManager?.getDefaultSensor(Sensor.TYPE_SIGNIFICANT_MOTION)
        if (sensor != null) sensorManager?.cancelTriggerSensor(triggerListener, sensor)
        significantMotionArmed = false
    }

    // ── Análisis de la serie de posiciones ───────────────────────────────────

    private var lastSpeedMs = 0.0
    private var lastSpeedAt = 0L
    private var lastBearingDeg = 0.0
    private var lastBearingAt = 0L

    /**
     * @param elapsedMs reloj monótono del fix. Se usa a propósito en vez de la hora
     *   del sistema: así ni un cambio de hora ni la entrega agrupada de posiciones
     *   inventan frenadas que no ocurrieron.
     */
    fun onGpsSample(speedMs: Double, bearingDeg: Double, elapsedMs: Long) {
        if (lastSpeedAt > 0 && elapsedMs - lastSpeedAt <= TrackingConfig.MOTION_WINDOW_MS) {
            val brakeDelta = lastSpeedMs - speedMs
            if (brakeDelta >= TrackingConfig.HARD_BRAKE_DELTA &&
                lastSpeedMs > TrackingConfig.EVENT_SPEED_MIN_MS
            ) {
                onEvent("hard_brake", brakeDelta)
            }
            val accelDelta = speedMs - lastSpeedMs
            if (accelDelta >= TrackingConfig.RAPID_ACCEL_DELTA) {
                onEvent("rapid_accel", accelDelta)
            }
        }

        if (lastBearingAt > 0 &&
            speedMs > TrackingConfig.EVENT_SPEED_MIN_MS &&
            elapsedMs - lastBearingAt <= 2_000
        ) {
            var delta = abs(bearingDeg - lastBearingDeg)
            if (delta > 180) delta = 360 - delta
            if (delta >= TrackingConfig.HARSH_TURN_DEG) {
                onEvent("harsh_turn", delta)
            }
        }

        lastSpeedMs = speedMs
        lastSpeedAt = elapsedMs
        lastBearingDeg = bearingDeg
        lastBearingAt = elapsedMs
    }

    fun release() {
        stopAccelerometer()
        disarmSignificantMotion()
    }
}
