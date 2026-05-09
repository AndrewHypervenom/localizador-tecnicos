import * as Application from 'expo-application';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

export function useDeviceId(): string | null {
  const [deviceId, setDeviceId] = useState<string | null>(null);

  useEffect(() => {
    async function resolve() {
      if (Platform.OS === 'android') {
        setDeviceId(Application.getAndroidId());
      } else {
        const id = await Application.getIosIdForVendorAsync();
        setDeviceId(id);
      }
    }
    resolve();
  }, []);

  return deviceId;
}
