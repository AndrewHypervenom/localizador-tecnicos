package com.empresa.localizador.tracking

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import androidx.core.app.ServiceCompat
import com.empresa.localizador.data.Prefs
import com.empresa.localizador.data.db.AppDatabase
import com.empresa.localizador.data.db.LocationEntity
import com.empresa.localizador.device.DeviceAudit
import com.empresa.localizador.device.DeviceState
import com.empresa.localizador.device.EventReporter
import com.empresa.localizador.sync.Heartbeat
import com.empresa.localizador.sync.Uploader
import com.empresa.localizador.work.Watchdogs
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Servicio de rastreo: el que sostiene todo.
 *
 * Diferencias de fondo con la versión React Native, que son las que resuelven el
 * "se desconecta solo y el líder deja de verlo":
 *
 *  1. **Nada depende de un runtime de JavaScript.** Antes, si el sistema
 *     congelaba el proceso de JS, se caían a la vez las posiciones, la cola, el
 *     latido y el propio vigilante. Aquí todo es nativo y cada pieza sobrevive por
 *     separado.
 *  2. **Cambiar el nivel de captura ya no reinicia la escucha**, que era la causa
 *     del estado "iniciado pero mudo" (ver [LocationEngine]).
 *  3. **Estando quieto no hace falta el GPS para seguir reportando**: el ancla ya
 *     sabe dónde está el técnico, así que los puntos en reposo se emiten con un
 *     temporizador y el GNSS solo se enciende de vez en cuando a verificar. El
 *     líder ve exactamente la misma cadencia de siempre con una fracción del gasto.
 *  4. **Si el servicio muere, se vuelve a levantar solo** desde cuatro sitios
 *     distintos (ver [Watchdogs]).
 */
class TrackingService : Service() {

    companion object {
        private const val TAG = "TrackingService"

        const val ACTION_START = "com.empresa.localizador.START"
        const val ACTION_STOP = "com.empresa.localizador.STOP"
        const val ACTION_FLUSH = "com.empresa.localizador.FLUSH"
        const val ACTION_HEALTH = "com.empresa.localizador.HEALTH"
        const val ACTION_ACTIVITY = "com.empresa.localizador.ACTIVITY"
        private const val EXTRA_MOVING = "moving"

        /** Visible para la interfaz y los watchdogs sin tener que enlazar el servicio. */
        @Volatile
        var isRunning: Boolean = false
            private set

        /** ¿Se está detectando ubicación falsa ahora mismo? */
        @Volatile
        var mockDetected: Boolean = false
            private set

        @Volatile
        var lastAvailability: Boolean = true
            private set

        @Volatile
        var satellitesUsed: Int = -1
            private set

        fun start(context: Context) = send(context, ACTION_START)
        fun stop(context: Context) = send(context, ACTION_STOP)
        fun requestFlush(context: Context) = send(context, ACTION_FLUSH)
        fun healthCheck(context: Context) = send(context, ACTION_HEALTH)

        fun notifyActivityChange(context: Context, moving: Boolean) {
            val intent = Intent(context, TrackingService::class.java)
                .setAction(ACTION_ACTIVITY)
                .putExtra(EXTRA_MOVING, moving)
            deliver(context, intent)
        }

        private fun send(context: Context, action: String) {
            deliver(context, Intent(context, TrackingService::class.java).setAction(action))
        }

        private fun deliver(context: Context, intent: Intent) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            } catch (e: Exception) {
                // Android 12+ prohíbe arrancar servicios en primer plano desde
                // segundo plano fuera de ciertas ventanas. No es fatal: los
                // watchdogs lo reintentan cuando el sistema lo permite.
                Log.w(TAG, "No se pudo entregar ${intent.action}: ${e.message}")
            }
        }

        fun clearMockFlag() {
            mockDetected = false
        }

        /**
         * Última vez que se dejó constancia de un rechazo del sistema. Vive en el
         * companion a propósito: cada reintento construye un objeto Service nuevo,
         * así que un campo de instancia no recordaría nada y la bitácora se
         * llenaría igual.
         */
        @Volatile
        private var lastRejectLogElapsed = 0L

        private const val REJECT_LOG_INTERVAL_MS = 30 * 60_000L

        /**
         * Cuánto tiene que durar un corte de cobertura para merecer una línea en la
         * bitácora. Por debajo es el parpadeo normal de `isLocationAvailable` en
         * interiores, que no impide que sigan llegando posiciones.
         */
        private const val CORTE_COBERTURA_MIN_MS = 5 * 60_000L
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val processMutex = Mutex()

    private lateinit var engine: LocationEngine
    private lateinit var motionDetector: MotionDetector
    private val anchor = DriftAnchor()

    private var idleTickerJob: Job? = null
    private var notificationJob: Job? = null

    /** Relojes monótonos: inmunes a que el técnico cambie la hora del teléfono. */
    private var lastMovingElapsed = SystemClock.elapsedRealtime()
    private var lastFlushElapsed = 0L
    private var anchoredSinceElapsed = 0L

    /** Fixes seguidos con velocidad de marcha; ver [TrackingConfig.MOVING_CONFIRM_FIXES]. */
    private var movingFixCount = 0

    /**
     * El sistema rechazó pasar a primer plano. Distingue "me han matado y debo
     * revivir" de "no me dejan arrancar", que son cosas opuestas: la primera pide
     * reintento inmediato y la segunda, esperar.
     */
    private var foregroundRejected = false

    @Volatile
    private var activityStill = false

    /**
     * Desde cuándo el sistema dice que no puede entregar ubicaciones (reloj
     * monótono), o 0 si ahora mismo sí puede. Junto con
     * [cortePorCoberturaRegistrado] convierte el parpadeo del callback de Google
     * en, como mucho, una línea por corte real. Ver [CORTE_COBERTURA_MIN_MS].
     */
    @Volatile
    private var sinCoberturaDesde = 0L

    @Volatile
    private var cortePorCoberturaRegistrado = false

    private var notificationStatus = "Iniciando…"

    // ── Ciclo de vida ────────────────────────────────────────────────────────

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        Notifications.createChannels(this)

        // `lastAvailability` es estática y sobrevive a la recreación del servicio.
        lastAvailability = true
        sinCoberturaDesde = 0L
        cortePorCoberturaRegistrado = false

        engine = LocationEngine(
            context = this,
            onLocations = { locations -> scope.launch { onLocations(locations) } },
            onAvailability = { available ->
                // AQUÍ NO SE REGISTRA NADA. Solo se anota desde cuándo dura el
                // corte; quien decide si merece una línea es `ensureHealthy`.
                //
                // `isLocationAvailable` de Google no "se pone en false": PARPADEA.
                // Medido sobre este mismo servicio en interior, alterna false/true
                // cada ~20 s de forma indefinida mientras el proveedor fusionado
                // sigue entregando posiciones con normalidad (fix_age = 0).
                //
                // Registrar cada callback llenaba la bitácora: 113 de 120 entradas
                // (94 %) eran esa sola línea, y con LOG_CAP = 120 el historial no
                // llegaba a cubrir dos horas. En un teléfono mudo desde hace días
                // —que es justo cuando se abre el diagnóstico— el motivo real ya
                // había sido desalojado por el ruido.
                //
                // Registrar solo las TRANSICIONES tampoco vale, y se comprobó
                // midiendo: como la señal oscila, salen DOS líneas por ciclo y el
                // ritmo subió de 1,13 a 5 por minuto. Lo único que informa es un
                // corte que PERSISTE, así que es lo único que se escribe.
                lastAvailability = available
                if (available) {
                    if (cortePorCoberturaRegistrado) {
                        Prefs.log("gps", "El sistema vuelve a entregar ubicaciones")
                    }
                    sinCoberturaDesde = 0L
                    cortePorCoberturaRegistrado = false
                } else if (sinCoberturaDesde == 0L) {
                    sinCoberturaDesde = SystemClock.elapsedRealtime()
                }
            },
        )

        motionDetector = MotionDetector(this) { type, severity ->
            scope.launch {
                val techId = Prefs.technicianId ?: return@launch
                EventReporter.reportMotion(this@TrackingService, techId, type, severity)
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Lo primero, SIEMPRE: Android exige la notificación en los primeros
        // segundos o mata el proceso con una excepción.
        if (!promoteToForeground()) {
            // Que el sistema RECHACE el servicio (permiso de ubicación retirado)
            // no se arregla reintentando: hay que esperar a que el técnico lo
            // vuelva a conceder. Se marca para que onDestroy NO programe la
            // resurrección inmediata, o se entraría en un bucle de reinicio cada
            // 2 segundos que vacía la batería y, peor, inunda la bitácora de
            // diagnóstico hasta borrar el historial que sirve para saber qué pasó.
            // El watchdog periódico (3 min) ya reintenta al ritmo correcto.
            foregroundRejected = true
            stopSelf()
            return START_NOT_STICKY
        }
        foregroundRejected = false

        when (intent?.action) {
            ACTION_STOP -> {
                scope.launch { shutdown() }
                return START_NOT_STICKY
            }

            ACTION_FLUSH -> scope.launch { flushNow(force = true) }

            ACTION_HEALTH -> scope.launch { ensureHealthy() }

            ACTION_ACTIVITY -> {
                val moving = intent.getBooleanExtra(EXTRA_MOVING, false)
                scope.launch { onActivityChange(moving) }
            }

            else -> scope.launch { beginTracking() }
        }

        // START_STICKY: si el sistema mata el proceso por memoria, lo vuelve a
        // crear en cuanto puede. Es la primera de las cuatro redes de seguridad.
        return START_STICKY
    }

    /**
     * Si el técnico quita la app de recientes, Android destruye el servicio. Se
     * programa una resurrección inmediata: quitar la app de recientes no es una
     * orden de dejar de trabajar (para eso está el botón DETENER).
     */
    override fun onTaskRemoved(rootIntent: Intent?) {
        if (Prefs.technicianId != null) {
            Prefs.log("servicio", "La app se cerró desde Recientes; el rastreo se reanuda solo")
            Watchdogs.scheduleImmediateRestart(this)
        }
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        isRunning = false
        idleTickerJob?.cancel()
        notificationJob?.cancel()
        runCatching { engine.stop() }
        runCatching { motionDetector.release() }
        // Si la sesión seguía activa, esto fue una muerte no deseada: re-armar.
        // Salvo que el sistema nos haya RECHAZADO el arranque, en cuyo caso
        // reintentar a los 2 s solo produce un bucle (ver onStartCommand).
        if (Prefs.technicianId != null && !foregroundRejected) {
            Watchdogs.scheduleImmediateRestart(this)
        }
        scope.cancel()
        super.onDestroy()
    }

    private fun promoteToForeground(): Boolean = try {
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
        } else {
            0
        }
        ServiceCompat.startForeground(
            this,
            Notifications.ID_TRACKING,
            Notifications.trackingNotification(this, notificationStatus),
            type,
        )
        true
    } catch (e: Exception) {
        // Ocurre si el permiso de ubicación fue retirado: Android 14+ rechaza un
        // servicio de tipo "location" sin permiso.
        Log.e(TAG, "No se pudo pasar a primer plano: ${e.message}")
        // Una sola entrada cada media hora: el watchdog reintenta cada 3 minutos y
        // sin este freno un permiso retirado durante una jornada barría el anillo
        // de la bitácora, que es justo la prueba que hace falta para explicar por
        // qué el técnico dejó de verse.
        val nowElapsed = SystemClock.elapsedRealtime()
        if (nowElapsed - lastRejectLogElapsed >= REJECT_LOG_INTERVAL_MS || lastRejectLogElapsed == 0L) {
            lastRejectLogElapsed = nowElapsed
            Prefs.log("servicio", "El sistema rechazó el servicio de ubicación: ${e.message}")
        }
        false
    }

    // ── Arranque y parada ────────────────────────────────────────────────────

    private suspend fun beginTracking() {
        val technicianId = Prefs.technicianId
        if (technicianId == null) {
            // Sin sesión no hay nada que rastrear (p.ej. un watchdog disparó tarde).
            shutdown()
            return
        }

        if (isRunning && engine.isRunning) {
            ensureHealthy()
            return
        }

        // Sembrar el estado para que la auditoría no dispare un falso "apagó el
        // GPS" ni un falso "revocó el permiso" en el primer muestreo.
        DeviceAudit.seed(
            gpsOn = DeviceState.isGpsEnabled(this),
            connected = DeviceState.isOnline(this),
            perm = DeviceState.permLevel(this),
        )

        val started = engine.apply(TrackingTier.MOVING)
        if (!started) {
            updateNotification("Sin permiso de ubicación")
            Prefs.log("servicio", "No se pudo iniciar la captura: falta permiso o proveedor")
            return
        }

        isRunning = true
        Prefs.tier = TrackingTier.MOVING.name
        lastMovingElapsed = SystemClock.elapsedRealtime()
        motionDetector.startAccelerometer()
        ActivityRecognitionController.start(this)
        Watchdogs.scheduleAll(this)
        startNotificationLoop()
        Prefs.log("servicio", "Rastreo iniciado (${engine.providerName})")

        scope.launch { Heartbeat.send(this@TrackingService, Heartbeat.AppState.BACKGROUND, force = true) }
    }

    private suspend fun shutdown() {
        isRunning = false
        idleTickerJob?.cancel()
        notificationJob?.cancel()
        engine.stop()
        motionDetector.release()
        ActivityRecognitionController.stop(this)

        // Última oportunidad de mapear los puntos finales de la jornada: tras
        // soltar el servicio ya no corre nada que pueda enviarlos.
        runCatching { Uploader.flush(this, force = true) }

        Watchdogs.cancelAll(this)
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    // ── Procesado de posiciones ──────────────────────────────────────────────

    private suspend fun onLocations(locations: List<Location>) = processMutex.withLock {
        val technicianId = Prefs.technicianId ?: return@withLock
        val wakeLock = acquireWakeLock()
        try {
            for (location in locations.sortedBy { it.elapsedRealtimeNanos }) {
                handleLocation(technicianId, location)
            }
            maybeFlush()
        } finally {
            releaseWakeLock(wakeLock)
        }
    }

    private suspend fun handleLocation(technicianId: String, location: Location) {
        // ── Anti "Fake GPS" ──
        if (location.isMocked) {
            if (!mockDetected) {
                mockDetected = true
                Prefs.log("seguridad", "Ubicación falsa detectada: se suspende el rastreo")
                EventReporter.reportDeviceEvent(this, technicianId, EventReporter.DeviceEvent.MOCK_ON)
                runCatching { Uploader.flush(this, force = true) }
            }
            return   // jamás enviar un punto simulado
        }
        if (mockDetected) {
            mockDetected = false
            EventReporter.reportDeviceEvent(this, technicianId, EventReporter.DeviceEvent.MOCK_OFF)
        }

        val nowWall = System.currentTimeMillis()
        val nowElapsed = SystemClock.elapsedRealtime()

        // Señal de "el motor sigue entregando", ANTES de cualquier filtro: aunque
        // este punto concreto no se suba, el watchdog debe saber que hay vida.
        Prefs.lastFixTs = nowWall
        satellitesUsed = engine.satellitesUsed

        // Llegó un fix, luego la ubicación está encendida: cierra la bitácora si
        // venía de un apagado detectado con la app cerrada.
        DeviceAudit.auditGps(this, true)

        val validSpeed = if (location.hasSpeed() && location.speed >= 0) location.speed.toDouble() else null
        val speedMs = validSpeed ?: 0.0
        val accuracy = if (location.hasAccuracy()) location.accuracy.toDouble() else null
        val bearing = if (location.hasBearing()) location.bearing.toDouble() else 0.0

        val snap = anchor.apply(location.latitude, location.longitude, validSpeed, speedMs, accuracy)
        if (snap.released) {
            // Movimiento real confirmado: volver de una vez a captura densa para
            // no perder el arranque del recorrido.
            lastMovingElapsed = nowElapsed
            anchoredSinceElapsed = 0L
            stopIdleTicker()
            // El ancla ya exigió su propia confirmación para soltarse, así que
            // exigirla otra vez en updateTier solo retrasaría la captura densa
            // justo cuando arranca el recorrido: se da por confirmada.
            movingFixCount = TrackingConfig.MOVING_CONFIRM_FIXES
        }

        motionDetector.onGpsSample(snap.effectiveSpeedMs, bearing, nowElapsed)

        updateTier(snap.effectiveSpeedMs, nowElapsed, location)

        // Descartar fixes imprecisos: son la causa de los "saltos" en el mapa.
        // Anclado no importa: lo que se sube son las coordenadas del ancla, no las
        // del fix (si no, bajo techo el técnico se quedaba "mudo" y el líder lo
        // veía inactivo con la app perfectamente sana).
        if (!snap.snapped && accuracy != null && accuracy > TrackingConfig.ACCURACY_MAX_M) return

        if (!shouldUpload(snap.lat, snap.lng, snap.effectiveSpeedMs, nowWall)) return

        enqueuePoint(
            technicianId = technicianId,
            tsMillis = location.time.takeIf { it > 0 } ?: nowWall,
            lat = snap.lat,
            lng = snap.lng,
            speed = snap.speed,
            altitude = if (location.hasAltitude()) location.altitude else null,
            bearing = if (location.hasBearing()) bearing else null,
            // Anclado, la coordenada es la del ancla (confiable): reportar la
            // precisión cruda del fix haría que el historial lo descartara.
            accuracy = if (snap.snapped) null else accuracy,
        )
    }

    private suspend fun enqueuePoint(
        technicianId: String,
        tsMillis: Long,
        lat: Double,
        lng: Double,
        speed: Double?,
        altitude: Double?,
        bearing: Double?,
        accuracy: Double?,
    ) {
        val dao = AppDatabase.get(this).queueDao()
        dao.insertLocation(
            LocationEntity(
                technicianId = technicianId,
                tsMillis = tsMillis,
                lat = lat,
                lng = lng,
                speed = speed,
                altitude = altitude,
                bearing = bearing,
                accuracy = accuracy,
                batteryLevel = DeviceState.batteryLevel(this),
                charging = DeviceState.isCharging(this),
            )
        )
        dao.trimLocations(TrackingConfig.LOC_QUEUE_CAP)
        Prefs.setLastUploaded(lat, lng, System.currentTimeMillis())
    }

    /** ¿Vale la pena subir este punto, o está detenido y basta con la cadencia lenta? */
    private fun shouldUpload(lat: Double, lng: Double, speedMs: Double, now: Long): Boolean {
        if (speedMs > TrackingConfig.STATIONARY_SPEED_MS) return true
        val last = Prefs.lastUploaded() ?: return true
        if (now - last.third >= TrackingConfig.STATIONARY_UPLOAD_MS) return true
        if (haversineM(last.first, last.second, lat, lng) >= TrackingConfig.MIN_MOVE_M) return true
        return false
    }

    // ── Niveles de captura ───────────────────────────────────────────────────

    private fun updateTier(effectiveSpeedMs: Double, nowElapsed: Long, location: Location) {
        if (effectiveSpeedMs > TrackingConfig.STATIONARY_SPEED_MS) {
            movingFixCount++
            // Un pico suelto de velocidad con el teléfono quieto es deriva del
            // GNSS, no movimiento. Si contara, reiniciaría el reloj de reposo sin
            // parar y el ancla no se fijaría nunca (ver MOVING_CONFIRM_FIXES).
            // Sin confirmar tampoco se baja de nivel: se deja el tier como está.
            if (movingFixCount < TrackingConfig.MOVING_CONFIRM_FIXES) return

            lastMovingElapsed = nowElapsed
            anchoredSinceElapsed = 0L
            stopIdleTicker()
            applyTier(TrackingTier.MOVING)
            return
        }

        movingFixCount = 0

        if (nowElapsed - lastMovingElapsed < TrackingConfig.STATIONARY_AFTER_MS) return

        // Confirmado detenido: fijar el ancla en la última posición SUBIDA —esa ya
        // pasó el filtro de precisión; el fix actual puede venir degradado si el
        // técnico está bajo techo.
        if (!anchor.isAnchored) {
            // La altitud sí se toma del fix actual aunque las coordenadas vengan
            // de `lastUploaded`: el técnico está detenido, así que es la misma
            // altura, y `lastUploaded` no la guarda.
            val anchorAltitude = if (location.hasAltitude()) location.altitude else null
            val last = Prefs.lastUploaded()
            if (last != null) anchor.anchorAt(last.first, last.second, anchorAltitude)
            else anchor.anchorAt(location.latitude, location.longitude, anchorAltitude)
            anchoredSinceElapsed = nowElapsed
            startIdleTicker()
            Prefs.log("gps", "Técnico detenido: se fija el ancla y se espacia la captura")
        }

        // Reposo profundo: anclado, quieto según el reconocimiento de actividad y
        // ya lleva un buen rato así. Aquí es donde se recupera la batería.
        val deepIdleReady = activityStill &&
            anchoredSinceElapsed > 0 &&
            nowElapsed - anchoredSinceElapsed >= TrackingConfig.DEEP_IDLE_AFTER_MS

        applyTier(if (deepIdleReady) TrackingTier.DEEP_IDLE else TrackingTier.STATIONARY)
    }

    private fun applyTier(tier: TrackingTier) {
        if (engine.currentTier == tier && engine.isRunning) return
        if (!engine.apply(tier)) return
        Prefs.tier = tier.name

        // El acelerómetro solo mientras hay desplazamiento: parado no hay choque
        // que detectar y muestrearlo todo el día se nota en la batería.
        if (tier == TrackingTier.MOVING) {
            motionDetector.startAccelerometer()
            motionDetector.disarmSignificantMotion()
        } else {
            motionDetector.stopAccelerometer()
            // Red de seguridad de coste casi nulo para salir del reposo aunque no
            // haya reconocimiento de actividad disponible.
            motionDetector.armSignificantMotion {
                scope.launch { onActivityChange(moving = true) }
            }
        }
    }

    private suspend fun onActivityChange(moving: Boolean) {
        activityStill = !moving
        if (!moving) return

        // El técnico se movió: soltar el ancla y volver a captura densa de
        // inmediato, sin esperar a que el GPS lo descubra por su cuenta.
        if (anchor.isAnchored || engine.currentTier != TrackingTier.MOVING) {
            anchor.release()
            anchoredSinceElapsed = 0L
            stopIdleTicker()
            lastMovingElapsed = SystemClock.elapsedRealtime()
            // El reconocimiento de actividad del sistema ya es evidencia de
            // movimiento real: no hace falta esperar a confirmarlo con el GPS.
            movingFixCount = TrackingConfig.MOVING_CONFIRM_FIXES
            applyTier(TrackingTier.MOVING)
            Prefs.log("gps", "Movimiento detectado: se reanuda la captura densa")
        }
    }

    // ── Puntos en reposo sin encender el GPS ─────────────────────────────────

    /**
     * Mientras el ancla está puesta, la posición que hay que reportar ya se conoce:
     * es el ancla. Este temporizador mantiene EXACTAMENTE la misma cadencia de
     * puntos que veía el líder antes, sin obligar al GNSS a despertarse para cada
     * uno.
     *
     * Salvaguarda importante: solo emite si el motor sigue entregando fixes
     * reales. Si el técnico apaga la ubicación, los puntos se detienen —como debe
     * ser— y el líder ve "sin señal" en lugar de un técnico falsamente quieto.
     */
    private fun startIdleTicker() {
        if (idleTickerJob?.isActive == true) return
        idleTickerJob = scope.launch {
            while (isActive) {
                delay(TrackingConfig.STATIONARY_UPLOAD_MS)
                val technicianId = Prefs.technicianId ?: break
                val (lat, lng) = anchor.anchorLatLng() ?: break

                val fixAge = System.currentTimeMillis() - Prefs.lastFixTs
                val threshold = TrackingConfig.staleFixThresholdMs(engine.currentTier)
                if (fixAge > threshold) continue    // el GPS no está entregando: no inventar

                val now = System.currentTimeMillis()
                if (!shouldUpload(lat, lng, 0.0, now)) continue

                enqueuePoint(
                    technicianId = technicianId,
                    tsMillis = now,
                    lat = lat,
                    lng = lng,
                    speed = 0.0,
                    // Iba fijo a null, y como el técnico pasa la mayor parte de
                    // la jornada anclado, casi TODOS sus puntos salían sin
                    // altitud: medido el 2026-08-24, la 1.2.8 (React Native, sin
                    // este tickeo) mandaba altitud en el 100 % de sus puntos y la
                    // 2.1.0 en el 12 %. Por eso el perfil de elevación del panel
                    // salía vacío.
                    altitude = anchor.anchorAltitude(),
                    // El rumbo sí se queda en null a propósito: parado no hay
                    // dirección de marcha que reportar.
                    bearing = null,
                    accuracy = null,
                )
                maybeFlush()
            }
        }
    }

    private fun stopIdleTicker() {
        idleTickerJob?.cancel()
        idleTickerJob = null
    }

    // ── Envío ────────────────────────────────────────────────────────────────

    private suspend fun maybeFlush() {
        val nowElapsed = SystemClock.elapsedRealtime()
        val timeToFlush = nowElapsed - lastFlushElapsed >= TrackingConfig.batchIntervalMs(engine.currentTier)
        val tooMany = !timeToFlush &&
            AppDatabase.get(this).queueDao().countLocations() >= TrackingConfig.BATCH_MAX_PENDING
        if (!timeToFlush && !tooMany) return
        lastFlushElapsed = nowElapsed
        flushNow(force = false)
    }

    private suspend fun flushNow(force: Boolean) {
        val online = DeviceState.isOnline(this)
        // Auditar la conexión también desde segundo plano: si el técnico apagó los
        // datos con la app cerrada, esto deja la evidencia.
        DeviceAudit.auditNet(this, online)
        if (!online && !force) return

        val result = runCatching { Uploader.flush(this, force) }.getOrElse {
            Prefs.setLastError(it.message ?: "Error de envío")
            return
        }
        if (result.error == null) {
            Heartbeat.send(this, Heartbeat.AppState.BACKGROUND)
        }
    }

    // ── Salud ────────────────────────────────────────────────────────────────

    /**
     * Comprueba que el rastreo siga ENTREGANDO, no solo que figure como iniciado.
     * Es el watchdog real contra el fallo de "apago y enciendo el GPS y no vuelve".
     */
    private suspend fun ensureHealthy() {
        if (Prefs.technicianId == null) {
            shutdown()
            return
        }

        val gpsOn = DeviceState.isGpsEnabled(this)
        DeviceAudit.auditGps(this, gpsOn)
        DeviceAudit.auditPermission(this, DeviceState.permLevel(this))

        if (!engine.isRunning) {
            Prefs.log("watchdog", "El motor no estaba capturando: se reinicia")
            engine.restart(TrackingTier.MOVING)
            return
        }

        // Sin GPS no hay fix que esperar; el aviso de la pantalla ya lo indica y la
        // transición a "encendido" dispara el re-enganche.
        if (!gpsOn) return

        // Un corte de cobertura que ya dura lo suficiente SÍ es información: se
        // escribe una vez y no se repite hasta que se recupere. Los parpadeos de
        // segundos, que son la inmensa mayoría, no dejan rastro.
        if (!lastAvailability && sinCoberturaDesde != 0L && !cortePorCoberturaRegistrado &&
            SystemClock.elapsedRealtime() - sinCoberturaDesde >= CORTE_COBERTURA_MIN_MS
        ) {
            cortePorCoberturaRegistrado = true
            Prefs.log("gps", "El sistema lleva sin entregar ubicaciones más de 5 min")
        }

        val umbral = TrackingConfig.staleFixThresholdMs(engine.currentTier)

        // Margen tras suscribirse: recién enganchado todavía NO puede haber un fix,
        // así que `lastFix == 0L` no significa "motor muerto" sino "acaba de
        // empezar". Sin esto el watchdog se reiniciaba a sí mismo en el mismo
        // segundo del arranque, y volvía a hacerlo al reanudar tras un reinicio.
        // OJO: solo se salta la comprobación, nunca el latido de abajo — es lo que
        // sostiene el semáforo del panel.
        val enPeriodoDeGracia = SystemClock.elapsedRealtime() - engine.subscribedAtElapsed < umbral

        val lastFix = Prefs.lastFixTs
        val stale = !enPeriodoDeGracia &&
            (lastFix == 0L || System.currentTimeMillis() - lastFix >= umbral)

        if (stale) {
            Prefs.log("watchdog", "Sin posiciones recientes: se vuelve a suscribir el motor")
            engine.restart(TrackingTier.MOVING)
            lastMovingElapsed = SystemClock.elapsedRealtime()
        }

        Heartbeat.send(this, Heartbeat.AppState.BACKGROUND, force = true)
    }

    // ── Notificación ─────────────────────────────────────────────────────────

    private fun startNotificationLoop() {
        if (notificationJob?.isActive == true) return
        notificationJob = scope.launch {
            while (isActive) {
                val pending = runCatching { AppDatabase.get(this@TrackingService).queueDao().countLocations() }
                    .getOrDefault(0)
                val text = buildString {
                    append(
                        when {
                            mockDetected -> "Suspendido: ubicación falsa detectada"
                            !DeviceState.isGpsEnabled(this@TrackingService) -> "GPS apagado"
                            engine.currentTier == TrackingTier.MOVING -> "En movimiento"
                            else -> "En reposo"
                        }
                    )
                    if (pending > 0) append(" · $pending por enviar")
                }
                updateNotification(text)
                delay(30_000)
            }
        }
    }

    private fun updateNotification(status: String) {
        if (status == notificationStatus) return
        notificationStatus = status
        try {
            val nm = getSystemService(android.app.NotificationManager::class.java)
            nm?.notify(Notifications.ID_TRACKING, Notifications.trackingNotification(this, status))
        } catch (_: Exception) {
        }
    }

    // ── Wake lock acotado ────────────────────────────────────────────────────
    // No se mantiene un wake lock permanente (eso impediría dormir al teléfono y
    // arruinaría la batería): solo se sujeta la CPU los segundos que dura el
    // procesado y el envío de un lote.

    private fun acquireWakeLock(): PowerManager.WakeLock? = try {
        val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager
        pm?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "localizador:fix")?.apply {
            setReferenceCounted(false)
            acquire(60_000L)
        }
    } catch (_: Exception) {
        null
    }

    private fun releaseWakeLock(wakeLock: PowerManager.WakeLock?) {
        try {
            if (wakeLock?.isHeld == true) wakeLock.release()
        } catch (_: Exception) {
        }
    }
}
