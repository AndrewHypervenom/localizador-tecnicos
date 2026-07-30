package com.empresa.localizador.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * Identidad visual heredada de la app anterior: los técnicos ya reconocen este
 * verde y este fondo, así que se conservan exactamente. Lo que cambia es que
 * ahora son componentes nativos, con la respuesta táctil y las transiciones del
 * sistema.
 */
object Brand {
    val Green = Color(0xFF00D632)
    val GreenDark = Color(0xFF00B82B)
    val Background = Color(0xFF0A0A14)
    val Surface = Color(0xFF141420)
    val SurfaceAlt = Color(0xFF1E1E2E)

    val TextPrimary = Color(0xFFF8FAFC)
    val TextMuted = Color(0xFF94A3B8)
    val TextDim = Color(0xFF64748B)

    val WarnBg = Color(0xFF3A2206)
    val WarnBorder = Color(0xFFF59E0B)
    val WarnTitle = Color(0xFFFDE68A)
    val WarnText = Color(0xFFFBBF24)

    val DangerBg = Color(0xFF3A0A0A)
    val DangerDeepBg = Color(0xFF2A0505)
    val DangerBorder = Color(0xFFEF4444)
    val DangerText = Color(0xFFFCA5A5)
    val DangerTitle = Color(0xFFFECACA)
    val Stop = Color(0xFFDC2626)
    val Sos = Color(0xFFB91C1C)

    val Sync = Color(0xFF7B2FF7)
    val Link = Color(0xFF60A5FA)
    val Relink = Color(0xFF2563EB)
}

private val colorScheme = darkColorScheme(
    primary = Brand.Green,
    onPrimary = Color(0xFF06210D),
    secondary = Brand.GreenDark,
    background = Brand.Background,
    onBackground = Brand.TextPrimary,
    surface = Brand.Surface,
    onSurface = Brand.TextPrimary,
    surfaceVariant = Brand.SurfaceAlt,
    onSurfaceVariant = Brand.TextMuted,
    error = Brand.DangerBorder,
    onError = Color.White,
)

private val typography = Typography(
    titleLarge = TextStyle(fontSize = 24.sp, fontWeight = FontWeight.Bold),
    titleMedium = TextStyle(fontSize = 18.sp, fontWeight = FontWeight.SemiBold),
    bodyLarge = TextStyle(fontSize = 15.sp, lineHeight = 22.sp),
    bodyMedium = TextStyle(fontSize = 13.sp, lineHeight = 19.sp),
    labelSmall = TextStyle(fontSize = 11.sp, letterSpacing = 1.2.sp, fontWeight = FontWeight.Medium),
)

@Composable
fun LocalizadorTheme(
    @Suppress("UNUSED_PARAMETER") darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    // Siempre oscuro: la app se usa a plena luz y en cabina, y el contraste alto
    // sobre fondo oscuro es lo que mejor se lee en ambas.
    MaterialTheme(
        colorScheme = colorScheme,
        typography = typography,
        content = content,
    )
}
