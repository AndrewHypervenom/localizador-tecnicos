import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import * as Battery from 'expo-battery';
import * as Device from 'expo-device';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';

const ASKED_KEY     = '@localizador/battopt_asked';
const DISMISS_KEY   = '@localizador/battopt_dismissed';
const AUTOSTART_KEY = '@localizador/autostart_done';

export function isXiaomi(): boolean {
  const m = (Device.manufacturer ?? '').toLowerCase();
  const b = (Device.brand ?? '').toLowerCase();
  return /xiaomi|redmi|poco/.test(`${m} ${b}`);
}

// ── Fabricante (para la guía de "inicio automático") ──────────────────────────
// Varias capas (MIUI, EMUI, ColorOS, Funtouch, OneUI) matan los servicios en
// segundo plano salvo que la app tenga "Inicio automático" activado. Ese ajuste
// NO tiene API pública ni se puede leer; lo máximo es ABRIR su pantalla. Cada OEM
// la esconde en un Activity distinto.
type Oem = 'xiaomi' | 'huawei' | 'oppo' | 'vivo' | 'samsung' | 'other';

function detectOem(): Oem {
  const s = `${Device.manufacturer ?? ''} ${Device.brand ?? ''}`.toLowerCase();
  if (/xiaomi|redmi|poco/.test(s))            return 'xiaomi';
  if (/huawei|honor/.test(s))                 return 'huawei';
  if (/oppo|realme|oneplus|coloros/.test(s))  return 'oppo';
  if (/vivo|iqoo/.test(s))                    return 'vivo';
  if (/samsung/.test(s))                      return 'samsung';
  return 'other';
}

const OEM_GUIDE: Record<Oem, { brand: string; steps: string }> = {
  xiaomi:  { brand: 'Xiaomi / Redmi / POCO', steps: 'Seguridad › Permisos › Inicio automático (Autostart): activa "Localizador". Además, Batería › "Sin restricciones".' },
  huawei:  { brand: 'Huawei / Honor',        steps: 'Ajustes › Batería › Inicio de aplicaciones › Localizador: pásalo a "Gestionar manualmente" y activa "Inicio automático", "Inicio secundario" y "Ejecutar en segundo plano".' },
  oppo:    { brand: 'OPPO / Realme / OnePlus', steps: 'Ajustes › Batería / Apps › Inicio automático: permite el inicio de "Localizador" y fíjala (candado) en la pantalla de Recientes.' },
  vivo:    { brand: 'vivo / iQOO',           steps: 'iManager (Administrador del teléfono) › Gestión de apps › Inicio automático: activa "Localizador". Permite también "Consumo alto en segundo plano".' },
  samsung: { brand: 'Samsung',               steps: 'Ajustes › Batería › Límites de uso en segundo plano: quita "Localizador" de "Apps en suspensión" y NO la pongas en suspensión automática.' },
  other:   { brand: '', steps: '' },
};

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
 * Re-mostrar el aviso de batería: se llama cuando se detecta que el rastreo se
 * CAYÓ (tracking_killed) pese a que el técnico había confirmado "Ya está
 * configurado". Si el servicio murió, la exención no bastó (o nunca se hizo), así
 * que se vuelve a levantar el banner para que lo revise. Solo afecta a Xiaomi (en
 * el resto el banner ya sigue el estado real del Doze y reaparece solo).
 */
export async function reRaiseBatteryGuard(): Promise<void> {
  await AsyncStorage.removeItem(DISMISS_KEY);
}

// ── Guía de "inicio automático" por fabricante ────────────────────────────────

export type AutostartGuide = {
  needed:    boolean;  // ¿es un OEM con pantalla de inicio automático conocida?
  dismissed: boolean;  // ¿el técnico ya marcó "Ya lo activé"?
  brand:     string;
  steps:     string;
};

/** Estado del banner de inicio automático para HomeScreen. */
export async function getAutostartGuide(): Promise<AutostartGuide> {
  if (Platform.OS !== 'android') return { needed: false, dismissed: true, brand: '', steps: '' };
  const oem = detectOem();
  const cfg = OEM_GUIDE[oem];
  const dismissed = (await AsyncStorage.getItem(AUTOSTART_KEY)) === '1';
  return { needed: oem !== 'other', dismissed, brand: cfg.brand, steps: cfg.steps };
}

/** El técnico confirma que ya activó el inicio automático (oculta el banner). */
export async function dismissAutostartGuide(): Promise<void> {
  await AsyncStorage.setItem(AUTOSTART_KEY, '1');
}

/**
 * Abre la pantalla de "Inicio automático / Autostart" del fabricante. Prueba los
 * Activity conocidos de cada capa; si ninguno existe en esta versión, cae a la
 * ficha de la app (desde donde se llega a permisos/batería). Devuelve true si
 * logró abrir alguna pantalla.
 */
export async function openAutostartSettings(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const oem = detectOem();
  const targets: Record<Oem, IntentLauncher.IntentLauncherParams[]> = {
    xiaomi: [
      { packageName: 'com.miui.securitycenter', className: 'com.miui.permcenter.autostart.AutoStartManagementActivity' },
    ],
    huawei: [
      { packageName: 'com.huawei.systemmanager', className: 'com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity' },
      { packageName: 'com.huawei.systemmanager', className: 'com.huawei.systemmanager.optimize.process.ProtectActivity' },
    ],
    oppo: [
      { packageName: 'com.coloros.safecenter', className: 'com.coloros.safecenter.startupapp.StartupAppListActivity' },
      { packageName: 'com.coloros.safecenter', className: 'com.coloros.safecenter.permission.startup.StartupAppListActivity' },
      { packageName: 'com.oppo.safe',          className: 'com.oppo.safe.permission.startup.StartupAppListActivity' },
    ],
    vivo: [
      { packageName: 'com.vivo.permissionmanager', className: 'com.vivo.permissionmanager.activity.BgStartUpManagerActivity' },
      { packageName: 'com.iqoo.secure',            className: 'com.iqoo.secure.ui.phoneoptimize.BgStartUpManager' },
    ],
    samsung: [
      { packageName: 'com.samsung.android.lool', className: 'com.samsung.android.sm.ui.battery.BatteryActivity' },
    ],
    other: [],
  };

  for (const t of targets[oem]) {
    try {
      await IntentLauncher.startActivityAsync('android.intent.action.MAIN', t);
      return true;
    } catch { /* ese Activity no existe en esta versión de la capa; probar el siguiente */ }
  }

  // Fallback universal: la ficha de la app en Ajustes.
  try {
    const pkg = Application.applicationId ?? 'com.empresa.localizador';
    await IntentLauncher.startActivityAsync('android.settings.APPLICATION_DETAILS_SETTINGS', { data: `package:${pkg}` });
    return true;
  } catch {
    return false;
  }
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
