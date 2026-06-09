import * as Location from 'expo-location';
import * as Battery from 'expo-battery';
import * as Application from 'expo-application';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from '../lib/supabase';
import { loadTechnicianId, loadLastFixTs, type PermLevel } from './offlineQueue';
import { getCurrentTier } from './locationService';

// ── Latido (heartbeat) de "la app sigue viva" ─────────────────────────────────
// Independiente del GPS: la app deja un latido periódico en `technician_heartbeat`
// (una fila por técnico, upsert) aunque NO haya fixes de ubicación (GPS apagado,
// túnel, edificio, sin red). Es la pieza que permite al líder distinguir
//   - "app activa sin señal GPS"  (latido fresco, sin puntos)  → amarillo
//   - "desconectado de verdad"    (sin latido)                 → rojo
// y refuta el "la app no sirve": queda prueba server-side, minuto a minuto, de
// que la app estaba viva (con GPS/red/permiso/batería de contexto).
//
// Se emite desde 3 rutas que ya existen (cubren todos los casos):
//   1. locationTask  — al drenar por lotes (~30 s) cuando hay fixes y red.
//   2. HomeScreen    — en el sondeo de primer plano (~20 s).
//   3. watchdog      — en segundo plano (~15 min), AUNQUE el GPS esté apagado.

const APP_VERSION: string = Application.nativeApplicationVersion ?? 'unknown';

// No enviar más de un latido cada HB_MIN_INTERVAL_MS aunque varias rutas lo
// llamen casi a la vez. `force` lo salta (lo usa el watchdog).
const HB_MIN_INTERVAL_MS = 25_000;
let _lastHbTs = 0;

type AppStateKind = 'foreground' | 'background';

async function readPermLevel(): Promise<PermLevel> {
  try {
    const { status: fg } = await Location.getForegroundPermissionsAsync();
    if (fg !== 'granted') return 'none';
    const { status: bg } = await Location.getBackgroundPermissionsAsync();
    return bg === 'granted' ? 'full' : 'partial';
  } catch {
    return 'none';
  }
}

/**
 * Envía un latido si hay sesión de rastreo activa. Best-effort: ningún fallo
 * de lectura aborta el envío, y si el upsert falla (sin red) no se encola —el
 * latido es ESTADO, se pisa en el siguiente tick.
 */
export async function sendHeartbeat(opts: { appState: AppStateKind; force?: boolean }): Promise<void> {
  const technicianId = await loadTechnicianId();
  if (!technicianId) return; // sin sesión: nada que reportar

  const now = Date.now();
  if (!opts.force && now - _lastHbTs < HB_MIN_INTERVAL_MS) return;
  _lastHbTs = now;

  let gpsOn: boolean | null = null;
  let netOn: boolean | null = null;
  let battery: number | null = null;
  let charging: boolean | null = null;
  let perm: PermLevel | null = null;
  let lastFixAgeS: number | null = null;

  try { gpsOn = await Location.hasServicesEnabledAsync(); } catch { /* best-effort */ }
  try { const s = await NetInfo.fetch(); netOn = s.isConnected !== false; } catch { /* best-effort */ }
  try { const lvl = await Battery.getBatteryLevelAsync(); if (lvl >= 0) battery = Math.round(lvl * 100); } catch { /* best-effort */ }
  try {
    const st = await Battery.getBatteryStateAsync();
    charging = st === Battery.BatteryState.CHARGING || st === Battery.BatteryState.FULL;
  } catch { /* best-effort */ }
  try { perm = await readPermLevel(); } catch { /* best-effort */ }
  try {
    const fix = await loadLastFixTs();
    if (fix != null) lastFixAgeS = Math.round((now - fix) / 1000);
  } catch { /* best-effort */ }

  try {
    const { error } = await supabase.from('technician_heartbeat').upsert(
      {
        technician_id:  technicianId,
        last_heartbeat: new Date(now).toISOString(),
        gps_on:         gpsOn,
        net_on:         netOn,
        perm,
        battery,
        charging,
        last_fix_age_s: lastFixAgeS,
        tracking_tier:  getCurrentTier(),
        app_version:    APP_VERSION,
        app_state:      opts.appState,
        updated_at:     new Date(now).toISOString(),
      },
      { onConflict: 'technician_id' },
    );
    // Sin red / error transitorio: reabrir la ventana para reintentar antes.
    if (error) _lastHbTs = 0;
  } catch {
    _lastHbTs = 0;
  }
}
