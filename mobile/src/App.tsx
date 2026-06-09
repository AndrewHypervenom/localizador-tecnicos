import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState as RNAppState, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useDeviceId } from './hooks/useDeviceId';
import { supabase, ensureAuth } from './lib/supabase';
import {
  loadTechnicianId,
  loadTechnicianName,
  storeTechnicianName,
  removeTechnicianName,
} from './services/offlineQueue';
import HomeScreen from './screens/HomeScreen';
import RegisterScreen from './screens/RegisterScreen';
import TermsScreen, { hasAcceptedTerms } from './screens/TermsScreen';
import MockBlockedScreen from './screens/MockBlockedScreen';
import { startMockWatch, stopMockWatch, subscribeMock, checkMockOnce, setMockDetected } from './services/mockLocationGuard';
import { stopTracking } from './services/locationService';
import { reportDeviceEvent } from './services/sensorService';

type AppState = 'loading' | 'terms' | 'register' | 'home';

export default function App() {
  const deviceId = useDeviceId();
  const [appState, setAppState]         = useState<AppState>('loading');
  const [techName, setTechName]         = useState<string | null>(null);
  const [termsOk, setTermsOk]           = useState(false);
  const [mockBlocked, setMockBlocked]   = useState(false);
  // true cuando se llega a la pantalla de registro desde el botón "Volver a
  // registrar" del Home (permite cancelar y volver), no en el registro inicial.
  const [canCancelRegister, setCanCancelRegister] = useState(false);

  // Anti "Fake GPS": vigila si una app está simulando la ubicación. Si la
  // detecta, suspende el rastreo y muestra una pantalla de bloqueo hasta que
  // los fixes vuelvan a ser reales (al cerrar la app falsa o reiniciar).
  useEffect(() => {
    const unsub = subscribeMock((active) => {
      setMockBlocked(active);
      if (active) {
        // Fake GPS detectado: dejar EVIDENCIA para el líder (con la última
        // posición conocida) ANTES de stopTracking(), que borra el technicianId.
        void (async () => {
          const techId = await loadTechnicianId();
          if (techId) await reportDeviceEvent(techId, 'mock_on');
          await stopTracking();
        })();
      }
    });
    startMockWatch();
    const appSub = RNAppState.addEventListener('change', (s) => {
      if (s === 'active') void checkMockOnce().then(setMockDetected);
    });
    return () => { unsub(); stopMockWatch(); appSub.remove(); };
  }, []);

  // Paso 1: verificar términos al iniciar
  useEffect(() => {
    if (!deviceId) return;
    hasAcceptedTerms().then(accepted => {
      if (accepted) {
        setTermsOk(true);
      } else {
        setAppState('terms');
      }
    });
  }, [deviceId]);

  // Paso 2: verificar registro del dispositivo una vez que los términos están ok.
  // Si el device_id no está enlazado a ningún técnico, se exige escanear el QR
  // de nuevo (evita inconsistencias de sincronización con un enlace incorrecto).
  //
  // IMPORTANTE: distinguir "el servidor confirma que NO está registrado" de
  // "no pude verificar" (sesión vencida, RLS, sin red). Un fallo de lectura NO
  // debe mandar al técnico a re-escanear el QR ni mostrar "No registrado" si ya
  // estaba vinculado: en ese caso confiamos en el cache local.
  useEffect(() => {
    if (!termsOk || !deviceId) return;

    async function verifyRegistration() {
      try {
        await ensureAuth();
        const { data, error } = await supabase
          .from('technicians')
          .select('id, name')
          .eq('device_id', deviceId)
          .maybeSingle();

        if (error) throw error; // lectura fallida → caer al fallback de cache

        if (data) {
          // Confirmado por el servidor: vinculado.
          await storeTechnicianName(data.name);
          setTechName(data.name);
          setAppState('home');
        } else {
          // Respuesta autoritativa: este device_id NO está vinculado.
          await removeTechnicianName();
          setAppState('register');
        }
      } catch (e: any) {
        // No se pudo verificar. Si el dispositivo ya estaba registrado
        // (hay id/nombre en cache), entrar al Home con el último nombre
        // conocido en vez de exigir un QR nuevo por un hipo transitorio.
        console.warn('[verifyRegistration]', e?.message);
        const [cachedId, cachedName] = await Promise.all([
          loadTechnicianId(),
          loadTechnicianName(),
        ]);
        if (cachedId || cachedName) {
          setTechName(cachedName);
          setAppState('home');
        } else {
          // Nunca estuvo registrado en este teléfono: pedir QR.
          setAppState('register');
        }
      }
    }

    verifyRegistration();
  }, [termsOk, deviceId]);

  // El bloqueo por ubicación falsa tiene prioridad sobre cualquier pantalla.
  if (mockBlocked) {
    return (
      <>
        <StatusBar style="light" />
        <MockBlockedScreen />
      </>
    );
  }

  if (appState === 'loading') {
    return (
      <View style={styles.splash}>
        <StatusBar style="light" />
        <ActivityIndicator size="large" color="#00D632" />
      </View>
    );
  }

  if (appState === 'terms') {
    return (
      <>
        <StatusBar style="light" />
        <TermsScreen onAccept={() => setTermsOk(true)} />
      </>
    );
  }

  if (appState === 'register') {
    return (
      <>
        <StatusBar style="light" />
        <RegisterScreen
          onRegistered={(name) => {
            setTechName(name);
            setCanCancelRegister(false);
            setAppState('home');
          }}
          onCancel={canCancelRegister ? () => { setCanCancelRegister(false); setAppState('home'); } : undefined}
        />
      </>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <HomeScreen
        onReRegister={() => { setCanCancelRegister(true); setAppState('register'); }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: '#0A0A14',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
