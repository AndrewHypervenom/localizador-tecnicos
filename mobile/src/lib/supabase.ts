import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const url     = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(url, anonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

/** Garantiza una sesión válida. Refresca o re-autentica si es necesario. */
export async function ensureAuth(): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    const { error } = await supabase.auth.signInAnonymously();
    if (error) throw new Error(`Auth anónimo falló: ${error.message}`);
    return;
  }

  // Refrescar si el token expira en menos de 2 minutos
  const expiresAt  = session.expires_at ?? 0;
  const nowSeconds = Date.now() / 1000;
  if (expiresAt < nowSeconds + 120) {
    const { error } = await supabase.auth.refreshSession();
    if (error) {
      // Refresh falló — crear nueva sesión anónima
      const { error: signInErr } = await supabase.auth.signInAnonymously();
      if (signInErr) throw new Error(`Re-auth falló: ${signInErr.message}`);
    }
  }
}
