import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState as RNAppState, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useDeviceId } from './hooks/useDeviceId';
import { supabase, ensureAuth } from './lib/supabase';
import HomeScreen from './screens/HomeScreen';
import RegisterScreen from './screens/RegisterScreen';
import TermsScreen, { hasAcceptedTerms } from './screens/TermsScreen';
import MockBlockedScreen from './screens/MockBlockedScreen';
import { startMockWatch, stopMockWatch, subscribeMock, checkMockOnce, setMockDetected } from './services/mockLocationGuard';
import { stopTracking } from './services/locationService';

type AppState = 'loading' | 'terms' | 'register' | 'home';

export default function App() {
  const deviceId = useDeviceId();
  const [appState, setAppState]         = useState<AppState>('loading');
  const [techName, setTechName]         = useState<string | null>(null);
  const [termsOk, setTermsOk]           = useState(false);
  const [mockBlocked, setMockBlocked]   = useState(false);

  // Anti "Fake GPS": vigila si una app está simulando la ubicación. Si la
  // detecta, suspende el rastreo y muestra una pantalla de bloqueo hasta que
  // los fixes vuelvan a ser reales (al cerrar la app falsa o reiniciar).
  useEffect(() => {
    const unsub = subscribeMock((active) => {
      setMockBlocked(active);
      if (active) void stopTracking();
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

  // Paso 2: verificar registro del dispositivo una vez que los términos están ok
  useEffect(() => {
    if (!termsOk || !deviceId) return;

    ensureAuth().then(() =>
      supabase
        .from('technicians')
        .select('id, name')
        .eq('device_id', deviceId)
        .maybeSingle()
        .then(({ data }) => {
          if (data) {
            setTechName(data.name);
            setAppState('home');
          } else {
            setAppState('register');
          }
        })
    );
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
            setAppState('home');
          }}
        />
      </>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <HomeScreen />
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
