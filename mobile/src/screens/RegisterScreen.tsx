import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useDeviceId } from '../hooks/useDeviceId';
import { supabase } from '../lib/supabase';

const QR_PREFIX = 'localizador:register:';

interface Props {
  onRegistered: (techName: string) => void;
  onCancel?: () => void; // si se provee, muestra "Volver" (re-registro desde Home)
}

type ScanState = 'scanning' | 'processing' | 'success' | 'error';

export default function RegisterScreen({ onRegistered, onCancel }: Props) {
  const deviceId = useDeviceId();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanState, setScanState]       = useState<ScanState>('scanning');
  const [message, setMessage]           = useState('');
  const [techName, setTechName]         = useState('');
  const scannedRef = useRef(false); // evitar doble scan

  useEffect(() => {
    if (!permission?.granted) requestPermission();
  }, []);

  // Mostrar nombre del técnico un momento y luego pasar al home
  useEffect(() => {
    if (scanState === 'success') {
      const t = setTimeout(() => onRegistered(techName), 2000);
      return () => clearTimeout(t);
    }
  }, [scanState]);

  async function handleBarCodeScanned({ data }: { data: string }) {
    if (scannedRef.current || scanState !== 'scanning') return;
    if (!data.startsWith(QR_PREFIX)) return; // ignorar QRs ajenos

    scannedRef.current = true;
    setScanState('processing');

    if (!deviceId) {
      setScanState('error');
      setMessage('No se pudo obtener el ID del dispositivo. Intente de nuevo.');
      scannedRef.current = false;
      setScanState('scanning');
      return;
    }

    const token = data.slice(QR_PREFIX.length).trim();

    try {
      const { data: result, error } = await supabase.rpc('register_device', {
        p_token:     token,
        p_device_id: deviceId,
      });

      if (error) throw error;

      if (!result?.success) {
        setScanState('error');
        setMessage(result?.error ?? 'Registro fallido. Pide un nuevo QR al administrador.');
        setTimeout(() => {
          setScanState('scanning');
          scannedRef.current = false;
        }, 3000);
        return;
      }

      setTechName(result.name ?? '');
      setScanState('success');
    } catch (err: any) {
      setScanState('error');
      setMessage(err?.message ?? 'Error de conexión. Verifica tu internet.');
      setTimeout(() => {
        setScanState('scanning');
        scannedRef.current = false;
      }, 3000);
    }
  }

  if (!permission) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color="#00D632" />
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.messageBox}>
          <Text style={styles.emoji}>📷</Text>
          <Text style={styles.title}>Permiso de cámara</Text>
          <Text style={styles.subtitle}>
            Se necesita la cámara para escanear el código QR de registro.
          </Text>
          <Text
            style={styles.link}
            onPress={requestPermission}
          >
            Conceder permiso
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Cámara ocupando toda la pantalla */}
      {scanState === 'scanning' && (
        <CameraView
          style={StyleSheet.absoluteFillObject}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={handleBarCodeScanned}
        />
      )}

      {/* Overlay oscuro con marco QR */}
      <View style={styles.overlay} pointerEvents="none">
        {/* Zona transparente central */}
        <View style={styles.frameRow}>
          <View style={styles.frameMask} />
          <View style={styles.frame}>
            {/* Esquinas del marco */}
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
          </View>
          <View style={styles.frameMask} />
        </View>
      </View>

      {/* Texto y estados encima */}
      <View style={styles.ui} pointerEvents="none">
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.appName}>Localizador <Text style={styles.appNameBrand}>PositivoS+</Text></Text>
          <Text style={styles.headerSub}>Registro de dispositivo</Text>
        </View>

        {/* Estado central */}
        <View style={styles.stateContainer}>
          {scanState === 'scanning' && (
            <Text style={styles.scanHint}>Apunta al código QR que te dio el administrador</Text>
          )}
          {scanState === 'processing' && (
            <View style={styles.stateBox}>
              <ActivityIndicator color="#00D632" />
              <Text style={styles.stateText}>Registrando...</Text>
            </View>
          )}
          {scanState === 'success' && (
            <View style={[styles.stateBox, styles.successBox]}>
              <Text style={styles.successEmoji}>✓</Text>
              <Text style={styles.successTitle}>Registrado</Text>
              <Text style={styles.successName}>{techName}</Text>
            </View>
          )}
          {scanState === 'error' && (
            <View style={[styles.stateBox, styles.errorBox]}>
              <Text style={styles.errorEmoji}>✕</Text>
              <Text style={styles.errorText}>{message}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Botón Volver (solo en re-registro desde Home). Fuera del overlay para
          que sí reciba toques (el overlay tiene pointerEvents="none"). */}
      {onCancel && (
        <TouchableOpacity style={styles.backBtn} onPress={onCancel} activeOpacity={0.8}>
          <Text style={styles.backText}>‹  Volver</Text>
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

const FRAME = 240;
const CORNER = 24;
const CORNER_W = 3;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  frameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  frameMask: {
    flex: 1,
    height: FRAME,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  frame: {
    width: FRAME,
    height: FRAME,
    backgroundColor: 'transparent',
  },
  corner: {
    position: 'absolute',
    width: CORNER,
    height: CORNER,
    borderColor: '#00D632',
  },
  cornerTL: { top: 0,    left: 0,    borderTopWidth: CORNER_W, borderLeftWidth: CORNER_W },
  cornerTR: { top: 0,    right: 0,   borderTopWidth: CORNER_W, borderRightWidth: CORNER_W },
  cornerBL: { bottom: 0, left: 0,    borderBottomWidth: CORNER_W, borderLeftWidth: CORNER_W },
  cornerBR: { bottom: 0, right: 0,   borderBottomWidth: CORNER_W, borderRightWidth: CORNER_W },
  ui: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    paddingVertical: 48,
  },
  header: {
    alignItems: 'center',
    paddingTop: 8,
  },
  appName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#f8fafc',
  },
  headerSub: {
    fontSize: 13,
    color: '#94a3b8',
    marginTop: 2,
  },
  stateContainer: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingBottom: 16,
  },
  scanHint: {
    fontSize: 14,
    color: '#cbd5e1',
    textAlign: 'center',
    lineHeight: 20,
  },
  stateBox: {
    backgroundColor: 'rgba(15,23,42,0.92)',
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 28,
    alignItems: 'center',
    gap: 8,
    minWidth: 220,
  },
  stateText: {
    color: '#f8fafc',
    fontSize: 14,
  },
  successBox: {
    borderWidth: 1,
    borderColor: '#22c55e',
  },
  successEmoji: {
    fontSize: 32,
    color: '#22c55e',
  },
  successTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#22c55e',
  },
  successName: {
    fontSize: 15,
    color: '#f8fafc',
    fontWeight: '500',
  },
  errorBox: {
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  errorEmoji: {
    fontSize: 32,
    color: '#ef4444',
  },
  errorText: {
    fontSize: 13,
    color: '#fca5a5',
    textAlign: 'center',
    lineHeight: 18,
  },
  messageBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  emoji: { fontSize: 48 },
  title: { fontSize: 20, fontWeight: '700', color: '#f8fafc' },
  subtitle: { fontSize: 14, color: '#94a3b8', textAlign: 'center', lineHeight: 20 },
  appNameBrand: { color: '#00D632' },
  link: { fontSize: 14, color: '#00D632', fontWeight: '600', marginTop: 8 },
  backBtn: {
    position: 'absolute',
    top: 48,
    left: 20,
    backgroundColor: 'rgba(15,23,42,0.92)',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.3)',
  },
  backText: { color: '#f8fafc', fontSize: 14, fontWeight: '600' },
});
