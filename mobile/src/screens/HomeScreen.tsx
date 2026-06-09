import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  Linking,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import NetInfo from '@react-native-community/netinfo';
import { useDeviceId } from '../hooks/useDeviceId';
import {
  LocationPinIcon,
  SignalIcon,
  CheckCircleIcon,
  WarningTriangle,
  StatusRow,
} from '../components/StatusIndicators';
import { supabase, ensureAuth } from '../lib/supabase';
import {
  isTracking,
  requestPermissions,
  hasAllPermissions,
  startTracking,
  stopTracking,
  ensureTrackingHealthy,
} from '../services/locationService';
import {
  ensureBatteryOptimizationExempt,
  getBatteryGuard,
  dismissBatteryGuard,
  openBatterySettings,
  type BatteryGuard,
} from '../services/batteryOptimization';
import { reportSosEvent, reportDeviceEvent } from '../services/sensorService';
import { auditGps, auditNet, auditBatteryOpt, auditTrackingKilled, auditPermission } from '../services/deviceAudit';
import { registerWatchdog } from '../services/watchdog';
import { sendHeartbeat } from '../services/heartbeat';
import {
  flushLocationQueue,
  flushMotionQueue,
  isOnline,
  getLastError,
  getLastSent,
  getQueueCount,
  clearLastError,
  clearBackoff,
  loadTechnicianId,
  loadTechnicianName,
  storeTechnicianName,
  removeTechnicianName,
} from '../services/offlineQueue';

function timeAgo(isoStr: string): string {
  const secs = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (secs < 60)   return `hace ${secs}s`;
  if (secs < 3600) return `hace ${Math.floor(secs / 60)}m`;
  return `hace ${Math.floor(secs / 3600)}h`;
}

export default function HomeScreen({ onReRegister }: { onReRegister?: () => void }) {
  const deviceId = useDeviceId();

  const [tracking,    setTracking]    = useState(false);
  const [techName,    setTechName]    = useState<string | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [syncing,     setSyncing]     = useState(false);
  const [queueCount,  setQueueCount]  = useState(0);
  const [lastSent,    setLastSent]    = useState<string | null>(null);
  const [lastError,   setLastError]   = useState<{ msg: string; ts: string } | null>(null);
  const [refreshing,  setRefreshing]  = useState(false);

  // Estado real del dispositivo (para detectar GPS apagado / sin internet / sin permiso)
  const [gpsOn,    setGpsOn]    = useState<boolean | null>(null);
  const [permLevel, setPermLevel] = useState<'full' | 'partial' | 'none' | null>(null);
  const [battery,  setBattery]  = useState<BatteryGuard | null>(null);
  const [net,      setNet]      = useState<{ connected: boolean; type: string }>({ connected: true, type: 'unknown' });

  // Lee el estado del GPS y de los permisos de ubicación (sin abrir Ajustes ni diálogos).
  const loadDeviceStatus = useCallback(async () => {
    try {
      const servicesOn = await Location.hasServicesEnabledAsync();
      setGpsOn(servicesOn);
      // Auditar la transición del GPS contra el estado PERSISTIDO (compartido con
      // el watchdog en segundo plano, así no se duplican eventos). auditGps solo
      // deja evidencia si hay sesión de rastreo activa. Si volvió a encenderse,
      // re-suscribir el servicio al instante (Android no reanuda solo).
      const gpsEvent = await auditGps(servicesOn);
      if (gpsEvent === 'gps_on') void ensureTrackingHealthy();

      const { status: fg } = await Location.getForegroundPermissionsAsync();
      const { status: bg } = await Location.getBackgroundPermissionsAsync();
      const level = fg !== 'granted' ? 'none' : bg === 'granted' ? 'full' : 'partial';
      setPermLevel(level);
      // Evidencia si el técnico bajó de "Permitir siempre" a "Solo en uso" o lo
      // revocó (el truco para romper el rastreo de fondo sin apagar el GPS).
      void auditPermission(level);

      const guard = await getBatteryGuard();
      setBattery(guard);
      // Evidencia si re-activaron la optimización de batería (el truco para que el
      // SO mate el servicio). Solo en Android no-Xiaomi: en Xiaomi la capa MIUI no
      // es legible, y ahí needsAttention == optimized.
      if (!guard.xiaomi) void auditBatteryOpt(guard.needsAttention);
    } catch (e: any) {
      console.error('[deviceStatus]', e?.message);
    }
  }, []);


  // Sondeo periódico del GPS y permisos (no tienen listener nativo directo).
  // 10 s basta para la auditoría de transiciones; sondear más rápido solo gasta
  // batería en primer plano.
  useEffect(() => {
    loadDeviceStatus();
    const interval = setInterval(loadDeviceStatus, 10_000);
    return () => clearInterval(interval);
  }, [loadDeviceStatus]);

  // Refresca el nombre del técnico desde el servidor, distinguiendo una lectura
  // fallida (conserva el nombre en cache) de una respuesta autoritativa que
  // confirma que el dispositivo ya no está vinculado.
  const refreshTechName = useCallback(async () => {
    if (!deviceId) return;
    try {
      await ensureAuth();
      const { data, error } = await supabase
        .from('technicians')
        .select('name')
        .eq('device_id', deviceId)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        await storeTechnicianName(data.name);
        setTechName(data.name);
      } else {
        await removeTechnicianName();
        setTechName(null);
      }
    } catch (e: any) {
      // No se pudo verificar: mantener el último nombre conocido.
      const cached = await loadTechnicianName();
      if (cached) setTechName(cached);
      console.warn('[refreshTechName]', e?.message);
    }
  }, [deviceId]);

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
    const interval = setInterval(loadDiagnostics, 20_000);
    return () => clearInterval(interval);
  }, [loadDiagnostics]);

  // Drenar la cola directamente cuando la cola tenga datos, sin depender de que
  // llegue un fix GPS (el background task es el único que flushea, y en algunos
  // equipos —p.ej. Xiaomi con ahorro de batería— se suspende). Mientras la app
  // esté abierta esto garantiza que lo encolado se envíe cada ~20 s.
  const flushNow = useCallback(async () => {
    try {
      if (!(await isOnline())) return;
      await clearBackoff();        // app abierta: no esperar la ventana de backoff
      await ensureAuth();
      await flushLocationQueue();
      await flushMotionQueue();
      // Latido de "app viva" desde primer plano (cada ~20 s con la app abierta).
      void sendHeartbeat({ appState: 'foreground' });
    } catch (e: any) {
      console.warn('[flushNow]', e?.message);
    } finally {
      await loadDiagnostics();
    }
  }, [loadDiagnostics]);

  useEffect(() => {
    flushNow();                              // al montar / al empezar a rastrear
    const interval = setInterval(flushNow, 20_000);
    return () => clearInterval(interval);
  }, [flushNow]);

  // Conectividad: actualiza el indicador y, al RECONECTAR, drena la cola de
  // inmediato en vez de esperar al próximo tick.
  useEffect(() => {
    let prevConnected = true;
    const unsub = NetInfo.addEventListener((state) => {
      const connected = !!state.isConnected && state.isInternetReachable !== false;
      setNet({ connected, type: state.type });
      // Evidencia de datos/Wi-Fi apagados con rastreo activo (net_off / net_on).
      void auditNet(connected);
      if (connected && !prevConnected) void flushNow();
      prevConnected = connected;
    });
    return () => unsub();
  }, [flushNow]);

  // Watchdog en primer plano: al volver a abrir la app, repara el rastreo si el
  // SO mató el servicio O si quedó "iniciado pero mudo" (GPS apagado/encendido).
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (state) => {
      if (state !== 'active') return;
      loadDeviceStatus();
      void flushNow();                       // drenar lo encolado al volver a abrir
      try {
        const action = await ensureTrackingHealthy();
        if (action === 'started' || action === 'restarted') setTracking(true);
      } catch (e: any) {
        console.error('[Watchdog AppState]', e?.message);
      }
    });
    return () => sub.remove();
  }, [flushNow, loadDeviceStatus]);

  // Auto-reparación mientras la app esté abierta: aunque no haya transición de
  // GPS ni cambio de AppState, revisa cada 30 s que sigan llegando fixes y
  // re-suscribe si el servicio quedó mudo (p.ej. tras una congelación de MIUI).
  useEffect(() => {
    const interval = setInterval(() => { void ensureTrackingHealthy(); }, 30_000);
    return () => clearInterval(interval);
  }, []);

  // Inicialización: auto-arranca si había sesión previa y permisos ya concedidos
  useEffect(() => {
    if (!deviceId) return;

    async function init() {
      // Mostrar de inmediato el último nombre conocido (si lo hay) para no
      // arrancar con "No registrado" mientras se confirma con el servidor.
      const cachedName = await loadTechnicianName();
      if (cachedName) setTechName(cachedName);

      try {
        const active = await isTracking();
        if (active) {
          setTracking(true);
          setLoading(false);
          // Aun rastreando, refrescar el nombre desde el servidor en segundo
          // plano (no bloquea la UI).
          void refreshTechName();
          return;
        }

        // El servicio NO está corriendo en un arranque en frío. Si había una
        // sesión activa y hubo un hueco real sin fixes, el proceso fue terminado
        // (force-stop, swipe de recientes o el SO por memoria): dejar evidencia
        // (tracking_killed) antes de revivir el rastreo más abajo.
        void auditTrackingKilled(false);

        // Asegurar sesión válida ANTES de leer (igual que App.tsx). Sin esto,
        // una sesión anónima vencida hacía que la lectura devolviera vacío y
        // se mostrara un falso "No registrado".
        await ensureAuth();

        const { data: tech, error } = await supabase
          .from('technicians')
          .select('id, name')
          .eq('device_id', deviceId)
          .maybeSingle();

        if (error) throw error; // lectura fallida → conservar nombre en cache

        if (tech) {
          // Confirmado por el servidor: vinculado.
          await storeTechnicianName(tech.name);
          setTechName(tech.name);

          // Auto-arranque silencioso: solo si permisos ya concedidos.
          const storedTechId = await loadTechnicianId();
          if (storedTechId && await hasAllPermissions()) {
            await startTracking(tech.id);
            await registerWatchdog();
            setTracking(true);
          }
        } else {
          // Respuesta autoritativa: este device_id NO está vinculado.
          await removeTechnicianName();
          setTechName(null);
        }
      } catch (e: any) {
        // No se pudo verificar (red/RLS/sesión). Conservar el nombre en cache
        // —ya aplicado arriba— en vez de mostrar "No registrado".
        console.warn('[init]', e?.message);
      } finally {
        setLoading(false);
      }
    }

    init();
  }, [deviceId]);

  async function handleToggle() {
    if (tracking) {
      setLoading(true);
      // Bitácora: el técnico DETUVO la localización a propósito (acción explícita,
      // distinta de "se apagó el GPS"). Se registra ANTES de stopTracking, que
      // borra el technicianId y hace el flush final (el evento viaja con él).
      const techId = await loadTechnicianId();
      if (techId) await reportDeviceEvent(techId, 'tracking_stop');
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

    // Explicación previa: el SO obliga a que el técnico elija manualmente la
    // opción "Siempre / Todo el tiempo". Le decimos qué tocar ANTES de que
    // aparezca el diálogo del sistema, para que no escoja "Solo con la app".
    if (!(await hasAllPermissions())) {
      await new Promise<void>((resolve) =>
        Alert.alert(
          'Activar ubicación continua',
          'Para el rastreo del técnico, en las siguientes pantallas elige:\n\n' +
            '• Ubicación: "Permitir todo el tiempo" (NO "Solo con la app").\n' +
            '• Precisión exacta: activada.\n\n' +
            'Si eliges otra opción, el rastreo no funcionará en segundo plano.',
          [{ text: 'Entendido', onPress: () => resolve() }],
          { cancelable: false },
        ),
      );
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
      // Bitácora: el técnico INICIÓ la localización (acción explícita). Solo aquí,
      // no en el auto-arranque ni en el watchdog, para que el evento signifique
      // "el técnico la activó a mano" y la línea de tiempo del líder sea fiable.
      void reportDeviceEvent(tech.id, 'tracking_start');
      setTechName(tech.name);
      setTracking(true);
      // Pedir exención de optimización de batería para sostener >=4 h continuas.
      await ensureBatteryOptimizationExempt();
    } catch (e: any) {
      Alert.alert('Error al iniciar la localización', e?.message ?? 'No se pudo iniciar el servicio GPS. Reinicia la app e intenta de nuevo.');
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

  // Abre la pantalla de Ajustes de la app para que el técnico cambie el permiso
  // de ubicación a "Permitir siempre". openSettings lleva a la ficha de la app
  // en ambas plataformas; desde ahí: Permisos > Ubicación > Permitir siempre.
  async function openLocationSettings() {
    Alert.alert(
      'Activar "Permitir siempre"',
      'Se abrirán los Ajustes de la app.\n\n' +
        'Toca:  Permisos  ›  Ubicación  ›  "Permitir todo el tiempo"\n' +
        'y activa  "Usar ubicación precisa".',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Abrir Ajustes', onPress: () => { void Linking.openSettings(); } },
      ],
    );
  }

  // Abre la pantalla de batería para dejar la app en "Sin restricciones".
  async function handleOpenBattery() {
    Alert.alert(
      'Quitar restricción de batería',
      battery?.xiaomi
        ? 'Se abrirá la pantalla de batería de tu teléfono.\n\n' +
          'Selecciona la opción  "Sin restricciones"  (NO "Ahorro de batería").\n\n' +
          'Si no, el sistema cierra el rastreo en segundo plano.'
        : 'Se abrirá la pantalla de batería.\n\nPermite que la app se ejecute sin restricciones / sin optimizar.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Abrir', onPress: () => { void openBatterySettings(); } },
      ],
    );
  }

  // En Xiaomi no podemos leer la capa MIUI; el técnico confirma que ya lo dejó
  // en "Sin restricciones" y el banner se oculta.
  async function handleBatteryDone() {
    await dismissBatteryGuard();
    setBattery(await getBatteryGuard());
  }

  function handleReRegister() {
    if (!onReRegister) return;
    Alert.alert(
      'Volver a registrar',
      'Vas a vincular este teléfono escaneando un código QR nuevo. Pídelo a tu líder. No necesitas desinstalar la app.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Escanear QR', onPress: onReRegister },
      ],
    );
  }

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadDiagnostics(), loadDeviceStatus(), refreshTechName()]);
    setRefreshing(false);
  }, [loadDiagnostics, loadDeviceStatus, refreshTechName]);

  const hasError   = !!lastError;

  // Con el envío por lotes, en operación normal SIEMPRE hay unos pocos puntos en
  // cola entre un flush y el siguiente (se vacía cada ~30 s). Eso NO es un
  // problema, así que solo avisamos cuando la cola crece mucho más de lo normal
  // —señal de un backlog real (sin red o servidor caído)— o cuando hubo un error.
  const QUEUE_BACKLOG_THRESHOLD = 50;
  const queueBacklog = queueCount > QUEUE_BACKLOG_THRESHOLD;

  // ¿El rastreo está activo pero algo lo está saboteando? (GPS off, sin permiso o sin red)
  const gpsBad   = gpsOn === false;
  const permBad  = permLevel === 'none' || permLevel === 'partial';
  const netBad   = !net.connected;
  const trackingBroken = tracking && (gpsBad || permBad || netBad);

  const netTypeLabel =
    net.type === 'wifi' ? 'Wi-Fi'
    : net.type === 'cellular' ? 'Datos móviles'
    : net.type === 'ethernet' ? 'Ethernet'
    : 'Conectado';

  const statusText = trackingBroken ? 'Localización con fallas' : tracking ? 'Localizando' : 'Inactivo';

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
        <View style={[
          styles.section, styles.statusSection,
          trackingBroken ? styles.statusBroken : tracking ? styles.statusActive : styles.statusInactive,
        ]}>
          <View style={[
            styles.dot,
            trackingBroken ? styles.dotBroken : tracking ? styles.dotActive : styles.dotInactive,
          ]} />
          <Text style={[
            styles.statusText,
            trackingBroken ? styles.textBroken : tracking ? styles.textActive : styles.textInactive,
          ]}>
            {statusText}
          </Text>
        </View>

        {/* Banner de advertencia: rastreo activo pero interrumpido por el dispositivo.
            Visible y grande para que NO se pueda recortar en una captura. */}
        {trackingBroken && (
          <View style={styles.warnBanner}>
            <WarningTriangle size={22} color="#fbbf24" />
            <View style={{ flex: 1 }}>
              <Text style={styles.warnTitle}>LA LOCALIZACIÓN NO ESTÁ FUNCIONANDO</Text>
              <Text style={styles.warnMsg}>
                {[
                  gpsBad && 'GPS desactivado',
                  permBad && 'Permiso de ubicación incompleto',
                  netBad && 'Sin conexión a internet',
                ].filter(Boolean).join(' · ')}
              </Text>
              <Text style={styles.warnHint}>Tu ubicación NO se está enviando. Reactiva lo indicado.</Text>
            </View>
          </View>
        )}

        {/* Banner de PERMISO: visible SIEMPRE que la ubicación no esté en
            "Permitir siempre", aunque el rastreo esté apagado. Es la causa #1 de
            "la app no sirve": el técnico tiene el permiso en "Solo en uso" o
            denegado y no lo sabe. Incluye botón para abrir Ajustes y arreglarlo. */}
        {(permLevel === 'partial' || permLevel === 'none') && (
          <View style={[styles.permBanner, permLevel === 'none' && styles.permBannerDenied]}>
            <WarningTriangle size={22} color={permLevel === 'none' ? '#fca5a5' : '#fbbf24'} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.permTitle, permLevel === 'none' && styles.permTitleDenied]}>
                FALTA EL PERMISO "PERMITIR SIEMPRE"
              </Text>
              <Text style={[styles.permMsg, permLevel === 'none' && styles.permMsgDenied]}>
                {permLevel === 'none'
                  ? 'No has dado permiso de ubicación. La app SÍ funciona, pero no puede rastrear sin este permiso.'
                  : 'Tienes la ubicación en "Solo en uso". La app SÍ funciona, pero el rastreo necesita "Permitir siempre".'}
              </Text>
              <TouchableOpacity style={styles.permFixBtn} onPress={openLocationSettings}>
                <Text style={styles.permFixText}>ARREGLAR — Abrir Ajustes</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Banner de BATERÍA: la app debe estar en "Sin restricciones", no en
            "Ahorro de batería", o el sistema mata el rastreo. En Xiaomi no se
            puede leer el estado real (capa MIUI cerrada): se muestra hasta que
            el técnico confirme. En el resto de Android desaparece solo al quedar
            exenta. */}
        {battery?.needsAttention && (
          <View style={styles.permBanner}>
            <WarningTriangle size={22} color="#fbbf24" />
            <View style={{ flex: 1 }}>
              <Text style={styles.permTitle}>BATERÍA: PON "SIN RESTRICCIONES"</Text>
              <Text style={styles.permMsg}>
                {battery.xiaomi
                  ? 'En "Ahorro de batería" el teléfono cierra el rastreo. Debe quedar en "Sin restricciones".'
                  : 'La app está optimizada por batería. Permite que se ejecute sin restricciones para no perder el rastreo.'}
              </Text>
              <View style={styles.permBtnRow}>
                <TouchableOpacity style={[styles.permFixBtn, { marginTop: 0 }]} onPress={handleOpenBattery}>
                  <Text style={styles.permFixText}>ABRIR AJUSTES</Text>
                </TouchableOpacity>
                {battery.canDismiss && (
                  <TouchableOpacity style={styles.permDoneBtn} onPress={handleBatteryDone}>
                    <Text style={styles.permDoneText}>Ya está configurado</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        )}

        {/* Estado del dispositivo (íconos, sin emojis) */}
        <View style={styles.diagBox}>
          <Text style={styles.diagTitle}>ESTADO DEL DISPOSITIVO</Text>

          <StatusRow
            icon={<LocationPinIcon color={gpsOn === false ? '#ef4444' : '#00D632'} disabled={gpsOn === false} />}
            label="GPS"
            value={gpsOn === null ? '…' : gpsOn ? 'Activado' : 'Desactivado'}
            ok={gpsOn !== false}
          />

          <StatusRow
            icon={<CheckCircleIcon color={permBad ? '#ef4444' : '#00D632'} disabled={permLevel === 'none'} />}
            label="Permiso de ubicación"
            value={
              permLevel === null ? '…'
              : permLevel === 'full' ? 'Siempre'
              : permLevel === 'partial' ? 'Solo en uso'
              : 'Denegado'
            }
            ok={permLevel === 'full'}
          />

          <StatusRow
            icon={<SignalIcon color={netBad ? '#ef4444' : '#00D632'} disabled={netBad} />}
            label="Internet"
            value={net.connected ? netTypeLabel : 'Sin conexión'}
            ok={net.connected}
          />
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
            <Text style={[styles.diagValue, queueBacklog && styles.diagWarn]}>
              {queueCount > 0 ? `${queueCount} eventos` : 'Al día'}
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

        {/* Botón force sync: solo ante un backlog real o un error, no por los
            pocos puntos que el envío por lotes mantiene en cola normalmente. */}
        {(queueBacklog || hasError) && (
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
            : <Text style={styles.btnText}>{tracking ? 'DETENER LOCALIZACIÓN' : 'INICIAR LOCALIZACIÓN'}</Text>
          }
        </TouchableOpacity>

        {/* Re-registro sin desinstalar: vincular este teléfono con un QR nuevo. */}
        {onReRegister && (
          !techName ? (
            <TouchableOpacity style={[styles.button, styles.btnRelink]} onPress={handleReRegister}>
              <Text style={styles.btnText}>VINCULAR DISPOSITIVO (ESCANEAR QR)</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={handleReRegister} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.relinkLink}>¿Apareces como "No registrado" aunque sí lo estás? Vuelve a vincular</Text>
            </TouchableOpacity>
          )
        )}

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
  statusBroken:   { borderLeftWidth: 3, borderLeftColor: '#f59e0b' },
  dot:            { width: 10, height: 10, borderRadius: 5 },
  dotActive:      { backgroundColor: '#00D632' },
  dotInactive:    { backgroundColor: '#64748b' },
  dotBroken:      { backgroundColor: '#f59e0b' },
  statusText:     { fontSize: 17, fontWeight: '700' },
  textActive:     { color: '#00D632' },
  textInactive:   { color: '#94a3b8' },
  textBroken:     { color: '#fbbf24' },

  warnBanner:     { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#3a2206', borderRadius: 12, borderWidth: 1, borderColor: '#f59e0b', padding: 14 },
  warnTitle:      { color: '#fde68a', fontSize: 13, fontWeight: '800', letterSpacing: 0.3 },
  warnMsg:        { color: '#fbbf24', fontSize: 13, fontWeight: '700', marginTop: 2 },
  warnHint:       { color: '#fcd34d', fontSize: 11, marginTop: 3 },

  permBanner:       { width: '100%', flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: '#3a2206', borderRadius: 12, borderWidth: 1, borderColor: '#f59e0b', padding: 14 },
  permBannerDenied: { backgroundColor: '#3a0a0a', borderColor: '#ef4444' },
  permTitle:        { color: '#fde68a', fontSize: 13, fontWeight: '800', letterSpacing: 0.3 },
  permTitleDenied:  { color: '#fecaca' },
  permMsg:          { color: '#fbbf24', fontSize: 13, fontWeight: '600', marginTop: 3 },
  permMsgDenied:    { color: '#fca5a5' },
  permFixBtn:       { marginTop: 10, alignSelf: 'flex-start', backgroundColor: '#00D632', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14 },
  permFixText:      { color: '#06210d', fontSize: 13, fontWeight: '800', letterSpacing: 0.3 },
  permBtnRow:       { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' },
  permDoneBtn:      { alignSelf: 'flex-start', borderWidth: 1, borderColor: '#fbbf24', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14 },
  permDoneText:     { color: '#fde68a', fontSize: 13, fontWeight: '700' },

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
  btnRelink:      { backgroundColor: '#2563eb' },
  relinkLink:     { color: '#60a5fa', fontSize: 13, fontWeight: '600', textAlign: 'center', marginTop: 4, textDecorationLine: 'underline' },
  btnText:        { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.5 },
  hint:           { fontSize: 11, color: '#252540', marginTop: 8 },
});
