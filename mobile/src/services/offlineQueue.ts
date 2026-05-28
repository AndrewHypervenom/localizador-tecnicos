import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from '../lib/supabase';

const LOC_QUEUE_KEY     = '@localizador/location_queue';
const MOTION_QUEUE_KEY  = '@localizador/motion_queue';
const TECH_ID_KEY       = '@localizador/technician_id';
const LAST_ERROR_KEY    = '@localizador/last_error';
const LAST_SENT_KEY     = '@localizador/last_sent';
const LAST_UPLOADED_KEY = '@localizador/last_uploaded';
const NEXT_RETRY_KEY    = '@localizador/next_retry_at';

// Capacidad de cola dimensionada para cubrir >=4 h sin señal aun en el peor caso.
// Con el throttle adaptativo (locationTask) los puntos reales son muy inferiores.
const LOC_QUEUE_CAP    = 10_000;  // ~1.5 MB en AsyncStorage
const MOTION_QUEUE_CAP = 1_000;
const FLUSH_BATCH      = 100;     // se drena en lotes FIFO (más antiguo primero)

// Backoff exponencial entre reintentos de flush (ms).
const BACKOFF_STEPS_MS = [5_000, 10_000, 30_000, 60_000, 120_000, 300_000];

// ── Conectividad ──────────────────────────────────────────────────────────────

/** true si hay conexión (o si el estado es desconocido, para no bloquear envíos). */
export async function isOnline(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    return state.isConnected !== false;
  } catch {
    return true;
  }
}

// ── Backoff de reintentos ──────────────────────────────────────────────────────

/** ¿Ya pasó la ventana de espera del backoff? */
async function canRetryNow(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(NEXT_RETRY_KEY);
  if (!raw) return true;
  try {
    const { at } = JSON.parse(raw) as { at: number; step: number };
    return Date.now() >= at;
  } catch {
    return true;
  }
}

/** Avanza el backoff tras un fallo de envío. */
async function bumpBackoff(): Promise<void> {
  const raw = await AsyncStorage.getItem(NEXT_RETRY_KEY);
  let step = 0;
  if (raw) {
    try { step = Math.min(((JSON.parse(raw).step as number) ?? 0) + 1, BACKOFF_STEPS_MS.length - 1); }
    catch { step = 0; }
  }
  const at = Date.now() + BACKOFF_STEPS_MS[step];
  await AsyncStorage.setItem(NEXT_RETRY_KEY, JSON.stringify({ at, step }));
}

/** Limpia el backoff tras un envío exitoso. */
async function clearBackoff(): Promise<void> {
  await AsyncStorage.removeItem(NEXT_RETRY_KEY);
}

// ── Diagnóstico ──────────────────────────────────────────────────────────────

export async function storeLastError(msg: string) {
  await AsyncStorage.setItem(LAST_ERROR_KEY, JSON.stringify({ msg, ts: new Date().toISOString() }));
}

export async function clearLastError() {
  await AsyncStorage.removeItem(LAST_ERROR_KEY);
}

export async function getLastError(): Promise<{ msg: string; ts: string } | null> {
  const raw = await AsyncStorage.getItem(LAST_ERROR_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function storeLastSent() {
  await AsyncStorage.setItem(LAST_SENT_KEY, new Date().toISOString());
}

export async function getLastSent(): Promise<string | null> {
  return AsyncStorage.getItem(LAST_SENT_KEY);
}

export async function getQueueCount(): Promise<number> {
  const raw = await AsyncStorage.getItem(LOC_QUEUE_KEY);
  if (!raw) return 0;
  try { return (JSON.parse(raw) as LocationRow[]).length; } catch { return 0; }
}

// ── Último punto subido (para el throttle adaptativo del locationTask) ─────────

export interface LastUploaded { lat: number; lng: number; ts: number }

export async function storeLastUploaded(p: LastUploaded): Promise<void> {
  await AsyncStorage.setItem(LAST_UPLOADED_KEY, JSON.stringify(p));
}

export async function loadLastUploaded(): Promise<LastUploaded | null> {
  const raw = await AsyncStorage.getItem(LAST_UPLOADED_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as LastUploaded; } catch { return null; }
}

// ── Technician ID (persists across background task invocations) ─────────────

export async function storeTechnicianId(id: string) {
  await AsyncStorage.setItem(TECH_ID_KEY, id);
}

export async function loadTechnicianId(): Promise<string | null> {
  return AsyncStorage.getItem(TECH_ID_KEY);
}

export async function removeTechnicianId() {
  await AsyncStorage.removeItem(TECH_ID_KEY);
}

// ── Location queue ───────────────────────────────────────────────────────────

export interface LocationRow {
  technician_id: string;
  ts: string;
  location: string; // WKT: POINT(lon lat)
  speed: number | null;
  altitude: number | null;
  bearing: number | null;
  accuracy: number | null;
  battery_level: number | null;
}

export async function enqueueLocation(row: LocationRow) {
  const raw = await AsyncStorage.getItem(LOC_QUEUE_KEY);
  const queue: LocationRow[] = raw ? JSON.parse(raw) : [];
  queue.push(row);
  // Al exceder el cap se descartan los MÁS ANTIGUOS (FIFO).
  await AsyncStorage.setItem(LOC_QUEUE_KEY, JSON.stringify(queue.slice(-LOC_QUEUE_CAP)));
}

/**
 * Drena la cola en orden FIFO (más antiguo primero), en lotes, eliminando
 * únicamente lo confirmado por el servidor. Se detiene al primer error
 * dejando el resto intacto. Respeta conectividad y backoff.
 */
export async function flushLocationQueue() {
  const raw = await AsyncStorage.getItem(LOC_QUEUE_KEY);
  if (!raw) return;
  let queue: LocationRow[] = JSON.parse(raw);
  if (!queue.length) return;
  if (!(await canRetryNow())) return;
  if (!(await isOnline())) return;

  while (queue.length) {
    const batch = queue.slice(0, FLUSH_BATCH); // más antiguos primero
    const { error } = await supabase.from('location_events').insert(batch);
    if (error) {
      await bumpBackoff();
      await storeLastError(error.message);
      await AsyncStorage.setItem(LOC_QUEUE_KEY, JSON.stringify(queue)); // conservar remanente
      return;
    }
    queue = queue.slice(batch.length);
    await AsyncStorage.setItem(LOC_QUEUE_KEY, JSON.stringify(queue)); // persistir progreso por lote
  }

  await AsyncStorage.removeItem(LOC_QUEUE_KEY);
  await clearBackoff();
  await clearLastError();
  await storeLastSent();
}

// ── Motion queue ─────────────────────────────────────────────────────────────

export interface MotionRow {
  technician_id: string;
  ts: string;
  event_type: string;
  severity: number;
  location: string | null;
}

export async function enqueueMotion(row: MotionRow) {
  const raw = await AsyncStorage.getItem(MOTION_QUEUE_KEY);
  const queue: MotionRow[] = raw ? JSON.parse(raw) : [];
  queue.push(row);
  await AsyncStorage.setItem(MOTION_QUEUE_KEY, JSON.stringify(queue.slice(-MOTION_QUEUE_CAP)));
}

/** Drena la cola de eventos de conducción en orden FIFO por lotes. */
export async function flushMotionQueue() {
  const raw = await AsyncStorage.getItem(MOTION_QUEUE_KEY);
  if (!raw) return;
  let queue: MotionRow[] = JSON.parse(raw);
  if (!queue.length) return;
  if (!(await isOnline())) return;

  while (queue.length) {
    const batch = queue.slice(0, FLUSH_BATCH);
    const { error } = await supabase.from('motion_events').insert(batch);
    if (error) {
      await AsyncStorage.setItem(MOTION_QUEUE_KEY, JSON.stringify(queue));
      return;
    }
    queue = queue.slice(batch.length);
    await AsyncStorage.setItem(MOTION_QUEUE_KEY, JSON.stringify(queue));
  }
  await AsyncStorage.removeItem(MOTION_QUEUE_KEY);
}
