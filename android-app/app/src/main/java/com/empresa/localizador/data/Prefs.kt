package com.empresa.localizador.data

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * Estado persistente de la app.
 *
 * Se usa SharedPreferences (no DataStore) a propósito: el servicio de rastreo y
 * los watchdogs leen este estado en caminos síncronos y sensibles al tiempo —un
 * fix del GPS no debería tener que esperar a una corrutina—. Para la interfaz se
 * expone además un [StateFlow] que se refresca con el listener de cambios.
 *
 * Los nombres de las claves son nuevos; la herencia desde las claves de
 * AsyncStorage de la app React Native la hace [LegacyImporter] una sola vez.
 */
object Prefs {

    private const val FILE = "localizador_prefs"

    private const val K_INSTALL_ID = "install_id"
    private const val K_TECH_ID = "technician_id"
    private const val K_TECH_NAME = "technician_name"
    private const val K_TERMS = "terms_accepted"
    private const val K_LAST_FIX_TS = "last_fix_ts"
    private const val K_LAST_UP_LAT = "last_up_lat"
    private const val K_LAST_UP_LNG = "last_up_lng"
    private const val K_LAST_UP_TS = "last_up_ts"
    private const val K_LAST_SENT_TS = "last_sent_ts"
    private const val K_LAST_ERROR_MSG = "last_error_msg"
    private const val K_LAST_ERROR_TS = "last_error_ts"
    private const val K_GPS_STATE = "gps_state"
    private const val K_NET_STATE = "net_state"
    private const val K_BATTOPT_STATE = "battopt_state"
    private const val K_PERM_STATE = "perm_state"
    private const val K_BATTOPT_DISMISSED = "battopt_dismissed"
    private const val K_BATTOPT_ASKED = "battopt_asked"
    private const val K_AUTOSTART_DONE = "autostart_done"
    private const val K_NEXT_RETRY_AT = "next_retry_at"
    private const val K_BACKOFF_STEP = "backoff_step"
    private const val K_LEGACY_IMPORTED = "legacy_imported"
    private const val K_LEGACY_ATTEMPTS = "legacy_import_attempts"
    private const val K_LEGACY_FAILURE = "legacy_import_failure"
    private const val K_TIER = "tracking_tier"
    private const val K_LOG = "diag_log"
    private const val K_SESSION_TOKENS = "session_tokens"

    private lateinit var prefs: SharedPreferences

    /** Se incrementa en cada escritura para que la interfaz sepa que hay algo nuevo. */
    private val _revision = MutableStateFlow(0L)
    val revision: StateFlow<Long> = _revision

    private val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, _ ->
        _revision.value = _revision.value + 1
    }

    fun init(context: Context) {
        if (::prefs.isInitialized) return
        prefs = context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)
        prefs.registerOnSharedPreferenceChangeListener(listener)
    }

    // ── Identidad del dispositivo ────────────────────────────────────────────

    /**
     * Identificador de instalación. Nace con la instalación y muere con ella, así
     * que reinstalar obliga a volver a escanear el QR (evita que un teléfono quede
     * vinculado para siempre). Deliberadamente NO es el ANDROID_ID, que sobrevive
     * a la reinstalación.
     */
    // Perder o duplicar este valor equivale a desvincular el teléfono: el servidor
    // deja de reconocer el `device_id` y el técnico tiene que volver a escanear el
    // QR. Por eso, contra la costumbre, aquí se escribe con `commit()` y no con
    // `apply()`:
    //
    //  - `@Synchronized` — el getter ACUÑA el identificador si no existe. Dos hilos
    //    entrando a la vez en un arranque en frío (la interfaz y el servicio, que
    //    es justo lo que pasa al reanudar el rastreo) generaban DOS UUID distintos
    //    y ganaba el último en escribir; el registro podía quedar hecho con el que
    //    se descartó.
    //  - `commit()` — `apply()` vuelve enseguida y escribe a disco después. Si la
    //    capa del fabricante mata el proceso en esa ventana (MIUI lo hace, y lo
    //    hace especialmente en el primer arranque tras actualizar), el identificador
    //    se pierde y al siguiente arranque nace otro.
    val installId: String
        @Synchronized get() {
            prefs.getString(K_INSTALL_ID, null)?.let { return it }
            val fresh = UUID.randomUUID().toString()
            prefs.edit().putString(K_INSTALL_ID, fresh).commit()
            return fresh
        }

    /** Fija el identificador heredado. Síncrono a propósito: ver [installId]. */
    @Synchronized
    fun setInstallId(id: String) {
        prefs.edit().putString(K_INSTALL_ID, id).commit()
    }

    fun hasInstallId(): Boolean = prefs.getString(K_INSTALL_ID, null) != null

    // ── Sesión de rastreo ────────────────────────────────────────────────────
    // "Hay sesión activa" == hay technicianId guardado. Es la misma convención que
    // usaba la app React Native, y de ella dependen la auditoría y el heartbeat.

    var technicianId: String?
        get() = prefs.getString(K_TECH_ID, null)
        set(v) = prefs.edit().apply { if (v == null) remove(K_TECH_ID) else putString(K_TECH_ID, v) }.apply()

    var technicianName: String?
        get() = prefs.getString(K_TECH_NAME, null)
        set(v) = prefs.edit().apply { if (v == null) remove(K_TECH_NAME) else putString(K_TECH_NAME, v) }.apply()

    var termsAccepted: Boolean
        get() = prefs.getBoolean(K_TERMS, false)
        set(v) = prefs.edit().putBoolean(K_TERMS, v).apply()

    // ── Señales de salud del rastreo ─────────────────────────────────────────

    /**
     * Cuándo entregó el GPS el ÚLTIMO fix, se haya subido o no. Es la señal real
     * de "el motor sigue vivo": los watchdogs la usan para distinguir un servicio
     * que entrega de uno "iniciado pero mudo".
     */
    var lastFixTs: Long
        get() = prefs.getLong(K_LAST_FIX_TS, 0L)
        set(v) = prefs.edit().putLong(K_LAST_FIX_TS, v).apply()

    fun lastUploaded(): Triple<Double, Double, Long>? {
        val ts = prefs.getLong(K_LAST_UP_TS, 0L)
        if (ts == 0L) return null
        return Triple(
            prefs.getFloat(K_LAST_UP_LAT, 0f).toDouble(),
            prefs.getFloat(K_LAST_UP_LNG, 0f).toDouble(),
            ts,
        )
    }

    fun setLastUploaded(lat: Double, lng: Double, ts: Long) {
        prefs.edit()
            .putFloat(K_LAST_UP_LAT, lat.toFloat())
            .putFloat(K_LAST_UP_LNG, lng.toFloat())
            .putLong(K_LAST_UP_TS, ts)
            .apply()
    }

    var lastSentTs: Long
        get() = prefs.getLong(K_LAST_SENT_TS, 0L)
        set(v) = prefs.edit().putLong(K_LAST_SENT_TS, v).apply()

    fun lastError(): Pair<String, Long>? {
        val msg = prefs.getString(K_LAST_ERROR_MSG, null) ?: return null
        return msg to prefs.getLong(K_LAST_ERROR_TS, 0L)
    }

    fun setLastError(msg: String) {
        prefs.edit()
            .putString(K_LAST_ERROR_MSG, msg)
            .putLong(K_LAST_ERROR_TS, System.currentTimeMillis())
            .apply()
    }

    fun clearLastError() {
        prefs.edit().remove(K_LAST_ERROR_MSG).remove(K_LAST_ERROR_TS).apply()
    }

    var tier: String
        get() = prefs.getString(K_TIER, "MOVING") ?: "MOVING"
        set(v) = prefs.edit().putString(K_TIER, v).apply()

    // ── Estados para la auditoría de transiciones ────────────────────────────
    // `null` = aún no medido: el primer muestreo solo SIEMBRA, no dispara evento
    // (así abrir la app no genera un falso "apagó el GPS").

    private fun boolOrNull(key: String): Boolean? =
        when (prefs.getInt(key, -1)) {
            1 -> true
            0 -> false
            else -> null
        }

    private fun setBool(key: String, v: Boolean) =
        prefs.edit().putInt(key, if (v) 1 else 0).apply()

    var gpsState: Boolean?
        get() = boolOrNull(K_GPS_STATE)
        set(v) = if (v == null) Unit else setBool(K_GPS_STATE, v)

    var netState: Boolean?
        get() = boolOrNull(K_NET_STATE)
        set(v) = if (v == null) Unit else setBool(K_NET_STATE, v)

    var battOptState: Boolean?
        get() = boolOrNull(K_BATTOPT_STATE)
        set(v) = if (v == null) Unit else setBool(K_BATTOPT_STATE, v)

    /** "full" | "partial" | "none" */
    var permState: String?
        get() = prefs.getString(K_PERM_STATE, null)
        set(v) = prefs.edit().apply { if (v == null) remove(K_PERM_STATE) else putString(K_PERM_STATE, v) }.apply()

    // ── Avisos de fabricante ─────────────────────────────────────────────────

    var battOptDismissed: Boolean
        get() = prefs.getBoolean(K_BATTOPT_DISMISSED, false)
        set(v) = prefs.edit().putBoolean(K_BATTOPT_DISMISSED, v).apply()

    var battOptAsked: Boolean
        get() = prefs.getBoolean(K_BATTOPT_ASKED, false)
        set(v) = prefs.edit().putBoolean(K_BATTOPT_ASKED, v).apply()

    var autostartDone: Boolean
        get() = prefs.getBoolean(K_AUTOSTART_DONE, false)
        set(v) = prefs.edit().putBoolean(K_AUTOSTART_DONE, v).apply()

    // ── Backoff de reintentos de envío ───────────────────────────────────────

    var nextRetryAt: Long
        get() = prefs.getLong(K_NEXT_RETRY_AT, 0L)
        set(v) = prefs.edit().putLong(K_NEXT_RETRY_AT, v).apply()

    var backoffStep: Int
        get() = prefs.getInt(K_BACKOFF_STEP, 0)
        set(v) = prefs.edit().putInt(K_BACKOFF_STEP, v).apply()

    fun clearBackoff() {
        prefs.edit().remove(K_NEXT_RETRY_AT).remove(K_BACKOFF_STEP).apply()
    }

    // ── Sesión de Supabase (tokens) ──────────────────────────────────────────

    var sessionTokens: String?
        get() = prefs.getString(K_SESSION_TOKENS, null)
        set(v) = prefs.edit().apply { if (v == null) remove(K_SESSION_TOKENS) else putString(K_SESSION_TOKENS, v) }.apply()

    // ── Herencia desde la app React Native ───────────────────────────────────

    // `commit()`: si el proceso muere justo después de heredar, `apply()` podría no
    // haber llegado a disco y la herencia se repetiría, duplicando los puntos que
    // se rescataron de la cola antigua.
    var legacyImported: Boolean
        get() = prefs.getBoolean(K_LEGACY_IMPORTED, false)
        set(v) { prefs.edit().putBoolean(K_LEGACY_IMPORTED, v).commit() }

    /**
     * Intentos de herencia ya gastados. La base de la versión anterior puede estar
     * temporalmente ilegible (un cierre a la fuerza deja un diario sin reproducir),
     * y ese fallo es recuperable en el siguiente arranque. Se cuenta para no
     * reintentar indefinidamente cuando el fallo es definitivo.
     */
    var legacyImportAttempts: Int
        get() = prefs.getInt(K_LEGACY_ATTEMPTS, 0)
        set(v) { prefs.edit().putInt(K_LEGACY_ATTEMPTS, v).commit() }

    /**
     * Motivo por el que no se pudo heredar la identidad del dispositivo, o `null`
     * si no hubo problema. La pantalla de diagnóstico lo enseña: si un técnico
     * acaba re-escaneando el QR, aquí queda escrito por qué, en vez de que parezca
     * que la app lo mandó a escanear sin motivo.
     */
    var legacyImportFailure: String?
        get() = prefs.getString(K_LEGACY_FAILURE, null)
        set(v) { prefs.edit().apply { if (v == null) remove(K_LEGACY_FAILURE) else putString(K_LEGACY_FAILURE, v) }.commit() }

    // ── Bitácora local de diagnóstico ────────────────────────────────────────
    // Anillo corto de sucesos relevantes (arranques, reparaciones, caídas). Es lo
    // que la pantalla de diagnóstico enseña y exporta: prueba en el propio
    // teléfono de que la app estuvo trabajando.

    private const val LOG_CAP = 120

    @Synchronized
    fun log(tag: String, message: String) {
        val arr = try {
            JSONArray(prefs.getString(K_LOG, "[]"))
        } catch (_: Exception) {
            JSONArray()
        }
        arr.put(
            JSONObject()
                .put("ts", System.currentTimeMillis())
                .put("tag", tag)
                .put("msg", message)
        )
        val trimmed = JSONArray()
        val from = maxOf(0, arr.length() - LOG_CAP)
        for (i in from until arr.length()) trimmed.put(arr.get(i))
        prefs.edit().putString(K_LOG, trimmed.toString()).apply()
    }

    data class LogEntry(val ts: Long, val tag: String, val msg: String)

    fun readLog(): List<LogEntry> = try {
        val arr = JSONArray(prefs.getString(K_LOG, "[]"))
        (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            LogEntry(o.optLong("ts"), o.optString("tag"), o.optString("msg"))
        }.reversed()
    } catch (_: Exception) {
        emptyList()
    }

    /** Borra el vínculo con el técnico (fin de sesión de rastreo). */
    fun clearSession() {
        prefs.edit().remove(K_TECH_ID).apply()
    }
}
