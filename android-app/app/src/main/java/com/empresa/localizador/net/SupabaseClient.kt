package com.empresa.localizador.net

import android.util.Log
import com.empresa.localizador.BuildConfig
import com.empresa.localizador.data.Prefs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Cliente de Supabase escrito a mano sobre OkHttp.
 *
 * Se prefiere a un SDK completo por tres razones concretas de esta app:
 *  1. Control total del reintento y de la clasificación de errores: para una cola
 *     offline, confundir "sin red" con "fila inválida" significa o perder puntos
 *     o atascar la cola para siempre.
 *  2. Sin dependencias pesadas en el proceso que sostiene el rastreo.
 *  3. Refresco de sesión serializado con un mutex: varios envíos concurrentes
 *     (servicio + worker) nunca disparan dos re-autenticaciones a la vez.
 */
object SupabaseClient {

    private const val TAG = "Supabase"

    private val baseUrl = BuildConfig.SUPABASE_URL.trimEnd('/')
    private val anonKey = BuildConfig.SUPABASE_ANON_KEY

    private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        explicitNulls = true
    }

    private val http: OkHttpClient by lazy {
        OkHttpClient.Builder()
            // Tiempos cortos: en el campo, una conexión que tarda 30 s es una
            // conexión que no existe. Mejor fallar rápido, conservar la cola y
            // reintentar con backoff que bloquear un worker cinco minutos.
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .callTimeout(60, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
    }

    // ── Sesión ───────────────────────────────────────────────────────────────

    private data class Session(
        val accessToken: String,
        val refreshToken: String,
        /** Epoch en SEGUNDOS, como lo devuelve GoTrue. */
        val expiresAt: Long,
    )

    private val authMutex = Mutex()

    @Volatile
    private var session: Session? = null

    private fun loadSession(): Session? {
        session?.let { return it }
        val raw = Prefs.sessionTokens ?: return null
        return try {
            val o = JSONObject(raw)
            Session(
                accessToken = o.getString("access_token"),
                refreshToken = o.getString("refresh_token"),
                expiresAt = o.getLong("expires_at"),
            ).also { session = it }
        } catch (_: Exception) {
            null
        }
    }

    private fun storeSession(s: Session) {
        session = s
        Prefs.sessionTokens = JSONObject()
            .put("access_token", s.accessToken)
            .put("refresh_token", s.refreshToken)
            .put("expires_at", s.expiresAt)
            .toString()
    }

    private fun clearSession() {
        session = null
        Prefs.sessionTokens = null
    }

    /**
     * ¿Se está trabajando sin sesión de usuario, solo con la clave pública?
     * Se enseña en la pantalla de diagnóstico.
     */
    @Volatile
    var usingAnonKeyFallback: Boolean = false
        private set

    /** No martillear un endpoint de autenticación que está fallando. */
    @Volatile
    private var nextSignInAttemptAt = 0L
    private const val SIGN_IN_COOLDOWN_MS = 30 * 60_000L

    /**
     * Devuelve el token con el que autorizar la petición.
     *
     * Punto importante y aprendido a base de disgustos: **la app nunca debe dejar
     * de reportar porque no haya podido crear una sesión de usuario.** Las
     * políticas de acceso de la base de datos ya conceden permiso al rol público
     * (`anon`), que es exactamente lo que usa la clave pública, así que si el alta
     * anónima falla se sigue trabajando con ella en lugar de abortar el envío.
     *
     * Esto no es teórico: en el proyecto actual el alta anónima devuelve
     * "Database error creating anonymous user", y en la versión React Native eso
     * hacía que `ensureAuth()` lanzara una excepción ANTES de vaciar la cola. El
     * teléfono seguía capturando posiciones, pero no enviaba ni una: el técnico
     * veía la app funcionando y el líder lo veía desaparecido.
     *
     * Serializado con un mutex: diez envíos concurrentes con el token vencido
     * provocan una sola renovación.
     */
    private suspend fun ensureAuth(): ApiResult<String> = authMutex.withLock {
        val nowSeconds = System.currentTimeMillis() / 1000
        val current = loadSession()

        if (current != null && current.expiresAt > nowSeconds + 120) {
            usingAnonKeyFallback = false
            return@withLock ApiResult.Ok(current.accessToken)
        }

        if (current != null) {
            when (val refreshed = refresh(current.refreshToken)) {
                is ApiResult.Ok -> {
                    usingAnonKeyFallback = false
                    return@withLock ApiResult.Ok(refreshed.value.accessToken)
                }

                is ApiResult.Fail -> {
                    // Un fallo de red al refrescar NO debe destruir la sesión: el
                    // token de refresco puede seguir siendo válido cuando vuelva la
                    // cobertura. Solo se descarta ante un rechazo del servidor.
                    if (!refreshed.transient) clearSession()
                }
            }
        }

        val now = System.currentTimeMillis()
        if (now >= nextSignInAttemptAt) {
            nextSignInAttemptAt = now + SIGN_IN_COOLDOWN_MS
            when (val fresh = signInAnonymously()) {
                is ApiResult.Ok -> {
                    usingAnonKeyFallback = false
                    return@withLock ApiResult.Ok(fresh.value.accessToken)
                }

                is ApiResult.Fail -> {
                    if (!usingAnonKeyFallback) {
                        Prefs.log(
                            "acceso",
                            "Sin sesión de usuario (${fresh.message}); se continúa con la clave pública",
                        )
                    }
                }
            }
        }

        usingAnonKeyFallback = true
        ApiResult.Ok(anonKey)
    }

    private suspend fun signInAnonymously(): ApiResult<Session> =
        postAuth("$baseUrl/auth/v1/signup", "{}")

    private suspend fun refresh(refreshToken: String): ApiResult<Session> =
        postAuth(
            "$baseUrl/auth/v1/token?grant_type=refresh_token",
            JSONObject().put("refresh_token", refreshToken).toString(),
        )

    private suspend fun postAuth(url: String, body: String): ApiResult<Session> =
        withContext(Dispatchers.IO) {
            val req = Request.Builder()
                .url(url)
                .addHeader("apikey", anonKey)
                .addHeader("Content-Type", "application/json")
                .post(body.toRequestBody(JSON_MEDIA))
                .build()
            try {
                http.newCall(req).execute().use { resp ->
                    val text = resp.body?.string().orEmpty()
                    if (!resp.isSuccessful) {
                        return@withContext ApiResult.Fail(
                            transient = resp.code >= 500 || resp.code == 429,
                            message = "Autenticación rechazada (${resp.code}): ${shorten(text)}",
                            status = resp.code,
                        )
                    }
                    val o = JSONObject(text)
                    val access = o.optString("access_token").takeIf { it.isNotBlank() }
                        ?: return@withContext ApiResult.Fail(
                            transient = false,
                            message = "La respuesta de autenticación no traía token",
                        )
                    val expiresAt = when {
                        o.has("expires_at") -> o.getLong("expires_at")
                        else -> System.currentTimeMillis() / 1000 + o.optLong("expires_in", 3600)
                    }
                    val s = Session(access, o.optString("refresh_token"), expiresAt)
                    storeSession(s)
                    ApiResult.Ok(s)
                }
            } catch (e: IOException) {
                ApiResult.Fail(transient = true, message = e.message ?: "Sin conexión")
            } catch (e: Exception) {
                ApiResult.Fail(transient = false, message = e.message ?: "Error de autenticación")
            }
        }

    // ── REST ─────────────────────────────────────────────────────────────────

    /**
     * SQLSTATE considerados TRANSITORIOS: conviene reintentarlos sin descartar
     * nada (serialización, deadlock, timeout, exceso de conexiones y toda la clase
     * 08 de fallos de conexión). Cualquier otro código de Postgres significa que el
     * servidor rechazó el CONTENIDO de la fila, y reintentarla eternamente
     * atascaría la cola.
     */
    private val TRANSIENT_PG_CODES = setOf(
        "40001", "40P01", "57014", "53300", "55P03",
        "08000", "08003", "08006", "08001", "08004", "08007", "08P01",
    )

    private fun classify(status: Int, body: String): ApiResult.Fail {
        val code = try {
            JSONObject(body).optString("code").takeIf { it.isNotBlank() }
        } catch (_: Exception) {
            null
        }
        val message = try {
            JSONObject(body).optString("message").takeIf { it.isNotBlank() }
        } catch (_: Exception) {
            null
        } ?: shorten(body)

        // Un rechazo de credenciales NO es una fila envenenada: la misma fila entra
        // sin problema en cuanto haya un token válido. Clasificarlo como permanente
        // era catastrófico —cada punto acababa apartado uno a uno y la cola entera
        // se vaciaba a la basura mientras el técnico veía la app trabajando— y es el
        // fallo que se está viviendo en la versión React Native, donde `PGRST301`
        // (token vencido) no figura entre los códigos transitorios.
        //
        // `execute` ya reintenta una vez renovando la sesión; si aun así vuelve 401,
        // lo correcto es conservar la fila y esperar, nunca descartarla.
        // Solo la familia PGRST3xx es de autenticación (PGRST301 = token vencido).
        // Las PGRST1xx/2xx son de análisis y de esquema —una columna que no existe—
        // y esas SÍ son permanentes: darles reintento infinito atascaría la cola
        // para siempre, que es justo lo que el apartado de filas evita.
        val authRejected = status == 401 || status == 403 ||
            (code != null && code.startsWith("PGRST3"))

        // Sin código de Postgres, un 5xx/429 es del servidor o de la red: transitorio.
        val transient = when {
            authRejected -> true
            code != null -> code in TRANSIENT_PG_CODES
            status >= 500 || status == 429 || status == 408 -> true
            else -> false
        }
        return ApiResult.Fail(transient, message, code, status)
    }

    private fun shorten(s: String, max: Int = 200): String =
        if (s.length <= max) s else s.take(max) + "…"

    // `buildRequest` va al final para poder invocarlo como lambda final en los
    // llamadores, que es donde se lee mejor.
    private suspend fun execute(
        allowRetryOnUnauthorized: Boolean = true,
        buildRequest: (token: String) -> Request,
    ): ApiResult<String> {
        val token = when (val auth = ensureAuth()) {
            is ApiResult.Ok -> auth.value
            is ApiResult.Fail -> return auth
        }

        return withContext(Dispatchers.IO) {
            try {
                http.newCall(buildRequest(token)).execute().use { resp ->
                    val text = resp.body?.string().orEmpty()
                    when {
                        resp.isSuccessful -> ApiResult.Ok(text)
                        // El token caducó antes de tiempo (o el servidor lo revocó):
                        // renovar una vez y repetir. Sin esto, una sesión vencida se
                        // manifiesta como "no registrado" o como cola atascada.
                        (resp.code == 401 || resp.code == 403) && allowRetryOnUnauthorized -> {
                            clearSession()
                            execute(allowRetryOnUnauthorized = false, buildRequest = buildRequest)
                        }
                        else -> classify(resp.code, text)
                    }
                }
            } catch (e: IOException) {
                ApiResult.Fail(transient = true, message = e.message ?: "Sin conexión")
            } catch (e: Exception) {
                ApiResult.Fail(transient = false, message = e.message ?: "Error inesperado")
            }
        }
    }

    private fun restRequest(
        token: String,
        path: String,
        method: String,
        body: String?,
        prefer: String?,
    ): Request {
        val builder = Request.Builder()
            .url("$baseUrl/rest/v1/$path")
            .addHeader("apikey", anonKey)
            .addHeader("Authorization", "Bearer $token")
            .addHeader("Content-Type", "application/json")
        if (prefer != null) builder.addHeader("Prefer", prefer)
        val rb = body?.toRequestBody(JSON_MEDIA)
        return when (method) {
            "GET" -> builder.get().build()
            "POST" -> builder.post(rb ?: "".toRequestBody(JSON_MEDIA)).build()
            "PATCH" -> builder.patch(rb ?: "".toRequestBody(JSON_MEDIA)).build()
            else -> throw IllegalArgumentException(method)
        }
    }

    // ── Operaciones concretas ────────────────────────────────────────────────

    /** Inserta un lote de puntos. `return=minimal` ahorra ancho de banda y batería. */
    suspend fun insertLocations(rows: List<LocationPayload>): ApiResult<Unit> {
        if (rows.isEmpty()) return ApiResult.Ok(Unit)
        val body = json.encodeToString(rows)
        return when (val r = execute { t -> restRequest(t, "location_events", "POST", body, "return=minimal") }) {
            is ApiResult.Ok -> ApiResult.Ok(Unit)
            is ApiResult.Fail -> r
        }
    }

    suspend fun insertMotions(rows: List<MotionPayload>): ApiResult<Unit> {
        if (rows.isEmpty()) return ApiResult.Ok(Unit)
        val body = json.encodeToString(rows)
        return when (val r = execute { t -> restRequest(t, "motion_events", "POST", body, "return=minimal") }) {
            is ApiResult.Ok -> ApiResult.Ok(Unit)
            is ApiResult.Fail -> r
        }
    }

    /** Upsert del latido: una fila por técnico, se pisa en cada tick. */
    suspend fun upsertHeartbeat(row: HeartbeatPayload): ApiResult<Unit> {
        val body = json.encodeToString(listOf(row))
        val r = execute { t ->
            restRequest(
                t,
                "technician_heartbeat?on_conflict=technician_id",
                "POST",
                body,
                "resolution=merge-duplicates,return=minimal",
            )
        }
        return when (r) {
            is ApiResult.Ok -> ApiResult.Ok(Unit)
            is ApiResult.Fail -> r
        }
    }

    /** Busca el técnico vinculado a este dispositivo. `null` = no vinculado. */
    suspend fun findTechnicianByDevice(deviceId: String): ApiResult<TechnicianRow?> {
        val encoded = java.net.URLEncoder.encode(deviceId, "UTF-8")
        val r = execute { t ->
            restRequest(t, "technicians?device_id=eq.$encoded&select=id,name&limit=1", "GET", null, null)
        }
        return when (r) {
            is ApiResult.Fail -> r
            is ApiResult.Ok -> try {
                val list = json.decodeFromString<List<TechnicianRow>>(r.value)
                ApiResult.Ok(list.firstOrNull())
            } catch (e: Exception) {
                ApiResult.Fail(false, "Respuesta ilegible del servidor: ${e.message}")
            }
        }
    }

    /** Registro por QR. */
    suspend fun registerDevice(token: String, deviceId: String): ApiResult<RegisterResult> {
        val body = JSONObject()
            .put("p_token", token)
            .put("p_device_id", deviceId)
            .toString()
        val r = execute { t -> restRequest(t, "rpc/register_device", "POST", body, null) }
        return when (r) {
            is ApiResult.Fail -> r
            is ApiResult.Ok -> try {
                val o = json.parseToJsonElement(r.value) as? JsonObject
                    ?: return ApiResult.Fail(false, "Respuesta inesperada del registro")
                ApiResult.Ok(
                    RegisterResult(
                        success = o["success"]?.jsonPrimitive?.content?.toBoolean() ?: false,
                        name = o["name"]?.jsonPrimitive?.contentOrNullSafe(),
                        error = o["error"]?.jsonPrimitive?.contentOrNullSafe(),
                    )
                )
            } catch (e: Exception) {
                ApiResult.Fail(false, "Respuesta ilegible del registro: ${e.message}")
            }
        }
    }

    /** Guarda la zona horaria del teléfono en la ficha del técnico. */
    suspend fun updateTimezone(technicianId: String, timezone: String): ApiResult<Unit> {
        val body = JSONObject().put("timezone", timezone).toString()
        val r = execute { t ->
            restRequest(t, "technicians?id=eq.$technicianId", "PATCH", body, "return=minimal")
        }
        return when (r) {
            is ApiResult.Ok -> ApiResult.Ok(Unit)
            is ApiResult.Fail -> r.also { Log.w(TAG, "timezone: ${it.message}") }
        }
    }

    private fun kotlinx.serialization.json.JsonPrimitive.contentOrNullSafe(): String? =
        if (this is kotlinx.serialization.json.JsonNull) null else content.takeIf { it.isNotBlank() && it != "null" }
}
