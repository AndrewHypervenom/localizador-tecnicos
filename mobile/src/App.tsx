import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useDeviceId } from './hooks/useDeviceId';
import { supabase, ensureAuth } from './lib/supabase';
import HomeScreen from './screens/HomeScreen';
import RegisterScreen from './screens/RegisterScreen';

type AppState = 'loading' | 'register' | 'home';

export default function App() {
  const deviceId = useDeviceId();
  const [appState, setAppState]     = useState<AppState>('loading');
  const [techName, setTechName]     = useState<string | null>(null);

  useEffect(() => {
    if (!deviceId) return;

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
  }, [deviceId]);

  if (appState === 'loading') {
    return (
      <View style={styles.splash}>
        <StatusBar style="light" />
        <ActivityIndicator size="large" color="#00D632" />
      </View>
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
