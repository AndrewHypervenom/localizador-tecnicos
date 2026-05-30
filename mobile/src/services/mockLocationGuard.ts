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
}

/** Suscribe a cambios de estado. Devuelve la función para cancelar. */
export function subscribeMock(listener: Listener): () => void {
  listeners.add(listener);
  listener(_active);
  return () => { listeners.delete(listener); };
}

/** Lee una posición y devuelve true si proviene de un proveedor simulado. */
export async function checkMockOnce(): Promise<boolean> {
  try {
    const last = await Location.getLastKnownPositionAsync();
    if (last?.mocked) return true;
    const fresh = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return !!fresh?.mocked;
  } catch {
    // Sin permiso o GPS apagado: no es asunto de este guardia.
    return false;
  }
}

/** Vigilancia en primer plano: comprueba periódicamente si hay ubicación falsa. */
export function startMockWatch(intervalMs = 4_000): void {
  if (_pollTimer) return;
  const tick = async () => { setMockDetected(await checkMockOnce()); };
  void tick();
  _pollTimer = setInterval(() => { void tick(); }, intervalMs);
}

export function stopMockWatch(): void {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}
