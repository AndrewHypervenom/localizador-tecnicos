package com.empresa.localizador.ui.screens

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.empresa.localizador.R
import com.empresa.localizador.device.OemGuides
import com.empresa.localizador.device.PermLevel
import com.empresa.localizador.ui.AppViewModel
import com.empresa.localizador.ui.Banner
import com.empresa.localizador.ui.Card
import com.empresa.localizador.ui.SectionLabel
import com.empresa.localizador.ui.StatusRow
import com.empresa.localizador.ui.WideButton
import com.empresa.localizador.ui.theme.Brand

@Composable
fun HomeScreen(
    state: AppViewModel.UiState,
    viewModel: AppViewModel,
    onRequestPermissions: () -> Unit,
) {
    val context = LocalContext.current

    val gpsBad = state.gpsOn == false
    val permBad = state.permLevel == PermLevel.NONE || state.permLevel == PermLevel.PARTIAL
    val netBad = !state.online
    val tracking = state.sessionActive
    val trackingBroken = tracking && (gpsBad || permBad || netBad)

    // Con el envío por lotes siempre hay unos pocos registros en cola entre un
    // vaciado y el siguiente: eso es normal. Solo se avisa cuando la cola crece
    // muy por encima de lo habitual, señal de un atasco real.
    val queueBacklog = state.queueCount > 50
    val hasError = state.lastError != null

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Brand.Background)
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        // ── Cabecera ──
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Image(
                painter = painterResource(R.drawable.logo),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.size(56.dp).clip(RoundedCornerShape(14.dp)),
            )
            Column {
                Text("Localizador", fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Brand.TextPrimary)
                Text("PositivoS+", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Brand.Green)
            }
        }

        // ── Técnico ──
        Card {
            SectionLabel("TÉCNICO")
            Text(
                text = state.techName ?: "No registrado",
                fontSize = 18.sp,
                fontWeight = FontWeight.SemiBold,
                color = Brand.TextPrimary,
            )
        }

        // ── Estado del rastreo ──
        val statusColor = when {
            trackingBroken -> Brand.WarnBorder
            tracking -> Brand.Green
            else -> Brand.TextDim
        }
        Card(accent = statusColor) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Box(Modifier.size(10.dp).clip(CircleShape).background(statusColor))
                Text(
                    text = when {
                        trackingBroken -> "Localización con fallas"
                        tracking -> "Localizando"
                        else -> "Inactivo"
                    },
                    fontSize = 17.sp,
                    fontWeight = FontWeight.Bold,
                    color = if (trackingBroken) Brand.WarnText else if (tracking) Brand.Green else Brand.TextMuted,
                )
            }
        }

        // ── Avisos ──
        if (trackingBroken) {
            Banner(
                title = "LA LOCALIZACIÓN NO ESTÁ FUNCIONANDO",
                message = listOfNotNull(
                    "GPS desactivado".takeIf { gpsBad },
                    "Permiso de ubicación incompleto".takeIf { permBad },
                    "Sin conexión a internet".takeIf { netBad },
                ).joinToString(" · ") +
                    "\nTu ubicación NO se está enviando. Reactiva lo indicado.",
            )
        }

        if (permBad) {
            Banner(
                title = "FALTA EL PERMISO \"PERMITIR SIEMPRE\"",
                message = if (state.permLevel == PermLevel.NONE) {
                    "No has dado permiso de ubicación. La app SÍ funciona, pero no puede rastrear sin este permiso."
                } else {
                    "Tienes la ubicación en \"Solo en uso\". La app SÍ funciona, pero el rastreo necesita \"Permitir siempre\"."
                },
                danger = state.permLevel == PermLevel.NONE,
                primaryLabel = "ARREGLAR — Abrir Ajustes",
                onPrimary = { OemGuides.openAppDetails(context) },
            )
        }

        state.batteryGuard?.takeIf { it.needsAttention }?.let { guard ->
            Banner(
                title = "BATERÍA: PON \"SIN RESTRICCIONES\"",
                message = if (guard.xiaomi) {
                    "En \"Ahorro de batería\" el teléfono cierra el rastreo. Debe quedar en \"Sin restricciones\"."
                } else {
                    "La app está optimizada por batería. Permite que se ejecute sin restricciones para no perder el rastreo."
                },
                primaryLabel = "ABRIR AJUSTES",
                onPrimary = { OemGuides.openBatterySettings(context) },
                secondaryLabel = "Ya está configurado".takeIf { guard.canDismiss },
                onSecondary = viewModel::dismissBatteryGuard.takeIf { guard.canDismiss },
            )
        }

        state.autostart?.takeIf { it.needed && !it.dismissed }?.let { guide ->
            Banner(
                title = "ACTIVA EL \"INICIO AUTOMÁTICO\"",
                message = "En ${guide.brand} el teléfono corta el rastreo en segundo plano si la app " +
                    "no tiene \"Inicio automático\".\n\n${guide.steps}",
                primaryLabel = "ABRIR AJUSTES",
                onPrimary = { OemGuides.openAutostartSettings(context) },
                secondaryLabel = "Ya lo activé",
                onSecondary = viewModel::dismissAutostart,
            )
        }

        // Aviso propio de esta versión: sin alarmas exactas, la reparación
        // automática del rastreo pierde su vía más fiable.
        if (!state.exactAlarmOk) {
            Banner(
                title = "PERMITE LAS ALARMAS EXACTAS",
                message = "Sin este permiso, si el teléfono cierra el rastreo la app tarda más en " +
                    "recuperarlo. Actívalo para que se repare al instante.",
                primaryLabel = "ACTIVAR",
                onPrimary = { OemGuides.openExactAlarmSettings(context) },
            )
        }

        // ── Estado del dispositivo ──
        Card {
            SectionLabel("ESTADO DEL DISPOSITIVO")
            StatusRow(
                icon = Icons.Filled.LocationOn,
                label = "GPS",
                value = when (state.gpsOn) {
                    null -> "…"
                    true -> "Activado"
                    false -> "Desactivado"
                },
                ok = state.gpsOn != false,
            )
            StatusRow(
                icon = Icons.Filled.CheckCircle,
                label = "Permiso de ubicación",
                value = when (state.permLevel) {
                    null -> "…"
                    PermLevel.FULL -> "Siempre"
                    PermLevel.PARTIAL -> "Solo en uso"
                    PermLevel.NONE -> "Denegado"
                },
                ok = state.permLevel == PermLevel.FULL,
            )
            StatusRow(
                icon = Icons.Filled.Refresh,
                label = "Internet",
                value = if (state.online) when (state.networkType) {
                    "wifi" -> "Wi-Fi"
                    "cellular" -> "Datos móviles"
                    "ethernet" -> "Ethernet"
                    else -> "Conectado"
                } else "Sin conexión",
                ok = state.online,
            )
        }

        // ── Estado de conexión ──
        Card {
            SectionLabel("ESTADO DE CONEXIÓN")
            DiagRow("Último envío", timeAgo(state.lastSentTs), warn = state.lastSentTs == 0L)
            DiagRow(
                "Cola pendiente",
                if (state.queueCount > 0) "${state.queueCount} registros" else "Al día",
                warn = queueBacklog,
            )
            state.lastError?.let { (msg, ts) ->
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(Brand.DangerDeepBg)
                        .padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text("⚠ Error de envío", color = Brand.DangerText, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    Text(msg, color = Brand.DangerText, fontSize = 12.sp)
                    Text(timeAgo(ts), color = Brand.DangerBorder, fontSize = 11.sp)
                }
            }
        }

        // ── Acciones ──
        if (queueBacklog || hasError) {
            WideButton(
                label = "Forzar Sincronización (${state.queueCount})",
                color = Brand.Sync,
                onClick = viewModel::forceSync,
                loading = state.syncing,
            )
        }

        if (state.techName != null) {
            WideButton("🆘 ENVIAR SOS", Brand.Sos, viewModel::confirmSos)
        }

        WideButton(
            label = if (tracking) "DETENER LOCALIZACIÓN" else "INICIAR LOCALIZACIÓN",
            color = if (tracking) Brand.Stop else Brand.GreenDark,
            onClick = { viewModel.toggleTracking(onNeedsPermissions = onRequestPermissions) },
            loading = state.busy,
        )

        if (state.techName == null) {
            WideButton("VINCULAR DISPOSITIVO (ESCANEAR QR)", Brand.Relink, viewModel::goToRegister)
        } else {
            Text(
                text = "¿Apareces como \"No registrado\" aunque sí lo estás? Vuelve a vincular",
                color = Brand.Link,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                textAlign = TextAlign.Center,
                textDecoration = TextDecoration.Underline,
                modifier = Modifier.clickable { viewModel.goToRegister() },
            )
        }

        Text(
            text = "Ver diagnóstico del rastreo",
            color = Brand.TextMuted,
            fontSize = 13.sp,
            textDecoration = TextDecoration.Underline,
            modifier = Modifier.clickable { viewModel.goToDiagnostics() }.padding(top = 4.dp),
        )
    }
}

@Composable
private fun DiagRow(label: String, value: String, warn: Boolean = false) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, color = Brand.TextMuted, fontSize = 13.sp)
        Text(
            value,
            color = if (warn) Brand.WarnBorder else Brand.TextPrimary,
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

internal fun timeAgo(ts: Long): String {
    if (ts <= 0L) return "Nunca"
    val secs = (System.currentTimeMillis() - ts) / 1000
    return when {
        secs < 60 -> "hace ${secs}s"
        secs < 3600 -> "hace ${secs / 60}m"
        secs < 86_400 -> "hace ${secs / 3600}h"
        else -> "hace ${secs / 86_400}d"
    }
}
