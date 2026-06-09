/**
 * Config plugin: autoarranque del rastreo tras reiniciar el celular.
 *
 * Inyecta en el proyecto Android (durante `expo prebuild` / EAS build):
 *   - Un BroadcastReceiver (BootReceiver) que escucha BOOT_COMPLETED.
 *   - Un HeadlessJsTaskService (BootTaskService) que corre la tarea JS
 *     BOOT_RESUME_TASK (ver src/services/bootTask.ts) sin abrir la app.
 *
 * Al reiniciar el teléfono, el receiver lanza el service, la tarea JS llama a
 * ensureTrackingHealthy() y —si había sesión— el rastreo se reanuda solo. Es la
 * pieza que evita el "toca reiniciar el celular para que vuelva a servir".
 *
 * Nota: en equipos GESTIONADOS por MDM, la política "app persistente / keep
 * alive" es el mecanismo principal; este receiver es el refuerzo (y la única vía
 * en equipos no gestionados). El arranque del service va en try/catch nativo
 * porque Android 12+ restringe los background-start fuera de la ventana de boot.
 *
 * Requiere un EAS dev build (no funciona en Expo Go).
 */
const {
  withAndroidManifest,
  withDangerousMod,
  AndroidConfig,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PACKAGE = 'com.empresa.localizador';
const BOOT_TASK_NAME = 'BOOT_RESUME_TASK';

const BOOT_RECEIVER_KT = `package ${PACKAGE}

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * Reanuda el rastreo tras reiniciar el dispositivo. Lanza el HeadlessJsTaskService
 * que corre la tarea JS ${BOOT_TASK_NAME} (ensureTrackingHealthy + heartbeat).
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val action = intent?.action ?: return
    if (action == Intent.ACTION_BOOT_COMPLETED ||
        action == Intent.ACTION_LOCKED_BOOT_COMPLETED ||
        action == "android.intent.action.QUICKBOOT_POWERON" ||
        action == "com.htc.intent.action.QUICKBOOT_POWERON" ||
        action == Intent.ACTION_MY_PACKAGE_REPLACED) {
      try {
        val serviceIntent = Intent(context, BootTaskService::class.java)
        // BOOT_COMPLETED concede una ventana para arrancar servicios; aun así lo
        // envolvemos en try/catch por las restricciones de Android 12+.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(serviceIntent)
        } else {
          context.startService(serviceIntent)
        }
      } catch (e: Exception) {
        android.util.Log.e("BootReceiver", "No se pudo reanudar el rastreo: " + e.message)
      }
    }
  }
}
`;

const BOOT_SERVICE_KT = `package ${PACKAGE}

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Corre la tarea JS ${BOOT_TASK_NAME} en segundo plano tras el arranque del
 * dispositivo. El timeout amplio da margen a ensureTrackingHealthy() para
 * re-suscribir el servicio de ubicación de expo-location (que tiene su propio
 * foreground service de tipo "location").
 */
class BootTaskService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig {
    return HeadlessJsTaskConfig(
      "${BOOT_TASK_NAME}",
      Arguments.createMap(),
      30000L, // timeout (ms)
      true    // permitir ejecución aunque la app esté en primer plano
    )
  }
}
`;

/** Añade el <receiver> y el <service> al AndroidManifest. */
function addManifestComponents(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);

    app.receiver = app.receiver || [];
    const hasReceiver = app.receiver.some(
      (r) => r.$?.['android:name'] === '.BootReceiver',
    );
    if (!hasReceiver) {
      app.receiver.push({
        $: {
          'android:name': '.BootReceiver',
          'android:enabled': 'true',
          'android:exported': 'true',
          'android:directBootAware': 'true',
        },
        'intent-filter': [
          {
            action: [
              { $: { 'android:name': 'android.intent.action.BOOT_COMPLETED' } },
              { $: { 'android:name': 'android.intent.action.LOCKED_BOOT_COMPLETED' } },
              { $: { 'android:name': 'android.intent.action.QUICKBOOT_POWERON' } },
              { $: { 'android:name': 'android.intent.action.MY_PACKAGE_REPLACED' } },
            ],
          },
        ],
      });
    }

    app.service = app.service || [];
    const hasService = app.service.some(
      (s) => s.$?.['android:name'] === '.BootTaskService',
    );
    if (!hasService) {
      app.service.push({
        $: {
          'android:name': '.BootTaskService',
          'android:enabled': 'true',
          'android:exported': 'false',
        },
      });
    }

    return cfg;
  });
}

/** Escribe los archivos Kotlin en el árbol nativo durante prebuild. */
function writeKotlinSources(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const pkgPath = PACKAGE.split('.').join(path.sep);
      const dir = path.join(
        cfg.modRequest.platformProjectRoot,
        'app', 'src', 'main', 'java', pkgPath,
      );
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'BootReceiver.kt'), BOOT_RECEIVER_KT);
      fs.writeFileSync(path.join(dir, 'BootTaskService.kt'), BOOT_SERVICE_KT);
      return cfg;
    },
  ]);
}

module.exports = function withBootReceiver(config) {
  config = addManifestComponents(config);
  config = writeKotlinSources(config);
  return config;
};
