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

    suspend fun runOnce(context: Context): Result {
        if (Prefs.legacyImported) return Result(false, false, false, 0, 0)

        val file = context.getDatabasePath(LEGACY_DB)
        if (!file.exists()) {
            // Instalación limpia: no hay nada que heredar.
            Prefs.legacyImported = true
            return Result(false, false, false, 0, 0)
        }

        var db: SQLiteDatabase? = null
        var result = Result(false, false, false, 0, 0)
        try {
            db = SQLiteDatabase.openDatabase(file.absolutePath, null, SQLiteDatabase.OPEN_READONLY)
            val values = readAll(db)
            if (values.isEmpty()) {
                Prefs.legacyImported = true
                return result
            }

            var gotInstall = false
            values[K_INSTALL_ID]?.takeIf { it.isNotBlank() }?.let {
                Prefs.setInstallId(it)
                gotInstall = true
            }

            var gotTech = false
            values[K_TECH_ID]?.takeIf { it.isNotBlank() }?.let {
                Prefs.technicianId = it
                gotTech = true
            }
            values[K_TECH_NAME]?.takeIf { it.isNotBlank() }?.let { Prefs.technicianName = it }
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
            Prefs.log(
                TAG,
                "Datos heredados de la versión anterior: " +
                    "dispositivo=${if (gotInstall) "sí" else "no"}, " +
                    "técnico=${if (gotTech) "sí" else "no"}, " +
                    "${locs.size} puntos y ${motions.size} eventos rescatados de la cola",
            )
        } catch (e: Exception) {
            // Nunca bloquear el arranque por la herencia: en el peor caso el
            // técnico vuelve a escanear el QR, que es el comportamiento anterior.
            Log.w(TAG, "No se pudo heredar el estado anterior: ${e.message}")
            Prefs.log(TAG, "No se pudo leer el estado de la versión anterior: ${e.message}")
        } finally {
            runCatching { db?.close() }
            Prefs.legacyImported = true
        }
        return result
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
