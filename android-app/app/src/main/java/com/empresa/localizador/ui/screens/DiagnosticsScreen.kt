package com.empresa.localizador.ui.screens

import android.content.Intent
import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.empresa.localizador.BuildConfig
import com.empresa.localizador.data.Prefs
import com.empresa.localizador.device.DeviceState
import com.empresa.localizador.device.OemGuides
import com.empresa.localizador.net.SupabaseClient
import com.empresa.localizador.tracking.TrackingService
import com.empresa.localizador.ui.AppViewModel
import com.empresa.localizador.ui.Card
import com.empresa.localizador.ui.SectionLabel
import com.empresa.localizador.ui.WideButton
import com.empresa.localizador.ui.theme.Brand
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Diagnóstico del rastreo.
 *
 * Existe para zanjar discusiones. Reúne, en el propio teléfono, la prueba de qué
 * ha estado haciendo la app y qué del dispositivo la está estorbando, y permite
 * enviarlo tal cual al líder. Es el equivalente en el móvil a lo que el latido
 * demuestra en el servidor.
 */
@Composable
fun DiagnosticsScreen(
    state: AppViewModel.UiState,
    deviceId: String,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val log = remember { Prefs.readLog() }
    val timeFmt = remember { SimpleDateFormat("dd/MM HH:mm:ss", Locale.getDefault()) }

    val report = remember(state, log) {
        buildReport(
            deviceId = deviceId,
            state = state,
            batteryOptimized = DeviceState.isBatteryOptimized(context),
            powerSave = DeviceState.isPowerSaveMode(context),
            log = log,
            timeFmt = timeFmt,
        )
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Brand.Background)
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(
            "Diagnóstico del rastreo",
            fontSize = 22.sp,
            fontWeight = FontWeight.Bold,
            color = Brand.TextPrimary,
        )

        Card {
            SectionLabel("MOTOR DE UBICACIÓN")
            InfoRow("Servicio", if (state.serviceRunning) "En marcha" else "Detenido")
            InfoRow("Nivel de captura", tierLabel(state.tier))
            InfoRow("Satélites en uso", if (state.satellites >= 0) "${state.satellites}" else "—")
            InfoRow("Última posición", timeAgo(Prefs.lastFixTs))
            InfoRow("Sesión de rastreo", if (state.sessionActive) "Activa" else "Cerrada")
        }

        Card {
            SectionLabel("ENVÍO")
            InfoRow("Cola pendiente", "${state.queueCount} registros")
            InfoRow("Último envío correcto", timeAgo(state.lastSentTs))
            InfoRow(
                "Modo de acceso",
                if (SupabaseClient.usingAnonKeyFallback) "Clave pública (sin sesión)" else "Sesión de usuario",
            )
            state.lastError?.let { (msg, ts) ->
                InfoRow("Último error", "$msg (${timeAgo(ts)})", warn = true)
            }
        }

        Card {
            SectionLabel("QUÉ PUEDE ESTORBAR AL RASTREO")
            InfoRow(
                "Optimización de batería",
                if (DeviceState.isBatteryOptimized(context)) "ACTIVA — puede matar el rastreo" else "Desactivada",
                warn = DeviceState.isBatteryOptimized(context),
            )
            InfoRow(
                "Ahorro de energía del sistema",
                if (DeviceState.isPowerSaveMode(context)) "Encendido" else "Apagado",
                warn = DeviceState.isPowerSaveMode(context),
            )
            InfoRow(
                "Alarmas exactas",
                if (state.exactAlarmOk) "Permitidas" else "Bloqueadas — reparación más lenta",
                warn = !state.exactAlarmOk,
            )
            InfoRow("Capa del fabricante", OemGuides.guide.brand.ifBlank { "Android estándar" })
        }

        Card {
            SectionLabel("DISPOSITIVO")
            InfoRow("Modelo", "${Build.MANUFACTURER} ${Build.MODEL}")
            InfoRow("Android", "${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
            InfoRow("Versión de la app", BuildConfig.VERSION_NAME)
            InfoRow("ID de instalación", deviceId.take(8) + "…")
        }

        Card {
            SectionLabel("HISTORIAL RECIENTE")
            if (log.isEmpty()) {
                Text("Sin sucesos registrados todavía.", color = Brand.TextDim, fontSize = 13.sp)
            } else {
                log.take(40).forEach { entry ->
                    Text(
                        text = "${timeFmt.format(Date(entry.ts))}  ${entry.tag}: ${entry.msg}",
                        color = Brand.TextMuted,
                        fontSize = 11.sp,
                        fontFamily = FontFamily.Monospace,
                        lineHeight = 16.sp,
                        modifier = Modifier.padding(vertical = 1.dp),
                    )
                }
            }
        }

        WideButton(
            label = "ENVIAR ESTE INFORME",
            color = Brand.Relink,
            onClick = {
                val share = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_SUBJECT, "Diagnóstico Localizador — ${state.techName ?: "sin técnico"}")
                    putExtra(Intent.EXTRA_TEXT, report)
                }
                runCatching {
                    context.startActivity(
                        Intent.createChooser(share, "Enviar diagnóstico")
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    )
                }
            },
        )

        WideButton("Volver", Brand.SurfaceAlt, onBack)
    }
}

@Composable
private fun InfoRow(label: String, value: String, warn: Boolean = false) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Top,
    ) {
        Text(label, color = Brand.TextMuted, fontSize = 13.sp, modifier = Modifier.weight(1f))
        Text(
            value,
            color = if (warn) Brand.WarnBorder else Brand.TextPrimary,
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.weight(1f),
            textAlign = androidx.compose.ui.text.style.TextAlign.End,
        )
    }
}

private fun tierLabel(tier: String): String = when (tier) {
    "MOVING" -> "Movimiento (5 s)"
    "STATIONARY" -> "Detenido (30 s)"
    "DEEP_IDLE" -> "Reposo profundo (2 min)"
    else -> tier
}

private fun buildReport(
    deviceId: String,
    state: AppViewModel.UiState,
    batteryOptimized: Boolean,
    powerSave: Boolean,
    log: List<Prefs.LogEntry>,
    timeFmt: SimpleDateFormat,
): String = buildString {
    appendLine("DIAGNÓSTICO LOCALIZADOR PositivoS+")
    appendLine("Generado: ${timeFmt.format(Date())}")
    appendLine()
    appendLine("Técnico: ${state.techName ?: "no registrado"}")
    appendLine("Dispositivo: ${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE}")
    appendLine("App: ${BuildConfig.VERSION_NAME}")
    appendLine("ID instalación: $deviceId")
    appendLine()
    appendLine("--- ESTADO ---")
    appendLine("Servicio en marcha: ${if (state.serviceRunning) "sí" else "no"}")
    appendLine("Sesión activa: ${if (state.sessionActive) "sí" else "no"}")
    appendLine("Nivel de captura: ${tierLabel(state.tier)}")
    appendLine("GPS: ${if (state.gpsOn == true) "encendido" else "apagado"}")
    appendLine("Permiso ubicación: ${state.permLevel}")
    appendLine("Internet: ${if (state.online) state.networkType else "sin conexión"}")
    appendLine("Satélites en uso: ${if (state.satellites >= 0) state.satellites else "—"}")
    appendLine("Última posición: ${timeAgo(Prefs.lastFixTs)}")
    appendLine("Cola pendiente: ${state.queueCount}")
    appendLine("Último envío: ${timeAgo(state.lastSentTs)}")
    state.lastError?.let { appendLine("Último error: ${it.first}") }
    appendLine()
    appendLine("--- POSIBLES ESTORBOS ---")
    appendLine("Optimización de batería: ${if (batteryOptimized) "ACTIVA" else "desactivada"}")
    appendLine("Ahorro de energía: ${if (powerSave) "encendido" else "apagado"}")
    appendLine("Alarmas exactas: ${if (state.exactAlarmOk) "permitidas" else "BLOQUEADAS"}")
    appendLine()
    appendLine("--- HISTORIAL ---")
    log.take(60).forEach { appendLine("${timeFmt.format(Date(it.ts))}  ${it.tag}: ${it.msg}") }
}
