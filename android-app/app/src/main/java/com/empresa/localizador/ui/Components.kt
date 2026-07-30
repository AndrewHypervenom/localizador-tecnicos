package com.empresa.localizador.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.empresa.localizador.ui.theme.Brand

/** Diálogo único de la app: informativo o de confirmación. */
@Composable
fun AppDialog(dialog: AppViewModel.Dialog, onDismiss: () -> Unit) {
    when (dialog) {
        is AppViewModel.Dialog.Info -> AlertDialog(
            onDismissRequest = onDismiss,
            title = { Text(dialog.title, fontWeight = FontWeight.Bold) },
            text = { Text(dialog.body, color = Brand.TextMuted) },
            confirmButton = {
                TextButton(onClick = onDismiss) { Text("Entendido", color = Brand.Green) }
            },
            containerColor = Brand.Surface,
            titleContentColor = Brand.TextPrimary,
        )

        is AppViewModel.Dialog.Confirm -> AlertDialog(
            onDismissRequest = onDismiss,
            title = { Text(dialog.title, fontWeight = FontWeight.Bold) },
            text = { Text(dialog.body, color = Brand.TextMuted) },
            confirmButton = {
                TextButton(onClick = dialog.onConfirm) {
                    Text(dialog.confirmLabel, color = Brand.Green, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = onDismiss) { Text("Cancelar", color = Brand.TextMuted) }
            },
            containerColor = Brand.Surface,
            titleContentColor = Brand.TextPrimary,
        )
    }
}

/**
 * Tarjeta base del diseño. El borde de color a la izquierda es el mismo recurso
 * visual que usaba la app anterior para señalar el estado del rastreo.
 */
@Composable
fun Card(
    modifier: Modifier = Modifier,
    accent: Color? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Brand.Surface)
            .height(IntrinsicSize.Min),
    ) {
        if (accent != null) {
            Box(
                Modifier
                    .width(3.dp)
                    .fillMaxHeight()
                    .background(accent)
            )
        }
        Column(
            modifier = Modifier
                .weight(1f)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
            content = content,
        )
    }
}

/** Etiqueta pequeña en mayúsculas, como en la app anterior. */
@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        color = Brand.TextDim,
        fontSize = 11.sp,
        letterSpacing = 1.2.sp,
        fontWeight = FontWeight.Medium,
        modifier = modifier,
    )
}

/** Fila de estado con icono, etiqueta y valor. */
@Composable
fun StatusRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    value: String,
    ok: Boolean,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = if (ok) Brand.Green else Brand.DangerBorder,
                modifier = Modifier.size(18.dp),
            )
            Text(
                text = label,
                color = Brand.TextMuted,
                fontSize = 13.sp,
                modifier = Modifier.padding(start = 10.dp),
            )
        }
        Text(
            text = value,
            color = if (ok) Brand.TextPrimary else Brand.DangerBorder,
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

/**
 * Aviso destacado. Deliberadamente grande y con el borde de color: tiene que
 * seguir siendo legible en una captura de pantalla recortada, porque es la prueba
 * de qué estaba mal configurado en el teléfono.
 */
@Composable
fun Banner(
    title: String,
    message: String,
    danger: Boolean = false,
    primaryLabel: String? = null,
    onPrimary: (() -> Unit)? = null,
    secondaryLabel: String? = null,
    onSecondary: (() -> Unit)? = null,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(if (danger) Brand.DangerBg else Brand.WarnBg)
            .border(
                width = 1.dp,
                color = if (danger) Brand.DangerBorder else Brand.WarnBorder,
                shape = RoundedCornerShape(12.dp),
            )
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                imageVector = Icons.Filled.Warning,
                contentDescription = null,
                tint = if (danger) Brand.DangerText else Brand.WarnText,
                modifier = Modifier.size(20.dp),
            )
            Text(
                text = title,
                color = if (danger) Brand.DangerTitle else Brand.WarnTitle,
                fontSize = 13.sp,
                fontWeight = FontWeight.ExtraBold,
                modifier = Modifier.padding(start = 10.dp),
            )
        }
        Text(
            text = message,
            color = if (danger) Brand.DangerText else Brand.WarnText,
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
        )
        if (primaryLabel != null || secondaryLabel != null) {
            Row(
                modifier = Modifier.padding(top = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (primaryLabel != null && onPrimary != null) {
                    Button(
                        onClick = onPrimary,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Brand.Green,
                            contentColor = Color(0xFF06210D),
                        ),
                        shape = RoundedCornerShape(8.dp),
                    ) {
                        Text(primaryLabel, fontSize = 13.sp, fontWeight = FontWeight.ExtraBold)
                    }
                }
                if (secondaryLabel != null && onSecondary != null) {
                    OutlinedButton(
                        onClick = onSecondary,
                        shape = RoundedCornerShape(8.dp),
                    ) {
                        Text(
                            secondaryLabel,
                            fontSize = 13.sp,
                            color = if (danger) Brand.DangerText else Brand.WarnTitle,
                        )
                    }
                }
            }
        }
    }
}

/** Botón ancho principal, con indicador de carga integrado. */
@Composable
fun WideButton(
    label: String,
    color: Color,
    onClick: () -> Unit,
    enabled: Boolean = true,
    loading: Boolean = false,
) {
    Button(
        onClick = onClick,
        enabled = enabled && !loading,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = color,
            contentColor = Color.White,
            disabledContainerColor = color.copy(alpha = 0.5f),
        ),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 16.dp),
    ) {
        if (loading) {
            CircularProgressIndicator(
                color = Color.White,
                strokeWidth = 2.dp,
                modifier = Modifier.size(20.dp),
            )
        } else {
            Text(
                text = label,
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 0.5.sp,
                textAlign = TextAlign.Center,
            )
        }
    }
}
