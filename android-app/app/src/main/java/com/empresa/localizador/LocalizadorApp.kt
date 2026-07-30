package com.empresa.localizador

import android.app.Application
import android.util.Log
import androidx.work.Configuration
import com.empresa.localizador.data.AppInit
import com.empresa.localizador.data.LegacyImporter
import com.empresa.localizador.data.Prefs
import com.empresa.localizador.tracking.Notifications
import com.empresa.localizador.tracking.TrackingManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class LocalizadorApp : Application(), Configuration.Provider {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    override fun onCreate() {
        super.onCreate()

        // Prefs debe estar listo antes que nada: los receivers y el servicio pueden
        // arrancar el proceso sin que se haya abierto ninguna pantalla.
        Prefs.init(this)
        Notifications.createChannels(this)

        scope.launch {
            try {
                // Herencia desde la versión React Native. Se hace aquí, y no en la
                // pantalla, porque el proceso puede arrancar en segundo plano (por
                // el arranque del teléfono o un watchdog) y la sesión debe quedar
                // disponible igualmente.
                val result = LegacyImporter.runOnce(this@LocalizadorApp)
                if (result.inherited) {
                    Log.i(
                        "LocalizadorApp",
                        "Estado heredado: dispositivo=${result.installId} técnico=${result.technician} " +
                            "puntos=${result.locationsImported} eventos=${result.motionsImported}",
                    )
                }
                TrackingManager.resumeIfNeeded(this@LocalizadorApp)
            } catch (e: Exception) {
                Log.e("LocalizadorApp", "Fallo al inicializar: ${e.message}")
            } finally {
                // Pase lo que pase, liberar la barrera: dejar la app colgada en la
                // pantalla de carga sería peor que arrancar sin heredar nada.
                AppInit.markReady()
            }
        }
    }

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setMinimumLoggingLevel(if (BuildConfig.DEBUG) Log.DEBUG else Log.WARN)
            .build()
}
