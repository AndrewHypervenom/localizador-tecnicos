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
const LOC_DEAD_KEY      = '@localizador/location_deadletter';
const MOTION_DEAD_KEY   = '@localizador/motion_deadletter';

// Capacidad de cola dimensionada para cubrir >=4 h sin señal aun en el peor caso.
// Con el throttle adaptativo (locationTask) los puntos reales son muy inferiores.
const LOC_QUEUE_CAP    = 10_000;  // ~1.5 MB en AsyncStorage
const MOTION_QUEUE_CAP = 1_000;
const FLUSH_BATCH      = 100;     // se drena en lotes FIFO (más antiguo primero)
const DEAD_LETTER_CAP  = 2_000;   // filas rechazadas permanentemente (apartadas, no perdidas)

// Códigos SQLSTATE considerados TRANSITORIOS (vale la pena reintentar sin
// descartar nada): serialización, deadlock, timeout, exceso de conexiones,
// y toda la clase 08 (fallos de conexión).
const TRANSIENT_PG_CODES = new Set([
  '40001', '40P01', '57014', '53300', '55P03',
  '08000', '08003', '08006', '08001', '08004', '08007', '08P01',
]);

/**
 * ¿El error es transitorio (reintentar) o permanente (apartar la fila)?
 * Sin código suele ser un fallo de red/fetch → transitorio (NUNCA descartar).
 * Con código de Postgres que no esté en la lista transitoria → el servidor
 * rechazó el contenido de la fila (p.ej. `ts` fuera de partición, geometría
 * inválida): es permanente y reintentarla eternamente atascaría la cola.
 */
function isTransientError(error: any): boolean {
  const code = error?.code;
  if (!code) return true;
  return TRANSIENT_PG_CODES.has(String(code));
}

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

/** Limpia el backoff tras un envío exitoso (o al forzar sincronización manual). */
export async function clearBackoff(): Promise<void> {
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

/** Aparta una fila rechazada permanentemente para no perderla ni atascar la cola. */
async function appendDeadLetter(deadKey: string, row: any): Promise<void> {
  const raw = await AsyncStorage.getItem(deadKey);
  const dl: any[] = raw ? JSON.parse(raw) : [];
  dl.push(row);
  await AsyncStorage.setItem(deadKey, JSON.stringify(dl.slice(-DEAD_LETTER_CAP)));
}

/**
 * Drena una cola en orden FIFO por lotes. Solo elimina lo confirmado por el
 * servidor. Ante un error de LOTE:
 *   - transitorio (red/servidor) → backoff y se conserva todo para reintentar.
 *   - permanente → reintenta fila por fila; las válidas pasan y la fila "veneno"
 *     (p.ej. `ts` fuera de partición) se aparta a dead-letter, de modo que la
 *     cola NUNCA queda bloqueada para siempre por un registro irrecuperable.
 *
 * `useBackoff`/`touchDiag` permiten compartir esta lógica entre la cola de
 * ubicación (con backoff y diagnóstico visible) y la de movimiento (sin ambos).
 */
async function drainQueue(opts: {
  queueKey: string;
  deadKey: string;
  table: string;
  force: boolean;
  useBackoff: boolean;
  touchDiag: boolean;
}): Promise<void> {
  const { queueKey, deadKey, table, force, useBackoff, touchDiag } = opts;

  const raw = await AsyncStorage.getItem(queueKey);
  if (!raw) return;
  let queue: any[] = JSON.parse(raw);
  if (!queue.length) return;

  // El flush manual (force) ignora backoff y verificación de red: el usuario
  // pidió enviar AHORA. El automático respeta ambos para no malgastar batería.
  if (!force) {
    if (useBackoff && !(await canRetryNow())) return;
    if (!(await isOnline())) return;
  }

  const persist = () => AsyncStorage.setItem(queueKey, JSON.stringify(queue));

  while (queue.length) {
    const batch = queue.slice(0, FLUSH_BATCH); // más antiguos primero
    const { error } = await supabase.from(table).insert(batch);

    if (!error) {
      queue = queue.slice(batch.length);
      await persist();
      continue;
    }

    // Lote con error transitorio: backoff y conservar TODO (no perder datos).
    if (isTransientError(error)) {
      if (useBackoff) await bumpBackoff();
      if (touchDiag) await storeLastError(error.message);
      await persist();
      return;
    }

    // Lote con error permanente: hay al menos una fila irrecuperable. Reintentar
    // fila por fila para no perder las buenas ni atascarnos en la mala.
    const n = batch.length;
    for (let i = 0; i < n; i++) {
      const row = queue[0];
      const { error: e1 } = await supabase.from(table).insert(row);
      if (!e1) {
        queue = queue.slice(1);
        await persist();
        continue;
      }
      if (isTransientError(e1)) {
        if (useBackoff) await bumpBackoff();
        if (touchDiag) await storeLastError(e1.message);
        await persist();
        return; // conservar esta fila y el resto para el próximo intento
      }
      // Permanente → apartar y seguir drenando.
      await appendDeadLetter(deadKey, row);
      if (touchDiag) await storeLastError(`Registro apartado (rechazado por el servidor): ${e1.message}`);
      queue = queue.slice(1);
      await persist();
    }
  }

  await AsyncStorage.removeItem(queueKey);
  if (useBackoff) await clearBackoff();
  if (touchDiag) { await clearLastError(); await storeLastSent(); }
}

export async function flushLocationQueue(force = false) {
  await drainQueue({
    queueKey: LOC_QUEUE_KEY,
    deadKey:  LOC_DEAD_KEY,
    table:    'location_events',
    force,
    useBackoff: true,
    touchDiag:  true,
  });
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
export async function flushMotionQueue(force = false) {
  await drainQueue({
    queueKey: MOTION_QUEUE_KEY,
    deadKey:  MOTION_DEAD_KEY,
    table:    'motion_events',
    force,
    useBackoff: false,
    touchDiag:  false,
  });
}
