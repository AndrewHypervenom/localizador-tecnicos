package com.empresa.localizador.ui.screens

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.empresa.localizador.ui.WideButton
import com.empresa.localizador.ui.theme.Brand
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.concurrent.Executors

private const val QR_PREFIX = "localizador:register:"

private enum class ScanState { SCANNING, PROCESSING, SUCCESS, ERROR }

/**
 * Registro del dispositivo escaneando el QR que entrega el líder.
 *
 * El lector usa el modelo empaquetado de ML Kit, así que funciona sin conexión y
 * sin servicios de Google, y reconoce el código con la cámara en movimiento (la
 * versión anterior obligaba a encuadrar con más cuidado).
 */
@Composable
fun RegisterScreen(
    canCancel: Boolean,
    onCancel: () -> Unit,
    onScanned: suspend (String) -> String?,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var hasCameraPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
                PackageManager.PERMISSION_GRANTED
        )
    }
    var scanState by remember { mutableStateOf(ScanState.SCANNING) }
    var message by remember { mutableStateOf("") }
    var techName by remember { mutableStateOf("") }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted -> hasCameraPermission = granted }

    LaunchedEffect(Unit) {
        if (!hasCameraPermission) permissionLauncher.launch(Manifest.permission.CAMERA)
    }

    // Tras un error, volver a permitir el escaneo pasados unos segundos.
    LaunchedEffect(scanState) {
        if (scanState == ScanState.ERROR) {
            delay(3_000)
            scanState = ScanState.SCANNING
        }
    }

    Box(modifier = Modifier.fillMaxSize().background(Color.Black)) {
        if (hasCameraPermission && scanState == ScanState.SCANNING) {
            CameraPreview(
                onQrDetected = { raw ->
                    if (scanState != ScanState.SCANNING) return@CameraPreview
                    if (!raw.startsWith(QR_PREFIX)) return@CameraPreview   // ignorar QR ajenos
                    scanState = ScanState.PROCESSING
                    val token = raw.removePrefix(QR_PREFIX).trim()
                    scope.launch {
                        val error = onScanned(token)
                        if (error == null) {
                            scanState = ScanState.SUCCESS
                        } else {
                            message = error
                            scanState = ScanState.ERROR
                        }
                    }
                },
            )
        }

        // Marco de encuadre
        Box(
            modifier = Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.55f)),
            contentAlignment = Alignment.Center,
        ) {
            Box(
                modifier = Modifier
                    .size(240.dp)
                    .border(3.dp, Brand.Green, RoundedCornerShape(16.dp))
            )
        }

        Column(
            modifier = Modifier.fillMaxSize().padding(vertical = 48.dp, horizontal = 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    "Localizador PositivoS+",
                    color = Brand.TextPrimary,
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold,
                )
                Text("Registro de dispositivo", color = Brand.TextMuted, fontSize = 13.sp)
            }

            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                when {
                    !hasCameraPermission -> StateBox {
                        Text("📷", fontSize = 40.sp)
                        Text(
                            "Se necesita la cámara para escanear el código QR de registro.",
                            color = Brand.TextMuted,
                            fontSize = 14.sp,
                            textAlign = TextAlign.Center,
                        )
                        TextButton(onClick = { permissionLauncher.launch(Manifest.permission.CAMERA) }) {
                            Text("Conceder permiso", color = Brand.Green, fontWeight = FontWeight.SemiBold)
                        }
                    }

                    scanState == ScanState.SCANNING -> Text(
                        "Apunta al código QR que te dio el administrador",
                        color = Color(0xFFCBD5E1),
                        fontSize = 14.sp,
                        textAlign = TextAlign.Center,
                    )

                    scanState == ScanState.PROCESSING -> StateBox {
                        CircularProgressIndicator(color = Brand.Green, strokeWidth = 2.dp)
                        Text("Registrando…", color = Brand.TextPrimary, fontSize = 14.sp)
                    }

                    scanState == ScanState.SUCCESS -> StateBox(borderColor = Brand.Green) {
                        Text("✓", fontSize = 32.sp, color = Brand.Green)
                        Text(
                            "Registrado",
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Bold,
                            color = Brand.Green,
                        )
                        if (techName.isNotBlank()) {
                            Text(techName, color = Brand.TextPrimary, fontSize = 15.sp)
                        }
                    }

                    else -> StateBox(borderColor = Brand.DangerBorder) {
                        Text("✕", fontSize = 32.sp, color = Brand.DangerBorder)
                        Text(
                            message,
                            color = Brand.DangerText,
                            fontSize = 13.sp,
                            textAlign = TextAlign.Center,
                        )
                    }
                }

                if (canCancel) {
                    Box(modifier = Modifier.fillMaxWidth().padding(top = 24.dp)) {
                        WideButton("Volver", Brand.SurfaceAlt, onCancel)
                    }
                }
            }
        }
    }
}

@Composable
private fun StateBox(
    borderColor: Color = Color.Transparent,
    content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit,
) {
    Column(
        modifier = Modifier
            .background(Color(0xFF0F172A).copy(alpha = 0.92f), RoundedCornerShape(16.dp))
            .border(1.dp, borderColor, RoundedCornerShape(16.dp))
            .padding(horizontal = 28.dp, vertical = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
        content = content,
    )
}

@Composable
private fun CameraPreview(onQrDetected: (String) -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val executor = remember { Executors.newSingleThreadExecutor() }
    val scanner = remember { BarcodeScanning.getClient() }

    DisposableEffect(Unit) {
        onDispose {
            executor.shutdown()
            scanner.close()
        }
    }

    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { ctx ->
            val previewView = PreviewView(ctx).apply {
                scaleType = PreviewView.ScaleType.FILL_CENTER
            }
            val providerFuture = ProcessCameraProvider.getInstance(ctx)
            providerFuture.addListener({
                val provider = providerFuture.get()

                val preview = Preview.Builder().build().also {
                    it.setSurfaceProvider(previewView.surfaceProvider)
                }

                val analysis = ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                    .also { it.setAnalyzer(executor, QrAnalyzer(scanner, onQrDetected)) }

                try {
                    provider.unbindAll()
                    provider.bindToLifecycle(
                        lifecycleOwner,
                        CameraSelector.DEFAULT_BACK_CAMERA,
                        preview,
                        analysis,
                    )
                } catch (_: Exception) {
                    // Cámara ocupada o no disponible: la pantalla sigue mostrando
                    // el marco y el técnico puede reintentar.
                }
            }, ContextCompat.getMainExecutor(ctx))
            previewView
        },
    )
}

private class QrAnalyzer(
    private val scanner: com.google.mlkit.vision.barcode.BarcodeScanner,
    private val onQrDetected: (String) -> Unit,
) : ImageAnalysis.Analyzer {

    @SuppressLint("UnsafeOptInUsageError")
    @ExperimentalGetImage
    override fun analyze(imageProxy: ImageProxy) {
        val mediaImage = imageProxy.image
        if (mediaImage == null) {
            imageProxy.close()
            return
        }
        val image = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
        scanner.process(image)
            .addOnSuccessListener { barcodes ->
                barcodes.firstOrNull { it.format == Barcode.FORMAT_QR_CODE }
                    ?.rawValue
                    ?.let(onQrDetected)
            }
            .addOnCompleteListener { imageProxy.close() }
    }
}
