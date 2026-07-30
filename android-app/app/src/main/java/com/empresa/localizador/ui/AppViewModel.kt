package com.empresa.localizador.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.empresa.localizador.data.AppInit
import com.empresa.localizador.data.Prefs
import com.empresa.localizador.data.db.AppDatabase
import com.empresa.localizador.device.DeviceAudit
import com.empresa.localizador.device.DeviceState
import com.empresa.localizador.device.EventReporter
import com.empresa.localizador.device.OemGuides
import com.empresa.localizador.device.PermLevel
import com.empresa.localizador.net.ApiResult
import com.empresa.localizador.net.SupabaseClient
import com.empresa.localizador.sync.Heartbeat
import com.empresa.localizador.sync.Uploader
import com.empresa.localizador.tracking.TrackingManager
import com.empresa.localizador.tracking.TrackingService
import com.empresa.localizador.work.Watchdogs
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

class AppViewModel(app: Application) : AndroidViewModel(app) {

    enum class Screen { LOADING, TERMS, REGISTER, HOME, MOCK_BLOCKED, DIAGNOSTICS }

    data class UiState(
        val screen: Screen = Screen.LOADING,
        val techName: String? = null,
        val sessionActive: Boolean = false,
        val serviceRunning: Boolean = false,
        val gpsOn: Boolean? = null,
        val permLevel: PermLevel? = null,
        val online: Boolean = true,
        val networkType: String = "unknown",
        val batteryGuard: OemGuides.BatteryGuard? = null,
        val autostart: OemGuides.AutostartGuide? = null,
        val exactAlarmOk: Boolean = true,
        val queueCount: Int = 0,
        val lastSentTs: Long = 0L,
        val lastError: Pair<String, Long>? = null,
        val busy: Boolean = false,
        val syncing: Boolean = false,
        val canCancelRegister: Boolean = false,
        val satellites: Int = -1,
        val tier: String = "MOVING",
        val provider: String = "",
        /** Mensaje puntual para mostrar en un aviso. */
        val toast: String? = null,
        val dialog: Dialog? = null,
    )

    /** Diálogos que la pantalla debe mostrar. Se modelan como estado para que
     *  sobrevivan a una rotación o a que el sistema recree la actividad. */
    sealed interface Dialog {
        data class Info(val title: String, val body: String) : Dialog
        data class Confirm(
            val title: String,
            val body: String,
            val confirmLabel: String,
            val onConfirm: () -> Unit,
        ) : Dialog
    }

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    val deviceId: String get() = Prefs.installId

    private var pollJob: Job? = null

    init {
        viewModelScope.launch { bootstrap() }
    }

    // ── Arranque ─────────────────────────────────────────────────────────────

    private suspend fun bootstrap() {
        // Nada puede tocar la identidad del dispositivo antes de que termine la
        // herencia desde la versión anterior: leerla la crea (ver AppInit).
        AppInit.await()

        if (!Prefs.termsAccepted) {
            _state.update { it.copy(screen = Screen.TERMS) }
            return
        }
        verifyRegistration()
    }

    /**
     * Distingue lo que la versión anterior también distinguía y es importante: una
     * respuesta AUTORITATIVA del servidor ("este teléfono no está vinculado") de un
     * simple fallo de lectura (sin red, sesión caducada). Un fallo de lectura no
     * debe mandar al técnico a re-escanear el QR ni mostrarle "No registrado"
     * cuando sí lo está.
     */
    private suspend fun verifyRegistration() {
        // Mostrar de inmediato el último nombre conocido para no arrancar con un
        // falso "No registrado" mientras se confirma.
        Prefs.technicianName?.let { cached -> _state.update { it.copy(techName = cached) } }

        when (val result = SupabaseClient.findTechnicianByDevice(deviceId)) {
            is ApiResult.Ok -> {
                val tech = result.value
                if (tech != null) {
                    Prefs.technicianName = tech.name
                    _state.update { it.copy(techName = tech.name, screen = Screen.HOME) }
                    autoResume(tech.id)
                } else {
                    Prefs.technicianName = null
                    _state.update { it.copy(techName = null, screen = Screen.REGISTER) }
                }
            }

            is ApiResult.Fail -> {
                // No se pudo verificar: confiar en la caché local.
                val cachedId = Prefs.technicianId
                val cachedName = Prefs.technicianName
                if (cachedId != null || cachedName != null) {
                    _state.update { it.copy(techName = cachedName, screen = Screen.HOME) }
                    if (cachedId != null) autoResume(cachedId)
                } else {
                    _state.update { it.copy(screen = Screen.REGISTER) }
                }
            }
        }
        refreshDeviceStatus()
        refreshDiagnostics()
    }

    /**
     * Auto-arranque silencioso: si la sesión seguía abierta y los permisos ya
     * están concedidos, el rastreo se reanuda sin que el técnico toque nada.
     */
    private suspend fun autoResume(technicianId: String) {
        if (Prefs.technicianId == null) return
        // Evidencia si el rastreo se había caído mientras la app estaba cerrada.
        val wasKilled = DeviceAudit.auditTrackingKilled(getApplication(), TrackingService.isRunning)
        if (wasKilled && OemGuides.isXiaomi) {
            // Si murió pese a que el técnico dio por hecha la exención de batería,
            // la exención no bastó: volver a levantar el aviso.
            Prefs.battOptDismissed = false
        }
        if (DeviceState.permLevel(getApplication()) != PermLevel.NONE) {
            TrackingManager.startSession(getApplication(), technicianId, explicit = false)
        }
    }

    // ── Sondeo mientras la app está a la vista ───────────────────────────────

    fun startPolling() {
        if (pollJob?.isActive == true) return
        pollJob = viewModelScope.launch {
            while (isActive) {
                refreshDeviceStatus()
                refreshDiagnostics()
                flushIfPossible()
                delay(10_000)
            }
        }
    }

    fun stopPolling() {
        pollJob?.cancel()
        pollJob = null
    }

    fun onResumed() {
        viewModelScope.launch {
            refreshDeviceStatus()
            refreshDiagnostics()
            if (Prefs.technicianId != null) {
                TrackingService.healthCheck(getApplication())
            }
        }
    }

    private suspend fun refreshDeviceStatus() {
        val ctx = getApplication<Application>()
        val gpsOn = DeviceState.isGpsEnabled(ctx)
        val perm = DeviceState.permLevel(ctx)
        val online = DeviceState.isOnline(ctx)

        // Auditar transiciones también desde aquí: comparten el estado persistido
        // con el servicio, así que no se duplican eventos.
        val gpsEvent = DeviceAudit.auditGps(ctx, gpsOn)
        if (gpsEvent == EventReporter.DeviceEvent.GPS_ON) {
            // Android no reanuda la captura solo al reencender la ubicación.
            TrackingService.healthCheck(ctx)
        }
        DeviceAudit.auditPermission(ctx, perm)
        DeviceAudit.auditNet(ctx, online)

        val guard = OemGuides.batteryGuard(ctx)
        if (!guard.xiaomi) DeviceAudit.auditBatteryOpt(ctx, guard.needsAttention)

        _state.update {
            it.copy(
                screen = if (TrackingService.mockDetected) Screen.MOCK_BLOCKED
                else if (it.screen == Screen.MOCK_BLOCKED) Screen.HOME
                else it.screen,
                gpsOn = gpsOn,
                permLevel = perm,
                online = online,
                networkType = DeviceState.networkType(ctx),
                batteryGuard = guard,
                autostart = OemGuides.autostartGuide(),
                exactAlarmOk = Watchdogs.canScheduleExact(ctx),
                sessionActive = Prefs.technicianId != null,
                serviceRunning = TrackingService.isRunning,
                satellites = TrackingService.satellitesUsed,
                tier = Prefs.tier,
            )
        }
    }

    private suspend fun refreshDiagnostics() {
        val dao = AppDatabase.get(getApplication()).queueDao()
        val count = runCatching { dao.countLocations() + dao.countMotions() }.getOrDefault(0)
        _state.update {
            it.copy(
                queueCount = count,
                lastSentTs = Prefs.lastSentTs,
                lastError = Prefs.lastError(),
            )
        }
    }

    /**
     * Drena la cola mientras la app está abierta, sin depender de que llegue una
     * posición. En la versión anterior esto solo ocurría desde la tarea de fondo,
     * que en varios equipos quedaba suspendida.
     */
    private suspend fun flushIfPossible() {
        if (Prefs.technicianId == null) return
        if (!DeviceState.isOnline(getApplication())) return
        runCatching { Uploader.flush(getApplication()) }
        Heartbeat.send(getApplication(), Heartbeat.AppState.FOREGROUND)
        refreshDiagnostics()
    }

    // ── Acciones ─────────────────────────────────────────────────────────────

    fun acceptTerms() {
        Prefs.termsAccepted = true
        viewModelScope.launch {
            _state.update { it.copy(screen = Screen.LOADING) }
            verifyRegistration()
        }
    }

    fun goToRegister() {
        _state.update { it.copy(screen = Screen.REGISTER, canCancelRegister = true) }
    }

    fun cancelRegister() {
        _state.update { it.copy(screen = Screen.HOME, canCancelRegister = false) }
    }

    fun goToDiagnostics() {
        _state.update { it.copy(screen = Screen.DIAGNOSTICS) }
    }

    fun backToHome() {
        _state.update { it.copy(screen = Screen.HOME) }
    }

    /** Registro por QR. @return mensaje de error, o null si salió bien. */
    suspend fun registerWithToken(token: String): String? {
        return when (val result = SupabaseClient.registerDevice(token, deviceId)) {
            is ApiResult.Fail -> result.message
            is ApiResult.Ok -> {
                val r = result.value
                if (!r.success) {
                    r.error ?: "Registro fallido. Pide un código QR nuevo al administrador."
                } else {
                    r.name?.let { Prefs.technicianName = it }
                    _state.update {
                        it.copy(techName = r.name, screen = Screen.HOME, canCancelRegister = false)
                    }
                    null
                }
            }
        }
    }

    /**
     * Botón principal. Al iniciar comprueba GPS y permisos; al detener, registra la
     * parada como acción explícita del técnico.
     */
    fun toggleTracking(onNeedsPermissions: () -> Unit) {
        val ctx = getApplication<Application>()
        viewModelScope.launch {
            if (Prefs.technicianId != null) {
                _state.update { it.copy(busy = true) }
                TrackingManager.stopSession(ctx)
                _state.update { it.copy(busy = false, sessionActive = false, serviceRunning = false) }
                refreshDeviceStatus()
                return@launch
            }

            if (!DeviceState.isGpsEnabled(ctx)) {
                showDialog(
                    Dialog.Info(
                        "GPS desactivado",
                        "Activa la ubicación del teléfono en Ajustes y vuelve a intentarlo.",
                    )
                )
                return@launch
            }

            if (DeviceState.permLevel(ctx) != PermLevel.FULL) {
                onNeedsPermissions()
                return@launch
            }

            _state.update { it.copy(busy = true) }
            val tech = when (val r = SupabaseClient.findTechnicianByDevice(deviceId)) {
                is ApiResult.Ok -> r.value
                is ApiResult.Fail -> null
            }
            if (tech == null) {
                _state.update { it.copy(busy = false) }
                showDialog(
                    Dialog.Info(
                        "Dispositivo no registrado",
                        "Este teléfono no está vinculado a ningún técnico. Escanea el código QR que te dé tu líder.",
                    )
                )
                return@launch
            }

            TrackingManager.startSession(ctx, tech.id, explicit = true)
            Prefs.technicianName = tech.name
            _state.update { it.copy(busy = false, techName = tech.name, sessionActive = true) }
            OemGuides.ensureBatteryExemptionOnce(ctx)
            refreshDeviceStatus()
        }
    }

    /** Se llama cuando el sistema ya concedió los permisos que faltaban. */
    fun onPermissionsGranted() {
        toggleTracking(onNeedsPermissions = {
            showDialog(
                Dialog.Info(
                    "Permiso incompleto",
                    "El rastreo necesita el permiso de ubicación en \"Permitir todo el tiempo\". " +
                        "Ábrelo en Ajustes › Permisos › Ubicación.",
                )
            )
        })
    }

    fun forceSync() {
        viewModelScope.launch {
            _state.update { it.copy(syncing = true) }
            val result = runCatching { Uploader.flush(getApplication(), force = true) }.getOrNull()
            refreshDiagnostics()
            _state.update { it.copy(syncing = false) }
            showDialog(
                if (result != null && result.remaining == 0) {
                    Dialog.Info("Sincronizado", "Los datos pendientes se enviaron correctamente.")
                } else {
                    Dialog.Info(
                        "Sincronización incompleta",
                        result?.error
                            ?: "Quedan ${result?.remaining ?: 0} registros en cola. Revisa la conexión e inténtalo de nuevo.",
                    )
                }
            )
        }
    }

    fun confirmSos() {
        showDialog(
            Dialog.Confirm(
                title = "Enviar SOS",
                body = "¿Enviar una alerta de emergencia a tu líder ahora?",
                confirmLabel = "Enviar SOS",
                onConfirm = { sendSos() },
            )
        )
    }

    private fun sendSos() {
        viewModelScope.launch {
            val techId = Prefs.technicianId ?: run {
                val found = (SupabaseClient.findTechnicianByDevice(deviceId) as? ApiResult.Ok)?.value
                found?.id
            }
            if (techId == null) {
                showDialog(Dialog.Info("Error", "Este dispositivo no está registrado."))
                return@launch
            }
            val sent = EventReporter.reportSos(getApplication(), techId)
            refreshDiagnostics()
            showDialog(
                Dialog.Info(
                    "SOS",
                    if (sent) "Alerta enviada a tu líder."
                    else "Sin conexión: el SOS se enviará automáticamente al reconectar.",
                )
            )
        }
    }

    fun dismissBatteryGuard() {
        Prefs.battOptDismissed = true
        viewModelScope.launch { refreshDeviceStatus() }
    }

    fun dismissAutostart() {
        Prefs.autostartDone = true
        viewModelScope.launch { refreshDeviceStatus() }
    }

    fun showDialog(dialog: Dialog) = _state.update { it.copy(dialog = dialog) }

    fun dismissDialog() = _state.update { it.copy(dialog = null) }

    override fun onCleared() {
        stopPolling()
        super.onCleared()
    }
}
