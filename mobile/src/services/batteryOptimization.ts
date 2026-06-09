import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import * as Battery from 'expo-battery';
import * as Device from 'expo-device';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';

const ASKED_KEY   = '@localizador/battopt_asked';
const DISMISS_KEY = '@localizador/battopt_dismissed';

export function isXiaomi(): boolean {
  const m = (Device.manufacturer ?? '').toLowerCase();
  const b = (Device.brand ?? '').toLowerCase();
  return /xiaomi|redmi|poco/.test(`${m} ${b}`);
}

/**
 * En Xiaomi (MIUI/HyperOS) la pantalla "Ahorro de batería → Sin restricciones"
 * es una capa PROPIA de Xiaomi, encima de Android. El intent estándar
 * REQUEST_IGNORE_BATTERY_OPTIMIZATIONS exime del Doze de Android puro pero MIUI
 * lo ignora, así que el equipo se queda en "Ahorro de batería" y mata el
 * servicio. No existe API pública para ponerlo en "Sin restricciones" ni para
 * LEER su estado sin MDM; lo máximo desde la app es ABRIR esa pantalla para que
 * sea un solo toque. Devuelve true si logró abrir alguna pantalla de MIUI.
 */
async function openXiaomiPowerScreen(pkg: string, label: string): Promise<boolean> {
  const targets: IntentLauncher.IntentLauncherParams[] = [
    { packageName: 'com.miui.powerkeeper', className: 'com.miui.powerkeeper.ui.HiddenAppsConfigActivity',
      extra: { package_name: pkg, package_label: label } },
    { packageName: 'com.miui.powerkeeper', className: 'com.miui.powerkeeper.ui.HiddenAppsContainerManagementActivity' },
  ];
  for (const t of targets) {
    try {
      await IntentLauncher.startActivityAsync('android.intent.action.MAIN', t);
      return true;
    } catch { /* esa actividad no existe en esta versión de HyperOS; probar la siguiente */ }
  }
  return false;
}

/** Abre la pantalla del sistema para quitar la restricción de batería. */
export async function openBatterySettings(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const pkg   = Application.applicationId   ?? 'com.empresa.localizador';
  const label = Application.applicationName ?? 'Localizador PositivoS+';

  // En Xiaomi, llevar directo a la pantalla "Sin restricciones" de MIUI.
  if (isXiaomi() && await openXiaomiPowerScreen(pkg, label)) return;

  try {
    await IntentLauncher.startActivityAsync(
      'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
      { data: `package:${pkg}` },
    );
  } catch {
    try {
      await IntentLauncher.startActivityAsync('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS');
    } catch { /* el equipo no expone la pantalla; se ignora */ }
  }
}

export type BatteryGuard = {
  needsAttention: boolean; // mostrar banner
  canDismiss:     boolean; // ofrecer botón "Ya está configurado" (Xiaomi)
  xiaomi:         boolean;
};

/**
 * Estado para el banner de batería de HomeScreen.
 * - Android estándar: detectamos el Doze whitelist; el banner desaparece solo
 *   cuando la app queda exenta.
 * - Xiaomi: NO hay API para leer la capa MIUI, así que avisamos hasta que el
 *   usuario confirme con "Ya está configurado" (flag persistente).
 */
export async function getBatteryGuard(): Promise<BatteryGuard> {
  if (Platform.OS !== 'android') return { needsAttention: false, canDismiss: false, xiaomi: false };

  const xiaomi = isXiaomi();

  if (xiaomi) {
    const dismissed = (await AsyncStorage.getItem(DISMISS_KEY)) === '1';
    return { needsAttention: !dismissed, canDismiss: true, xiaomi };
  }

  let optimized = true;
  try { optimized = await Battery.isBatteryOptimizationEnabledAsync(); } catch { /* sin API: asumir que sí */ }
  return { needsAttention: optimized, canDismiss: false, xiaomi };
}

/** El usuario confirma que ya dejó la batería en "Sin restricciones" (Xiaomi). */
export async function dismissBatteryGuard(): Promise<void> {
  await AsyncStorage.setItem(DISMISS_KEY, '1');
}

/**
 * Pide una sola vez la exención de batería al iniciar el rastreo. En MDM ya
 * viene exenta; en Xiaomi abre la pantalla de MIUI. El banner persistente de
 * HomeScreen (getBatteryGuard) es el recordatorio continuo.
 */
export async function ensureBatteryOptimizationExempt(): Promise<void> {
  if (Platform.OS !== 'android') return;

  // Si el MDM (o el usuario) ya eximió la app del Doze de Android, no molestar.
  // En Xiaomi esto NO refleja la capa MIUI, así que igual abrimos su pantalla
  // la primera vez (controlado por ASKED_KEY).
  try {
    const optimized = await Battery.isBatteryOptimizationEnabledAsync();
    if (!optimized && !isXiaomi()) return;
  } catch {
    // Si la API no está disponible, seguimos con el flujo de "preguntar 1 vez".
  }

  const asked = await AsyncStorage.getItem(ASKED_KEY);
  if (asked) return;
  await AsyncStorage.setItem(ASKED_KEY, '1');

  await openBatterySettings();
}
