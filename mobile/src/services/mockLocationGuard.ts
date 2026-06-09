import * as Location from 'expo-location';

// ── Anti "Fake GPS" ───────────────────────────────────────────────────────────
// Android marca cada fix con `mocked = true` cuando proviene de una app de
// ubicación simulada (Fake GPS, Lockito, etc.). Usamos ese indicador para
// bloquear la app mientras esté activa una app que falsea la ubicación.
//
// El bloqueo se levanta solo cuando los fixes vuelven a ser reales, es decir
// cuando el técnico cierra la app de fake GPS o reinicia el teléfono.

type Listener = (active: boolean) => void;

const listeners = new Set<Listener>();
let _active = false;
let _pollTimer: ReturnType<typeof setInterval> | null = null;

function emit(): void {
  for (const l of listeners) l(_active);
}

/** Estado actual: ¿se está detectando ubicación falsa ahora mismo? */
export function isMockDetected(): boolean {
  return _active;
}

/** Marca/desmarca la detección y notifica a los suscriptores si cambió. */
export function setMockDetected(active: boolean): void {
  if (active === _active) return;
  _active = active;
  emit();
  // El ritmo del poll depende del estado (lento vigilando / rápido bloqueado):
  // reprogramarlo al cambiar.
  rescheduleWatch();
}

/** Suscribe a cambios de estado. Devuelve la función para cancelar. */
export function subscribeMock(listener: Listener): () => void {
  listeners.add(listener);
  listener(_active);
  return () => { listeners.delete(listener); };
}

// Si el último fix conocido tiene menos de esta edad, su flag `mocked` basta
// para decidir y NO se pide un fix nuevo (getCurrentPositionAsync enciende el
// GPS a propósito: era la mayor fuga de batería de la app cuando corría cada 4 s).
// Con el rastreo activo siempre hay un fix de ≤30 s, así que el camino caro casi
// nunca se ejecuta.
const LAST_FIX_MAX_AGE_MS = 60_000;

/** Lee una posición y devuelve true si proviene de un proveedor simulado. */
export async function checkMockOnce(): Promise<boolean> {
  try {
    const last = await Location.getLastKnownPositionAsync({ maxAge: LAST_FIX_MAX_AGE_MS });
    if (last) return !!last.mocked;
    // Sin fix reciente (rastreo detenido o bloqueo activo): pedir uno de verdad.
    const fresh = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return !!fresh?.mocked;
  } catch {
    // Sin permiso o GPS apagado: no es asunto de este guardia.
    return false;
  }
}

// Ritmo del poll de respaldo. La detección instantánea la hace el stream de
// rastreo (locationTask marca cada fix con `mocked`); este timer solo cubre:
//  - vigilancia: por si el rastreo no está corriendo → 60 s basta.
//  - bloqueado: el rastreo está suspendido y este poll es la ÚNICA vía de
//    desbloqueo al cerrar la app falsa → 10 s para levantar el bloqueo rápido.
const WATCH_INTERVAL_MS   = 60_000;
const BLOCKED_INTERVAL_MS = 10_000;

function rescheduleWatch(): void {
  if (!_pollTimer) return;          // el watch no está iniciado
  clearInterval(_pollTimer);
  const tick = async () => { setMockDetected(await checkMockOnce()); };
  _pollTimer = setInterval(() => { void tick(); }, _active ? BLOCKED_INTERVAL_MS : WATCH_INTERVAL_MS);
}

/** Vigilancia en primer plano: comprueba periódicamente si hay ubicación falsa. */
export function startMockWatch(): void {
  if (_pollTimer) return;
  const tick = async () => { setMockDetected(await checkMockOnce()); };
  void tick();
  _pollTimer = setInterval(() => { void tick(); }, _active ? BLOCKED_INTERVAL_MS : WATCH_INTERVAL_MS);
}

export function stopMockWatch(): void {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}
