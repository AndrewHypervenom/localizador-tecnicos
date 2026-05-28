import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';

const ASKED_KEY = '@localizador/battopt_asked';

/**
 * Pide al usuario eximir la app de la optimización de batería de Android.
 * Es la causa #1 de que el SO mate el foreground service antes de cumplir
 * las >=4 h de rastreo continuo. Se solicita una sola vez para no molestar.
 */
export async function ensureBatteryOptimizationExempt(): Promise<void> {
  if (Platform.OS !== 'android') return;

  const asked = await AsyncStorage.getItem(ASKED_KEY);
  if (asked) return;
  await AsyncStorage.setItem(ASKED_KEY, '1');

  const pkg = Application.applicationId ?? 'com.empresa.localizador';
  try {
    // Diálogo del sistema "Permitir que la app se ejecute en segundo plano".
    await IntentLauncher.startActivityAsync(
      'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
      { data: `package:${pkg}` },
    );
  } catch {
    // Fallback: pantalla general de optimización de batería.
    try {
      await IntentLauncher.startActivityAsync('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS');
    } catch { /* el equipo no expone la pantalla; se ignora */ }
  }
}
