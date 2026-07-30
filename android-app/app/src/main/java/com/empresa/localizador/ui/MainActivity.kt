package com.empresa.localizador.ui

import android.Manifest
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.core.view.WindowCompat
import androidx.lifecycle.viewmodel.compose.viewModel
import com.empresa.localizador.device.DeviceState
import com.empresa.localizador.device.PermLevel
import com.empresa.localizador.ui.screens.DiagnosticsScreen
import com.empresa.localizador.ui.screens.HomeScreen
import com.empresa.localizador.ui.screens.LoadingScreen
import com.empresa.localizador.ui.screens.MockBlockedScreen
import com.empresa.localizador.ui.screens.RegisterScreen
import com.empresa.localizador.ui.screens.TermsScreen
import com.empresa.localizador.ui.theme.LocalizadorTheme

class MainActivity : ComponentActivity() {

    private var viewModel: AppViewModel? = null

    // ── Permisos ─────────────────────────────────────────────────────────────
    // Android obliga a pedirlos en cadena y, desde la versión 11, no permite
    // siquiera ofrecer "Permitir todo el tiempo" en un diálogo: el técnico tiene
    // que elegirlo a mano. Por eso se le explica ANTES qué debe tocar.

    private val requestBackground = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { finishPermissionFlow() }

    private val requestActivityRecognition = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { requestBackgroundLocation() }

    private val requestForeground = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { granted ->
        val ok = granted[Manifest.permission.ACCESS_FINE_LOCATION] == true ||
            granted[Manifest.permission.ACCESS_COARSE_LOCATION] == true
        if (!ok) {
            viewModel?.showDialog(
                AppViewModel.Dialog.Info(
                    "Permiso requerido",
                    "Sin permiso de ubicación no se puede rastrear. Concédelo en " +
                        "Ajustes › Aplicaciones › Localizador › Permisos › Ubicación.",
                )
            )
            return@registerForActivityResult
        }
        requestActivityRecognitionThenBackground()
    }

    private val requestNotifications = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { startLocationPermissionChain() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, true)

        setContent {
            val vm: AppViewModel = viewModel()
            viewModel = vm
            val state by vm.state.collectAsState()

            LocalizadorTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    when (state.screen) {
                        AppViewModel.Screen.LOADING -> LoadingScreen()

                        AppViewModel.Screen.TERMS -> TermsScreen(onAccept = vm::acceptTerms)

                        AppViewModel.Screen.REGISTER -> RegisterScreen(
                            canCancel = state.canCancelRegister,
                            onCancel = vm::cancelRegister,
                            onScanned = { token -> vm.registerWithToken(token) },
                        )

                        AppViewModel.Screen.MOCK_BLOCKED -> MockBlockedScreen()

                        AppViewModel.Screen.DIAGNOSTICS -> DiagnosticsScreen(
                            state = state,
                            deviceId = vm.deviceId,
                            onBack = vm::backToHome,
                        )

                        AppViewModel.Screen.HOME -> HomeScreen(
                            state = state,
                            viewModel = vm,
                            onRequestPermissions = ::explainThenRequestPermissions,
                        )
                    }

                    state.dialog?.let { dialog ->
                        AppDialog(dialog = dialog, onDismiss = vm::dismissDialog)
                    }
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        viewModel?.startPolling()
    }

    override fun onResume() {
        super.onResume()
        viewModel?.onResumed()
    }

    override fun onStop() {
        viewModel?.stopPolling()
        super.onStop()
    }

    // ── Cadena de permisos ───────────────────────────────────────────────────

    /**
     * Explica primero, pide después. Es la diferencia entre que el técnico elija
     * "Permitir todo el tiempo" o "Solo con la app" —y esta última es la causa
     * silenciosa de la mitad de los "la app no sirve".
     */
    private fun explainThenRequestPermissions() {
        viewModel?.showDialog(
            AppViewModel.Dialog.Confirm(
                title = "Activar ubicación continua",
                body = "En las siguientes pantallas elige:\n\n" +
                    "•  Ubicación:  \"Permitir todo el tiempo\"  (NO \"Solo con la app\").\n" +
                    "•  Usar ubicación precisa:  activada.\n\n" +
                    "Si eliges otra opción, el rastreo no funcionará cuando cierres la app.",
                confirmLabel = "Entendido",
                onConfirm = { beginPermissionChain() },
            )
        )
    }

    private fun beginPermissionChain() {
        viewModel?.dismissDialog()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            !DeviceState.hasNotificationPermission(this)
        ) {
            requestNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            startLocationPermissionChain()
        }
    }

    private fun startLocationPermissionChain() {
        requestForeground.launch(
            arrayOf(
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION,
            )
        )
    }

    /**
     * El reconocimiento de actividad no es imprescindible para rastrear, pero es lo
     * que permite ahorrar batería sabiendo que el técnico está quieto sin encender
     * el GPS. Se pide aquí, entre medias, para no añadir otro diálogo suelto.
     */
    private fun requestActivityRecognitionThenBackground() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
            !com.empresa.localizador.tracking.ActivityRecognitionController.hasPermission(this)
        ) {
            requestActivityRecognition.launch(Manifest.permission.ACTIVITY_RECOGNITION)
        } else {
            requestBackgroundLocation()
        }
    }

    private fun requestBackgroundLocation() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
            DeviceState.permLevel(this) != PermLevel.FULL
        ) {
            requestBackground.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        } else {
            finishPermissionFlow()
        }
    }

    private fun finishPermissionFlow() {
        val vm = viewModel ?: return
        if (DeviceState.permLevel(this) == PermLevel.FULL) {
            vm.onPermissionsGranted()
        } else {
            vm.showDialog(
                AppViewModel.Dialog.Confirm(
                    title = "Falta \"Permitir todo el tiempo\"",
                    body = "Android no deja conceder este permiso desde un diálogo: hay que " +
                        "elegirlo en los Ajustes de la app.\n\n" +
                        "Toca:  Permisos  ›  Ubicación  ›  \"Permitir todo el tiempo\"\n" +
                        "y activa  \"Usar ubicación precisa\".",
                    confirmLabel = "Abrir Ajustes",
                    onConfirm = {
                        vm.dismissDialog()
                        com.empresa.localizador.device.OemGuides.openAppDetails(this)
                    },
                )
            )
        }
    }
}
