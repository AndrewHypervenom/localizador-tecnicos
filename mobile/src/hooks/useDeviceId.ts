import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

// ID por instalación: se guarda en AsyncStorage, que el sistema borra al
// desinstalar la app. Así, reinstalar genera un ID nuevo y obliga a volver a
// escanear el QR para enlazar el teléfono con el sitio web.
//
// (No usamos Application.getAndroidId() porque el ANDROID_ID sobrevive a la
// reinstalación en Android y dejaba al dispositivo enlazado para siempre.)
const DEVICE_ID_KEY = 'localizador:install_id';

// UUID v4 sin dependencias nativas (solo identifica la instalación, no requiere
// aleatoriedad criptográfica).
function generateUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function useDeviceId(): string | null {
  const [deviceId, setDeviceId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function resolve() {
      let id = await AsyncStorage.getItem(DEVICE_ID_KEY);
      if (!id) {
        id = generateUuid();
        await AsyncStorage.setItem(DEVICE_ID_KEY, id);
      }
      if (mounted) setDeviceId(id);
    }
    resolve();
    return () => {
      mounted = false;
    };
  }, []);

  return deviceId;
}
