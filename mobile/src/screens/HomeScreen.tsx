import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import { useDeviceId } from '../hooks/useDeviceId';
import { supabase, ensureAuth } from '../lib/supabase';
import {
  isTracking,
  requestPermissions,
  hasAllPermissions,
  startTracking,
  stopTracking,
} from '../services/locationService';
import { ensureBatteryOptimizationExempt } from '../services/batteryOptimization';
import { reportSosEvent } from '../services/sensorService';
import { registerWatchdog } from '../services/watchdog';
import {
  flushLocationQueue,
  flushMotionQueue,
  getLastError,
  getLastSent,
  getQueueCount,
  clearLastError,
  clearBackoff,
  loadTechnicianId,
} from '../services/offlineQueue';

function timeAgo(isoStr: string): string {
  const secs = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (secs < 60)   return `hace ${secs}s`;
  if (secs < 3600) return `hace ${Math.floor(secs / 60)}m`;
  return `hace ${Math.floor(secs / 3600)}h`;
}

export default function HomeScreen() {
  const deviceId = useDeviceId();

  const [tracking,    setTracking]    = useState(false);
  const [techName,    setTechName]    = useState<string | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [syncing,     setSyncing]     = useState(false);
  const [queueCount,  setQueueCount]  = useState(0);
  const [lastSent,    setLastSent]    = useState<string | null>(null);
  const [lastError,   setLastError]   = useState<{ msg: string; ts: string } | null>(null);
  const [refreshing,  setRefreshing]  = useState(false);

  const loadDiagnostics = useCallback(async () => {
    const [count, sent, err] = await Promise.all([
      getQueueCount(),
      getLastSent(),
      getLastError(),
    ]);
    setQueueCount(count);
    setLastSent(sent);
    setLastError(err);
  }, []);

  useEffect(() => {
    loadDiagnostics();
    const interval = setInterval(loadDiagnostics, 10_000);
    return () => clearInterval(interval);
  }, [loadDiagnostics]);

  // Watchdog en primer plano: si había sesión activa pero el SO mató el
  // servicio de ubicación, reiniciarlo al volver a abrir la app.
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (state) => {
      if (state !== 'active') return;
      try {
        const techId = await loadTechnicianId();
        if (!techId) return;
        if (!(await isTracking())) {
          await startTracking(techId);
          setTracking(true);
        }
      } catch (e: any) {
        console.error('[Watchdog AppState]', e?.message);
      }
    });
    return () => sub.remove();
  }, []);

  // Inicialización: auto-arranca si había sesión previa y permisos ya concedidos
  useEffect(() => {
    if (!deviceId) return;

    async function init() {
      try {
        const active = await isTracking();
        if (active) {
          setTracking(true);
          setLoading(false);
          return;
        }

        // Auto-arranque silencioso: solo si permisos ya concedidos y había sesión
        const storedTechId = await loadTechnicianId();
        if (storedTechId && await hasAllPermissions()) {
          const { data: tech } = await supabase
            .from('technicians')
            .select('id, name')
            .eq('device_id', deviceId)
            .maybeSingle();

          if (tech) {
            await startTracking(tech.id);
            await registerWatchdog();
            setTechName(tech.name);
            setTracking(true);
            setLoading(false);
            return;
          }
        }

        // Sin auto-arranque: cargar nombre y esperar acción manual
        const { data } = await supabase
          .from('technicians')
          .select('name')
          .eq('device_id', deviceId)
          .maybeSingle();
        setTechName(data?.name ?? null);
      } catch (e: any) {
        console.error('[init]', e?.message);
      } finally {
        setLoading(false);
      }
    }

    init();
  }, [deviceId]);

  async function handleToggle() {
    if (tracking) {
      setLoading(true);
      await stopTracking();
      setTracking(false);
      setLoading(false);
      return;
    }

    if (!deviceId) {
      Alert.alert('Error', 'No se pudo obtener el ID del dispositivo.');
      return;
    }

    const { data: tech } = await supabase
      .from('technicians')
      .select('id, name')
      .eq('device_id', deviceId)
      .maybeSingle();

    if (!tech) {
      Alert.alert('Dispositivo no registrado', 'Este teléfono no está registrado. Contacte al administrador.');
      return;
    }

    const servicesOn = await Location.hasServicesEnabledAsync();
    if (!servicesOn) {
      Alert.alert('GPS desactivado', 'Activa la ubicación del dispositivo en Ajustes y vuelve a intentarlo.');
      return;
    }

    const granted = await requestPermissions();
    if (!granted) {
      Alert.alert('Permisos requeridos', 'Concede permiso de ubicación "Siempre" en Ajustes > Aplicaciones > Localizador > Permisos > Ubicación.');
      return;
    }

    setLoading(true);
    try {
      await startTracking(tech.id);
      await registerWatchdog();
      setTechName(tech.name);
      setTracking(true);
      // Pedir exención de optimización de batería para sostener >=4 h continuas.
      await ensureBatteryOptimizationExempt();
    } catch (e: any) {
      Alert.alert('Error al iniciar rastreo', e?.message ?? 'No se pudo iniciar el servicio GPS. Reinicia la app e intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  async function handleForceSync() {
    setSyncing(true);
    try {
      await ensureAuth();
      await clearBackoff();                 // ignorar la ventana de espera: envío inmediato
      await flushLocationQueue(true);       // force = true: salta backoff y check de red
      await flushMotionQueue(true);

      const remaining = await getQueueCount();
      if (remaining === 0) {
        await clearLastError();
        await loadDiagnostics();
        Alert.alert('Sincronizado', 'Datos enviados correctamente.');
      } else {
        // Quedó cola: mostrar el motivo real (lo guardó flushLocationQueue).
        await loadDiagnostics();
        const err = await getLastError();
        Alert.alert(
          'Sincronización incompleta',
          err?.msg ?? `Quedan ${remaining} eventos en cola. Revisa la conexión e inténtalo de nuevo.`,
        );
      }
    } catch (e: any) {
      Alert.alert('Error de sincronización', e?.message ?? 'No se pudo conectar con el servidor.');
    } finally {
      setSyncing(false);
    }
  }

  function handleSos() {
    if (!deviceId) return;
    Alert.alert(
      'Enviar SOS',
      '¿Enviar una alerta de emergencia a tu líder ahora?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Enviar SOS',
          style: 'destructive',
          onPress: async () => {
            try {
              const { data: tech } = await supabase
                .from('technicians')
                .select('id')
                .eq('device_id', deviceId)
                .maybeSingle();
              if (!tech) { Alert.alert('Error', 'Este dispositivo no está registrado.'); return; }

              const status = await reportSosEvent(tech.id);
              await loadDiagnostics();
              Alert.alert(
                'SOS',
                status === 'sent'
                  ? 'Alerta enviada a tu líder.'
                  : 'Sin conexión: el SOS se enviará automáticamente al reconectar.',
              );
            } catch (e: any) {
              Alert.alert('Error', e?.message ?? 'No se pudo enviar el SOS.');
            }
          },
        },
      ],
    );
  }

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadDiagnostics();
    setRefreshing(false);
  }, [loadDiagnostics]);

  const hasError   = !!lastError;
  const statusText = tracking ? 'Rastreando' : 'Inactivo';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00D632" />}
      >
        {/* Header con logo */}
        <View style={styles.logoRow}>
          <Image
            source={require('../../assets/icon.png')}
            style={styles.logoImg}
            resizeMode="cover"
          />
          <View>
            <Text style={styles.title}>Localizador</Text>
            <Text style={styles.titleSub}>PositivoS+</Text>
          </View>
        </View>

        {/* Técnico */}
        <View style={styles.section}>
          <Text style={styles.label}>TÉCNICO</Text>
          <Text style={styles.value}>
            {techName ?? (deviceId ? 'No registrado' : 'Cargando…')}
          </Text>
        </View>

        {/* Estado de rastreo */}
        <View style={[styles.section, styles.statusSection, tracking ? styles.statusActive : styles.statusInactive]}>
          <View style={[styles.dot, tracking ? styles.dotActive : styles.dotInactive]} />
          <Text style={[styles.statusText, tracking ? styles.textActive : styles.textInactive]}>
            {statusText}
          </Text>
        </View>

        {/* Diagnósticos */}
        <View style={styles.diagBox}>
          <Text style={styles.diagTitle}>ESTADO DE CONEXIÓN</Text>

          <View style={styles.diagRow}>
            <Text style={styles.diagLabel}>Último envío</Text>
            <Text style={[styles.diagValue, !lastSent && styles.diagWarn]}>
              {lastSent ? timeAgo(lastSent) : 'Nunca'}
            </Text>
          </View>

          <View style={styles.diagRow}>
            <Text style={styles.diagLabel}>Cola pendiente</Text>
            <Text style={[styles.diagValue, queueCount > 0 && styles.diagWarn]}>
              {queueCount > 0 ? `${queueCount} eventos` : 'Vacía'}
            </Text>
          </View>

          {hasError && (
            <View style={styles.errorBox}>
              <Text style={styles.errorTitle}>⚠ Error de envío</Text>
              <Text style={styles.errorMsg}>{lastError!.msg}</Text>
              <Text style={styles.errorTime}>{timeAgo(lastError!.ts)}</Text>
            </View>
          )}
        </View>

        {/* Botón force sync */}
        {(queueCount > 0 || hasError) && (
          <TouchableOpacity
            style={[styles.button, styles.btnSync]}
            onPress={handleForceSync}
            disabled={syncing}
          >
            {syncing
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.btnText}>Forzar Sincronización ({queueCount})</Text>
            }
          </TouchableOpacity>
        )}

        {/* Botón SOS — alerta de emergencia al líder */}
        {techName && (
          <TouchableOpacity style={[styles.button, styles.btnSos]} onPress={handleSos}>
            <Text style={styles.btnText}>🆘 ENVIAR SOS</Text>
          </TouchableOpacity>
        )}

        {/* Botón principal */}
        <TouchableOpacity
          style={[styles.button, tracking ? styles.btnStop : styles.btnStart]}
          onPress={handleToggle}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.btnText}>{tracking ? 'DETENER RASTREO' : 'INICIAR RASTREO'}</Text>
          }
        </TouchableOpacity>

        <Text style={styles.hint}>Desliza hacia abajo para actualizar</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#0A0A14' },
  scroll:         { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 16 },

  logoRow:        { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 8 },
  logoImg:        { width: 56, height: 56, borderRadius: 14 },
  title:          { fontSize: 24, fontWeight: '700', color: '#f8fafc' },
  titleSub:       { fontSize: 13, fontWeight: '600', color: '#00D632', marginTop: 1 },

  section:        { width: '100%', backgroundColor: '#141420', borderRadius: 12, padding: 16 },
  label:          { fontSize: 11, color: '#64748b', letterSpacing: 1.2, marginBottom: 4 },
  value:          { fontSize: 18, color: '#f8fafc', fontWeight: '600' },

  statusSection:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusActive:   { borderLeftWidth: 3, borderLeftColor: '#00D632' },
  statusInactive: { borderLeftWidth: 3, borderLeftColor: '#64748b' },
  dot:            { width: 10, height: 10, borderRadius: 5 },
  dotActive:      { backgroundColor: '#00D632' },
  dotInactive:    { backgroundColor: '#64748b' },
  statusText:     { fontSize: 17, fontWeight: '700' },
  textActive:     { color: '#00D632' },
  textInactive:   { color: '#94a3b8' },

  diagBox:        { width: '100%', backgroundColor: '#141420', borderRadius: 12, padding: 16, gap: 10 },
  diagTitle:      { fontSize: 11, color: '#64748b', letterSpacing: 1.2, marginBottom: 4 },
  diagRow:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  diagLabel:      { fontSize: 13, color: '#94a3b8' },
  diagValue:      { fontSize: 13, color: '#f8fafc', fontWeight: '600' },
  diagWarn:       { color: '#f59e0b' },

  errorBox:       { backgroundColor: '#2a0505', borderRadius: 8, padding: 12, gap: 4, marginTop: 4 },
  errorTitle:     { color: '#fca5a5', fontSize: 12, fontWeight: '700' },
  errorMsg:       { color: '#fca5a5', fontSize: 12 },
  errorTime:      { color: '#ef4444', fontSize: 11 },

  button:         { width: '100%', paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  btnStart:       { backgroundColor: '#00B82B' },
  btnStop:        { backgroundColor: '#dc2626' },
  btnSos:         { backgroundColor: '#b91c1c', borderWidth: 1, borderColor: '#fecaca' },
  btnSync:        { backgroundColor: '#7B2FF7' },
  btnText:        { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.5 },
  hint:           { fontSize: 11, color: '#252540', marginTop: 8 },
});
