import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

const LOC_QUEUE_KEY     = '@localizador/location_queue';
const MOTION_QUEUE_KEY  = '@localizador/motion_queue';
const TECH_ID_KEY       = '@localizador/technician_id';
const LAST_ERROR_KEY    = '@localizador/last_error';
const LAST_SENT_KEY     = '@localizador/last_sent';

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
  await AsyncStorage.setItem(LOC_QUEUE_KEY, JSON.stringify(queue.slice(-500)));
}

export async function flushLocationQueue() {
  const raw = await AsyncStorage.getItem(LOC_QUEUE_KEY);
  if (!raw) return;
  const queue: LocationRow[] = JSON.parse(raw);
  if (!queue.length) return;
  const batch = queue.slice(-50);
  const { error } = await supabase.from('location_events').insert(batch);
  if (!error) {
    await AsyncStorage.removeItem(LOC_QUEUE_KEY);
    await storeLastSent();
  } else if (queue.length > 100) {
    await AsyncStorage.setItem(LOC_QUEUE_KEY, JSON.stringify(queue.slice(-100)));
  }
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
  await AsyncStorage.setItem(MOTION_QUEUE_KEY, JSON.stringify(queue.slice(-200)));
}

export async function flushMotionQueue() {
  const raw = await AsyncStorage.getItem(MOTION_QUEUE_KEY);
  if (!raw) return;
  const queue: MotionRow[] = JSON.parse(raw);
  if (!queue.length) return;
  const { error } = await supabase.from('motion_events').insert(queue);
  if (!error) await AsyncStorage.removeItem(MOTION_QUEUE_KEY);
}
