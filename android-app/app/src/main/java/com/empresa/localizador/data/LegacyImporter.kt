package com.empresa.localizador.data

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.util.Log
import com.empresa.localizador.data.db.AppDatabase
import com.empresa.localizador.data.db.LocationEntity
import com.empresa.localizador.data.db.MotionEntity
import org.json.JSONArray
import java.time.Instant

/**
 * Hereda el estado de la app React Native al actualizar en sitio.
 *
 * Como el APK nuevo comparte `applicationId` y firma con el anterior, Android lo
 * instala ENCIMA y conserva el directorio de datos. Ahí sigue el SQLite de
 * AsyncStorage (`databases/RKStorage`, tabla `catalystLocalStorage`), de donde se
 * rescata:
 *
 *  - el identificador de instalación → **ningún técnico tiene que volver a
 *    escanear el QR**;
 *  - el vínculo con el técnico, su nombre y los términos aceptados;
 *  - los avisos de fabricante ya descartados (no se repiten);
 *  - y **los puntos que quedaran sin enviar**, que se pasan a la cola nueva en
 *    vez de perderse.
 *
 * Corre una sola vez (bandera [Prefs.legacyImported]) y es tolerante a fallos: si
 * la base antigua no existe —instalación limpia— simplemente no hace nada.
 */
object LegacyImporter {

    private const val TAG = "LegacyImporter"
    private const val LEGACY_DB = "RKStorage"
    private const val TABLE = "catalystLocalStorage"

    private const val K_INSTALL_ID = "localizador:install_id"
    private const val K_TECH_ID = "@localizador/technician_id"
    private const val K_TECH_NAME = "@localizador/technician_name"
    private const val K_TERMS = "@terms_accepted_v1"
    private const val K_BATTOPT_DISMISSED = "@localizador/battopt_dismissed"
    private const val K_BATTOPT_ASKED = "@localizador/battopt_asked"
    private const val K_AUTOSTART = "@localizador/autostart_done"
    private const val K_GPS_STATE = "@localizador/gps_state"
    private const val K_NET_STATE = "@localizador/net_state"
    private const val K_BATTOPT_STATE = "@localizador/battopt_state"
    private const val K_PERM_STATE = "@localizador/perm_state"
    private const val K_LAST_FIX = "@localizador/last_fix_ts"
    private const val K_LOC_QUEUE = "@localizador/location_queue"
    private const val K_MOTION_QUEUE = "@localizador/motion_queue"

    private val POINT_RE = Regex("""POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)""")

    data class Result(
        val inherited: Boolean,
        val installId: Boolean,
        val technician: Boolean,
        val locationsImported: Int,
        val motionsImported: Int,
    )

    /**
     * Tras agotarlos se da la herencia por imposible y se deja de reintentar. Son
     * arranques de la app, no minutos: llegar a tres significa que la base antigua
     * está definitivamente ilegible, no que hubo mala suerte una vez.
     */
    private const val MAX_ATTEMPTS = 3

    suspend fun runOnce(context: Context): Result {
        if (Prefs.legacyImported) return Result(false, false, false, 0, 0)

        val file = context.getDatabasePath(LEGACY_DB)
        if (!file.exists()) {
            // Instalación limpia: no hay nada que heredar.
            Prefs.legacyImported = true
            return Result(false, false, false, 0, 0)
        }

        // Leer la base antigua es lo ÚNICO que puede fallar de forma recuperable, así
        // que se hace aparte: si sale bien, lo que viene después es trabajo en
        // memoria y sobre las preferencias, y ya no puede dejar la herencia a medias.
        val attempt = Prefs.legacyImportAttempts + 1
        Prefs.legacyImportAttempts = attempt

        val values = try {
            readLegacyValues(file)
        } catch (e: Exception) {
            // ANTES este fallo marcaba la herencia como hecha y el técnico perdía el
            // vínculo para siempre. Un cierre a la fuerza —justo lo que hacen las
            // capas de Xiaomi y Samsung— deja la base con un diario sin reproducir y
            // la primera lectura falla, aunque al siguiente arranque funcione.
            val reason = e.message ?: e::class.java.simpleName
            return giveUpOrRetry(attempt, reason)
        }

        var result = Result(false, false, false, 0, 0)
        try {
            if (values.isEmpty()) {
                // La base existe pero está vacía: no hay nada que rescatar y
                // reintentar no cambiaría el resultado.
                Prefs.legacyImported = true
                Prefs.log(TAG, "La versión anterior no tenía datos que heredar")
                return result
            }

            // Si el teléfono YA tiene identidad propia y un técnico vinculado, no se
            // pisa. El caso que esto evita lo abre el reintento: falla el primer
            // intento, el técnico ve "No registrado" y escanea el QR (con lo que se
            // acuña una identidad nueva y queda vinculado), y al siguiente arranque
            // el segundo intento sale bien y le devolvería la identidad vieja,
            // desvinculándolo otra vez. En la migración normal ninguna de las dos
            // condiciones se cumple, así que la herencia se aplica entera.
            val yaVinculado = Prefs.hasInstallId() && Prefs.technicianId != null

            var gotInstall = false
            values[K_INSTALL_ID]?.takeIf { it.isNotBlank() }?.let {
                if (yaVinculado) {
                    Prefs.log(TAG, "Se conserva el vínculo actual del teléfono; no se sobrescribe con el de la versión anterior")
                } else {
                    Prefs.setInstallId(it)
                }
                gotInstall = true
            }

            // Mismo criterio que con la identidad: la sesión de rastreo en curso
            // manda sobre la heredada.
            var gotTech = false
            values[K_TECH_ID]?.takeIf { it.isNotBlank() }?.let {
                if (!yaVinculado) Prefs.technicianId = it
                gotTech = true
            }
            values[K_TECH_NAME]?.takeIf { it.isNotBlank() }?.let {
                if (!yaVinculado) Prefs.technicianName = it
            }
            if (values[K_TERMS] == "true") Prefs.termsAccepted = true

            if (values[K_BATTOPT_DISMISSED] == "1") Prefs.battOptDismissed = true
            if (values[K_BATTOPT_ASKED] == "1") Prefs.battOptAsked = true
            if (values[K_AUTOSTART] == "1") Prefs.autostartDone = true

            values[K_GPS_STATE]?.let { Prefs.gpsState = it == "1" }
            values[K_NET_STATE]?.let { Prefs.netState = it == "1" }
            values[K_BATTOPT_STATE]?.let { Prefs.battOptState = it == "1" }
            values[K_PERM_STATE]?.takeIf { it in setOf("full", "partial", "none") }
                ?.let { Prefs.permState = it }
            values[K_LAST_FIX]?.toLongOrNull()?.let { Prefs.lastFixTs = it }

            val dao = AppDatabase.get(context).queueDao()
            val locs = parseLocationQueue(values[K_LOC_QUEUE])
            if (locs.isNotEmpty()) dao.insertLocations(locs)
            val motions = parseMotionQueue(values[K_MOTION_QUEUE])
            if (motions.isNotEmpty()) dao.insertMotions(motions)

            result = Result(true, gotInstall, gotTech, locs.size, motions.size)

            // La identidad del dispositivo es lo único cuya ausencia obliga a volver
            // a escanear el QR. Si la base antigua se leyó pero no la traía, hay que
            // decirlo: es la diferencia entre "la app te mandó a escanear sin motivo"
            // y un dato concreto que el líder puede consultar.
            if (gotInstall) {
                Prefs.legacyImportFailure = null
            } else {
                Prefs.legacyImportFailure =
                    "La versión anterior no tenía guardado el identificador del dispositivo"
                Prefs.log(TAG, "Herencia sin identificador de dispositivo: hará falta escanear el QR")
            }

            Prefs.log(
                TAG,
                "Datos heredados de la versión anterior: " +
                    "dispositivo=${if (gotInstall) "sí" else "no"}, " +
                    "técnico=${if (gotTech) "sí" else "no"}, " +
                    "${locs.size} puntos y ${motions.size} eventos rescatados de la cola",
            )
        } catch (e: Exception) {
            // Los valores ya están leídos; lo que falle aquí es al guardarlos. No se
            // reintenta —se habrían aplicado a medias— pero sí queda constancia.
            Log.w(TAG, "No se pudo aplicar el estado anterior: ${e.message}")
            Prefs.legacyImportFailure = "No se pudo aplicar el estado anterior: ${e.message}"
            Prefs.log(TAG, "No se pudo aplicar el estado de la versión anterior: ${e.message}")
        } finally {
            Prefs.legacyImported = true
        }
        return result
    }

    /**
     * Marca el fallo como definitivo o lo deja abierto a otro intento.
     *
     * Mientras queden intentos NO se toca [Prefs.legacyImported]: el siguiente
     * arranque volverá a probar, que es lo que rescata el caso habitual de una base
     * que quedó sucia por un cierre a la fuerza.
     */
    private fun giveUpOrRetry(attempt: Int, reason: String): Result {
        if (attempt >= MAX_ATTEMPTS) {
            Prefs.legacyImported = true
            Prefs.legacyImportFailure =
                "No se pudo leer la instalación anterior tras $MAX_ATTEMPTS intentos: $reason"
            Log.w(TAG, "Herencia abandonada tras $attempt intentos: $reason")
            Prefs.log(TAG, "Herencia abandonada tras $attempt intentos ($reason); hará falta escanear el QR")
        } else {
            Prefs.legacyImportFailure =
                "No se pudo leer la instalación anterior (intento $attempt de $MAX_ATTEMPTS): $reason"
            Log.w(TAG, "Herencia fallida (intento $attempt), se reintentará: $reason")
            Prefs.log(TAG, "No se pudo leer la instalación anterior (intento $attempt); se reintentará al abrir de nuevo")
        }
        return Result(false, false, false, 0, 0)
    }

    /**
     * Abre la base de AsyncStorage y vuelca sus claves.
     *
     * Se intenta primero en LECTURA-ESCRITURA aunque solo se vaya a leer, y no es un
     * descuido: cuando el proceso anterior murió a mitad de una escritura, SQLite
     * deja un diario pendiente y **la recuperación exige permiso de escritura**.
     * Abriendo en solo-lectura esa base falla con "attempt to write a readonly
     * database" — precisamente en los teléfonos que más cierres a la fuerza sufren,
     * que son los que motivaron todo esto. La apertura en solo-lectura queda como
     * respaldo por si el archivo no admite escritura.
     */
    private fun readLegacyValues(file: java.io.File): Map<String, String> {
        var db: SQLiteDatabase? = null
        try {
            db = try {
                SQLiteDatabase.openDatabase(file.absolutePath, null, SQLiteDatabase.OPEN_READWRITE)
            } catch (e: Exception) {
                Log.w(TAG, "Apertura en escritura rechazada (${e.message}); se intenta en solo lectura")
                SQLiteDatabase.openDatabase(file.absolutePath, null, SQLiteDatabase.OPEN_READONLY)
            }
            return readAll(db)
        } finally {
            runCatching { db?.close() }
        }
    }

    private fun readAll(db: SQLiteDatabase): Map<String, String> {
        val out = HashMap<String, String>()
        db.rawQuery("SELECT key, value FROM $TABLE", null).use { c ->
            val kIdx = c.getColumnIndexOrThrow("key")
            val vIdx = c.getColumnIndexOrThrow("value")
            while (c.moveToNext()) {
                val k = c.getString(kIdx) ?: continue
                out[k] = c.getString(vIdx) ?: continue
            }
        }
        return out
    }

    /** Convierte el array JSON de la cola antigua en filas de Room. */
    private fun parseLocationQueue(raw: String?): List<LocationEntity> {
        if (raw.isNullOrBlank()) return emptyList()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).mapNotNull { i ->
                val o = arr.optJSONObject(i) ?: return@mapNotNull null
                val techId = o.optString("technician_id").takeIf { it.isNotBlank() }
                    ?: return@mapNotNull null
                val (lng, lat) = parsePoint(o.optString("location")) ?: return@mapNotNull null
                LocationEntity(
                    technicianId = techId,
                    tsMillis = parseIso(o.optString("ts")) ?: return@mapNotNull null,
                    lat = lat,
                    lng = lng,
                    speed = o.optDoubleOrNull("speed"),
                    altitude = o.optDoubleOrNull("altitude"),
                    bearing = o.optDoubleOrNull("bearing"),
                    accuracy = o.optDoubleOrNull("accuracy"),
                    batteryLevel = o.optDoubleOrNull("battery_level")?.toInt(),
                    charging = if (o.isNull("charging")) null else o.optBoolean("charging"),
                )
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun parseMotionQueue(raw: String?): List<MotionEntity> {
        if (raw.isNullOrBlank()) return emptyList()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).mapNotNull { i ->
                val o = arr.optJSONObject(i) ?: return@mapNotNull null
                val techId = o.optString("technician_id").takeIf { it.isNotBlank() }
                    ?: return@mapNotNull null
                val point = parsePoint(o.optString("location"))
                MotionEntity(
                    technicianId = techId,
                    tsMillis = parseIso(o.optString("ts")) ?: return@mapNotNull null,
                    eventType = o.optString("event_type").takeIf { it.isNotBlank() }
                        ?: return@mapNotNull null,
                    severity = o.optDouble("severity", 0.0),
                    lat = point?.second,
                    lng = point?.first,
                )
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    /** "POINT(lng lat)" → (lng, lat) */
    private fun parsePoint(wkt: String?): Pair<Double, Double>? {
        if (wkt.isNullOrBlank()) return null
        val m = POINT_RE.find(wkt) ?: return null
        val lng = m.groupValues[1].toDoubleOrNull() ?: return null
        val lat = m.groupValues[2].toDoubleOrNull() ?: return null
        return lng to lat
    }

    private fun parseIso(s: String?): Long? {
        if (s.isNullOrBlank()) return null
        return try {
            Instant.parse(s).toEpochMilli()
        } catch (_: Exception) {
            null
        }
    }

    private fun org.json.JSONObject.optDoubleOrNull(name: String): Double? =
        if (isNull(name)) null else optDouble(name).takeIf { !it.isNaN() }
}
