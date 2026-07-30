package com.empresa.localizador.device

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import com.empresa.localizador.data.Prefs

/**
 * Capas de fabricante: la causa número uno de que el rastreo se caiga.
 *
 * Varias capas (MIUI, EMUI, ColorOS, Funtouch, One UI) matan los servicios en
 * segundo plano salvo que la app tenga activado el "inicio automático" y quede en
 * "sin restricciones" de batería. Esos ajustes **no tienen API pública**: no se
 * pueden leer ni cambiar desde la app. Lo máximo posible es abrir la pantalla
 * exacta y explicar qué tocar, que es lo que se hace aquí.
 */
object OemGuides {

    private const val TAG = "OemGuides"

    enum class Oem { XIAOMI, HUAWEI, OPPO, VIVO, SAMSUNG, OTHER }

    val oem: Oem by lazy {
        val s = "${Build.MANUFACTURER.orEmpty()} ${Build.BRAND.orEmpty()}".lowercase()
        when {
            Regex("xiaomi|redmi|poco").containsMatchIn(s) -> Oem.XIAOMI
            Regex("huawei|honor").containsMatchIn(s) -> Oem.HUAWEI
            Regex("oppo|realme|oneplus|coloros").containsMatchIn(s) -> Oem.OPPO
            Regex("vivo|iqoo").containsMatchIn(s) -> Oem.VIVO
            Regex("samsung").containsMatchIn(s) -> Oem.SAMSUNG
            else -> Oem.OTHER
        }
    }

    val isXiaomi: Boolean get() = oem == Oem.XIAOMI

    data class Guide(val brand: String, val steps: String)

    val guide: Guide
        get() = when (oem) {
            Oem.XIAOMI -> Guide(
                "Xiaomi / Redmi / POCO",
                "Seguridad › Permisos › Inicio automático: activa \"Localizador\". " +
                    "Además, Batería › \"Sin restricciones\".",
            )
            Oem.HUAWEI -> Guide(
                "Huawei / Honor",
                "Ajustes › Batería › Inicio de aplicaciones › Localizador: pásalo a " +
                    "\"Gestionar manualmente\" y activa \"Inicio automático\", " +
                    "\"Inicio secundario\" y \"Ejecutar en segundo plano\".",
            )
            Oem.OPPO -> Guide(
                "OPPO / Realme / OnePlus",
                "Ajustes › Batería / Apps › Inicio automático: permite el inicio de " +
                    "\"Localizador\" y fíjala (candado) en la pantalla de Recientes.",
            )
            Oem.VIVO -> Guide(
                "vivo / iQOO",
                "iManager › Gestión de apps › Inicio automático: activa \"Localizador\". " +
                    "Permite también \"Consumo alto en segundo plano\".",
            )
            Oem.SAMSUNG -> Guide(
                "Samsung",
                "Ajustes › Batería › Límites de uso en segundo plano: quita \"Localizador\" " +
                    "de \"Apps en suspensión\" y no la pongas en suspensión automática.",
            )
            Oem.OTHER -> Guide("", "")
        }

    // ── Estado del aviso de batería ──────────────────────────────────────────

    data class BatteryGuard(
        /** ¿Hay que mostrar el aviso? */
        val needsAttention: Boolean,
        /** ¿Se ofrece el botón "ya está configurado"? (solo donde no se puede leer) */
        val canDismiss: Boolean,
        val xiaomi: Boolean,
    )

    /**
     * En Android estándar se lee la lista blanca del sistema y el aviso desaparece
     * solo al quedar exenta. En Xiaomi **no hay forma de leer** la capa MIUI, así
     * que el aviso se mantiene hasta que el técnico confirme —y vuelve a aparecer
     * si se detecta que el rastreo se cayó igualmente, porque entonces está claro
     * que no se configuró.
     */
    fun batteryGuard(context: Context): BatteryGuard {
        if (isXiaomi) {
            return BatteryGuard(
                needsAttention = !Prefs.battOptDismissed,
                canDismiss = true,
                xiaomi = true,
            )
        }
        return BatteryGuard(
            needsAttention = DeviceState.isBatteryOptimized(context),
            canDismiss = false,
            xiaomi = false,
        )
    }

    data class AutostartGuide(
        val needed: Boolean,
        val dismissed: Boolean,
        val brand: String,
        val steps: String,
    )

    fun autostartGuide(): AutostartGuide {
        val g = guide
        return AutostartGuide(
            needed = oem != Oem.OTHER,
            dismissed = Prefs.autostartDone,
            brand = g.brand,
            steps = g.steps,
        )
    }

    // ── Apertura de pantallas del sistema ────────────────────────────────────

    private fun tryStart(context: Context, intent: Intent): Boolean = try {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        true
    } catch (e: Exception) {
        Log.d(TAG, "No existe esa pantalla en este equipo: ${e.message}")
        false
    }

    /** Pantalla para quitar la restricción de batería. */
    fun openBatterySettings(context: Context): Boolean {
        val pkg = context.packageName

        // En Xiaomi, llevar directo a la pantalla "sin restricciones" de MIUI: el
        // ajuste estándar de Android no afecta a su capa propia.
        if (isXiaomi) {
            val miui = listOf(
                Intent().setComponent(
                    ComponentName(
                        "com.miui.powerkeeper",
                        "com.miui.powerkeeper.ui.HiddenAppsConfigActivity",
                    )
                ).putExtra("package_name", pkg).putExtra("package_label", "Localizador"),
                Intent().setComponent(
                    ComponentName(
                        "com.miui.powerkeeper",
                        "com.miui.powerkeeper.ui.HiddenAppsContainerManagementActivity",
                    )
                ),
            )
            for (i in miui) if (tryStart(context, i)) return true
        }

        @Suppress("BatteryLife")
        val request = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
            .setData(Uri.parse("package:$pkg"))
        if (tryStart(context, request)) return true

        if (tryStart(context, Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))) return true

        return openAppDetails(context)
    }

    /** Pantalla de "inicio automático" del fabricante. */
    fun openAutostartSettings(context: Context): Boolean {
        val targets: List<Pair<String, String>> = when (oem) {
            Oem.XIAOMI -> listOf(
                "com.miui.securitycenter" to "com.miui.permcenter.autostart.AutoStartManagementActivity",
            )
            Oem.HUAWEI -> listOf(
                "com.huawei.systemmanager" to "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity",
                "com.huawei.systemmanager" to "com.huawei.systemmanager.optimize.process.ProtectActivity",
            )
            Oem.OPPO -> listOf(
                "com.coloros.safecenter" to "com.coloros.safecenter.startupapp.StartupAppListActivity",
                "com.coloros.safecenter" to "com.coloros.safecenter.permission.startup.StartupAppListActivity",
                "com.oppo.safe" to "com.oppo.safe.permission.startup.StartupAppListActivity",
            )
            Oem.VIVO -> listOf(
                "com.vivo.permissionmanager" to "com.vivo.permissionmanager.activity.BgStartUpManagerActivity",
                "com.iqoo.secure" to "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager",
            )
            Oem.SAMSUNG -> listOf(
                "com.samsung.android.lool" to "com.samsung.android.sm.ui.battery.BatteryActivity",
            )
            Oem.OTHER -> emptyList()
        }

        for ((pkg, cls) in targets) {
            if (tryStart(context, Intent().setComponent(ComponentName(pkg, cls)))) return true
        }
        return openAppDetails(context)
    }

    /** Ficha de la app en Ajustes: desde ahí se llega a permisos y batería. */
    fun openAppDetails(context: Context): Boolean = tryStart(
        context,
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
            .setData(Uri.parse("package:${context.packageName}")),
    )

    fun openLocationSettings(context: Context): Boolean =
        tryStart(context, Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))

    /** Pantalla para conceder alarmas exactas (Android 12+). */
    fun openExactAlarmSettings(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return false
        return tryStart(
            context,
            Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM)
                .setData(Uri.parse("package:${context.packageName}")),
        )
    }

    /**
     * Pide una sola vez la exención de batería al iniciar el rastreo. Si un MDM ya
     * la concedió, no molesta a nadie.
     */
    fun ensureBatteryExemptionOnce(context: Context) {
        if (!DeviceState.isBatteryOptimized(context) && !isXiaomi) return
        if (Prefs.battOptAsked) return
        Prefs.battOptAsked = true
        openBatterySettings(context)
    }
}
