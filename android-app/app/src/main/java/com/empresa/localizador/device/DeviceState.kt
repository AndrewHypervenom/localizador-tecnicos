package com.empresa.localizador.device

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import androidx.core.content.ContextCompat

/** Nivel funcional del permiso de ubicación. */
enum class PermLevel(val wire: String) {
    /** "Permitir siempre": lo único que habilita el rastreo en segundo plano. */
    FULL("full"),

    /** "Solo mientras se usa la app": el rastreo muere al salir de la app. */
    PARTIAL("partial"),

    /** Sin permiso. */
    NONE("none");

    companion object {
        fun fromWire(s: String?): PermLevel? = entries.firstOrNull { it.wire == s }
    }
}

/** Lecturas del estado del teléfono que afectan al rastreo. */
object DeviceState {

    fun permLevel(context: Context): PermLevel {
        val fine = ContextCompat.checkSelfPermission(
            context, Manifest.permission.ACCESS_FINE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
        val coarse = ContextCompat.checkSelfPermission(
            context, Manifest.permission.ACCESS_COARSE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
        if (!fine && !coarse) return PermLevel.NONE

        // Antes de Android 10 no existe permiso separado de segundo plano: tener
        // el permiso de ubicación ya implica poder rastrear en background.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return PermLevel.FULL

        val background = ContextCompat.checkSelfPermission(
            context, Manifest.permission.ACCESS_BACKGROUND_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
        return if (background) PermLevel.FULL else PermLevel.PARTIAL
    }

    fun hasNotificationPermission(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true
        return ContextCompat.checkSelfPermission(
            context, Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
    }

    fun isGpsEnabled(context: Context): Boolean {
        val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return false
        return try {
            lm.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
                lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
        } catch (_: Exception) {
            false
        }
    }

    /**
     * ¿Hay internet utilizable? Ante la duda se responde que sí: bloquear un envío
     * por una lectura ambigua es peor que intentarlo y fallar (la cola lo conserva).
     */
    fun isOnline(context: Context): Boolean {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return true
        return try {
            val network = cm.activeNetwork ?: return false
            val caps = cm.getNetworkCapabilities(network) ?: return false
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        } catch (_: Exception) {
            true
        }
    }

    fun networkType(context: Context): String {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return "unknown"
        val caps = cm.activeNetwork?.let { cm.getNetworkCapabilities(it) } ?: return "none"
        return when {
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
            else -> "unknown"
        }
    }

    /** Nivel de batería 0-100, o null si no se puede leer. */
    fun batteryLevel(context: Context): Int? = try {
        val bm = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
        bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)?.takeIf { it in 0..100 }
    } catch (_: Exception) {
        null
    }

    fun isCharging(context: Context): Boolean? = try {
        val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val status = intent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        when (status) {
            BatteryManager.BATTERY_STATUS_CHARGING, BatteryManager.BATTERY_STATUS_FULL -> true
            -1 -> null
            else -> false
        }
    } catch (_: Exception) {
        null
    }

    /**
     * ¿El sistema está aplicando optimización de batería a esta app? Con ella
     * activa, Android suspende el proceso en Doze y el rastreo se cae.
     *
     * Ojo: esto lee la lista blanca de Android puro. En Xiaomi existe ADEMÁS una
     * capa propia (MIUI) que no es legible desde la app; ver [OemGuides].
     */
    fun isBatteryOptimized(context: Context): Boolean = try {
        val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        pm?.isIgnoringBatteryOptimizations(context.packageName)?.not() ?: true
    } catch (_: Exception) {
        true
    }

    /** ¿El sistema está en modo de ahorro de energía global? */
    fun isPowerSaveMode(context: Context): Boolean = try {
        val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        pm?.isPowerSaveMode ?: false
    } catch (_: Exception) {
        false
    }
}
