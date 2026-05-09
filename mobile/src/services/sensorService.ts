import { Accelerometer } from 'expo-sensors';
import { supabase } from '../lib/supabase';
import { enqueueMotion, type MotionRow } from './offlineQueue';

// Thresholds (mirrors the Kotlin SensorMonitorService)
const ACCIDENT_THRESHOLD_MS2 = 25.0;  // m/s² net magnitude
const HARD_BRAKE_DELTA       = 8.0;   // m/s drop in 3s window
const RAPID_ACCEL_DELTA      = 8.0;   // m/s gain in 3s window
const HARSH_TURN_DEG         = 45.0;  // degrees in 2s window
const EVENT_SPEED_MIN_MS     = 5.0;   // only above ~18 km/h
const TIME_WINDOW_MS         = 3_000;
const COOLDOWN_MS            = 3_000;
const SUSTAINED_ACCIDENT_MS  = 150;   // ms above threshold to confirm accident

// Module-level state (survives background task re-invocations in the same JS thread)
let _technicianId    = '';
let _lastSpeedMs     = 0;
let _lastSpeedTs     = 0;
let _lastBearingDeg  = 0;
let _lastBearingTs   = 0;
let _highGStartTs    = 0;
const _lastEventTs   = new Map<string, number>();

let _subscription: ReturnType<typeof Accelerometer.addListener> | null = null;

export function setTechIdForSensor(id: string) {
  _technicianId = id;
}

// ── Foreground-only: accelerometer crash detection ───────────────────────────

export function startAccelerometer() {
  if (_subscription) return;
  Accelerometer.setUpdateInterval(100);
  _subscription = Accelerometer.addListener(({ x, y, z }) => {
    // Remove gravity component (same approach as Kotlin TYPE_ACCELEROMETER fallback)
    const rawMag = Math.sqrt(x * x + y * y + z * z);
    const netMag = Math.max(rawMag - 9.81, 0);
    const now = Date.now();

    if (netMag > ACCIDENT_THRESHOLD_MS2) {
      if (_highGStartTs === 0) {
        _highGStartTs = now;
      } else if (now - _highGStartTs >= SUSTAINED_ACCIDENT_MS) {
        reportMotionEvent('accident', netMag);
        _highGStartTs = 0;
      }
    } else {
      _highGStartTs = 0;
    }
  });
}

export function stopAccelerometer() {
  _subscription?.remove();
  _subscription  = null;
  _highGStartTs  = 0;
}

// ── GPS-based motion detection (called from background location task) ─────────

export function detectMotionFromGPS(speedMs: number, bearingDeg: number) {
  const now = Date.now();

  if (_lastSpeedTs > 0 && now - _lastSpeedTs <= TIME_WINDOW_MS) {
    const brakeDelta = _lastSpeedMs - speedMs;
    if (brakeDelta >= HARD_BRAKE_DELTA && _lastSpeedMs > EVENT_SPEED_MIN_MS) {
      reportMotionEvent('hard_brake', brakeDelta);
    }
    const accelDelta = speedMs - _lastSpeedMs;
    if (accelDelta >= RAPID_ACCEL_DELTA) {
      reportMotionEvent('rapid_accel', accelDelta);
    }
  }

  if (_lastBearingTs > 0 && speedMs > EVENT_SPEED_MIN_MS && now - _lastBearingTs <= 2_000) {
    let delta = Math.abs(bearingDeg - _lastBearingDeg);
    if (delta > 180) delta = 360 - delta;
    if (delta >= HARSH_TURN_DEG) {
      reportMotionEvent('harsh_turn', delta);
    }
  }

  _lastSpeedMs    = speedMs;
  _lastSpeedTs    = now;
  _lastBearingDeg = bearingDeg;
  _lastBearingTs  = now;
}

// ── Internal ─────────────────────────────────────────────────────────────────

async function reportMotionEvent(type: string, severity: number) {
  const now    = Date.now();
  const lastTs = _lastEventTs.get(type) ?? 0;
  if (now - lastTs < COOLDOWN_MS) return;
  _lastEventTs.set(type, now);

  if (!_technicianId) return;

  const row: MotionRow = {
    technician_id: _technicianId,
    ts:            new Date().toISOString(),
    event_type:    type,
    severity,
    location:      null,
  };

  try {
    const { error } = await supabase.from('motion_events').insert(row);
    if (error) throw error;
  } catch {
    await enqueueMotion(row);
  }
}
