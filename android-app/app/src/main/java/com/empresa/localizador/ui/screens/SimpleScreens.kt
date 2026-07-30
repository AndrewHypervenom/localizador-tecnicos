package com.empresa.localizador.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.empresa.localizador.ui.WideButton
import com.empresa.localizador.ui.theme.Brand

@Composable
fun LoadingScreen() {
    Box(
        modifier = Modifier.fillMaxSize().background(Brand.Background),
        contentAlignment = Alignment.Center,
    ) {
        CircularProgressIndicator(color = Brand.Green)
    }
}

/**
 * Bloqueo total por ubicación falsa.
 *
 * No tiene botón de cierre a propósito: solo desaparece cuando las posiciones
 * vuelven a ser reales, es decir, cuando el técnico cierra la app de Fake GPS o
 * reinicia el teléfono. Mientras tanto el rastreo queda suspendido y el intento
 * ya quedó registrado en la bitácora del líder.
 */
@Composable
fun MockBlockedScreen() {
    Box(
        modifier = Modifier.fillMaxSize().background(Brand.DangerDeepBg).padding(24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .background(Brand.DangerBg)
                .padding(28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text("⛔", fontSize = 56.sp)
            Text(
                "Ubicación falsa detectada",
                color = Brand.DangerTitle,
                fontSize = 22.sp,
                fontWeight = FontWeight.ExtraBold,
                textAlign = TextAlign.Center,
            )
            Text(
                "Se detectó una aplicación que está modificando tu ubicación " +
                    "(Fake GPS / ubicación simulada).",
                color = Brand.DangerText,
                fontSize = 15.sp,
                textAlign = TextAlign.Center,
            )
            Text(
                "Para seguir usando el Localizador, cierra esa aplicación o reinicia el " +
                    "teléfono. La localización está suspendida hasta entonces.",
                color = Brand.DangerText,
                fontSize = 15.sp,
                textAlign = TextAlign.Center,
            )
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                CircularProgressIndicator(
                    color = Brand.DangerText,
                    strokeWidth = 2.dp,
                    modifier = Modifier.size(18.dp),
                )
                Text("Esperando ubicación real…", color = Brand.DangerText, fontSize = 13.sp)
            }
        }
    }
}

@Composable
fun TermsScreen(onAccept: () -> Unit) {
    Column(modifier = Modifier.fillMaxSize().background(Brand.Background)) {
        Column(
            modifier = Modifier.padding(horizontal = 24.dp, vertical = 20.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text("📍 Localizador", fontSize = 22.sp, color = Brand.TextPrimary)
            Text(
                "Términos y Condiciones",
                color = Brand.TextPrimary,
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold,
            )
            Text(
                "Léalos antes de continuar. Al aceptar, usted consiente el uso de esta aplicación.",
                color = Brand.TextDim,
                fontSize = 13.sp,
            )
        }

        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            TermsSection(
                "1. Propósito de la Aplicación",
                "Esta aplicación recopila datos de ubicación GPS del dispositivo para permitir el " +
                    "seguimiento de técnicos de campo durante su jornada laboral. El propósito es " +
                    "exclusivamente operativo: optimización de rutas, control de asistencia y " +
                    "seguridad del trabajador.",
            )
            TermsSection(
                "2. Datos que se Recopilan",
                "• Ubicación GPS (latitud, longitud, altitud)\n" +
                    "• Velocidad y dirección de desplazamiento\n" +
                    "• Nivel de batería del dispositivo\n" +
                    "• Eventos de conducción brusca detectados por el acelerómetro\n" +
                    "• Marca temporal de cada evento",
            )
            TermsSection(
                "3. Uso de los Datos",
                "Los datos recopilados son utilizados exclusivamente por la empresa contratante para:\n" +
                    "• Verificar asistencia y presencia en campo\n" +
                    "• Monitorear la seguridad del conductor\n" +
                    "• Generar reportes de actividad\n\n" +
                    "Los datos NO serán vendidos, cedidos ni compartidos con terceros ajenos a la empresa.",
            )
            TermsSection(
                "4. Localización en Segundo Plano",
                "Esta aplicación requiere permiso de ubicación en segundo plano para seguir enviando " +
                    "datos GPS incluso cuando la aplicación no está visible en pantalla. Este permiso " +
                    "es necesario para el funcionamiento correcto del sistema de monitoreo. Puede " +
                    "revocar este permiso en cualquier momento desde la configuración del dispositivo.",
            )
            TermsSection(
                "5. Almacenamiento de Datos",
                "Los datos se transmiten de forma segura mediante HTTPS a los servidores de la " +
                    "empresa. En caso de falta de conexión, los datos se almacenan temporalmente en " +
                    "el dispositivo y se sincronizan automáticamente al recuperar conectividad. Los " +
                    "datos locales son eliminados tras la sincronización exitosa.",
            )
            TermsSection(
                "6. Período de Retención",
                "Los datos de ubicación son conservados por la empresa de acuerdo a sus políticas " +
                    "internas. El técnico puede solicitar información sobre sus datos contactando " +
                    "directamente al administrador del sistema.",
            )
            TermsSection(
                "7. Aceptación",
                "Al presionar \"Acepto los Términos\", usted declara haber leído, entendido y " +
                    "aceptado las condiciones descritas. Esta aceptación es requisito para el uso " +
                    "de la aplicación.",
            )
        }

        Column(
            modifier = Modifier.padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            WideButton("Acepto los Términos", Brand.Green, onAccept)
            Text(
                "Versión 2.0 · Localizador de Técnicos",
                color = Brand.TextDim,
                fontSize = 11.sp,
            )
        }
    }
}

@Composable
private fun TermsSection(title: String, body: String) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, color = Brand.Green, fontSize = 14.sp, fontWeight = FontWeight.Bold)
        Text(body, color = Brand.TextMuted, fontSize = 13.sp, lineHeight = 20.sp)
    }
}
