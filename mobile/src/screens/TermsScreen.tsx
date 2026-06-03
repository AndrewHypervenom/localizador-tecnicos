import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const TERMS_KEY = '@terms_accepted_v1';

export async function hasAcceptedTerms(): Promise<boolean> {
  const val = await AsyncStorage.getItem(TERMS_KEY);
  return val === 'true';
}

export async function acceptTerms(): Promise<void> {
  await AsyncStorage.setItem(TERMS_KEY, 'true');
}

interface Props {
  onAccept: () => void;
}

export default function TermsScreen({ onAccept }: Props) {
  async function handleAccept() {
    await acceptTerms();
    onAccept();
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.logo}>📍 Localizador</Text>
        <Text style={styles.title}>Términos y Condiciones</Text>
        <Text style={styles.subtitle}>
          Léalos antes de continuar. Al aceptar, usted consiente el uso de esta aplicación.
        </Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>

        <Section title="1. Propósito de la Aplicación">
          Esta aplicación recopila datos de ubicación GPS del dispositivo para permitir el
          seguimiento de técnicos de campo durante su jornada laboral. El propósito es exclusivamente
          operativo: optimización de rutas, control de asistencia y seguridad del trabajador.
        </Section>

        <Section title="2. Datos que se Recopilan">
          {'• Ubicación GPS (latitud, longitud, altitud)\n' +
           '• Velocidad y dirección de desplazamiento\n' +
           '• Nivel de batería del dispositivo\n' +
           '• Eventos de conducción brusca detectados por el acelerómetro\n' +
           '• Marca temporal de cada evento'}
        </Section>

        <Section title="3. Uso de los Datos">
          Los datos recopilados son utilizados exclusivamente por la empresa contratante para:
          {'\n• Verificar asistencia y presencia en campo\n' +
           '• Monitorear la seguridad del conductor\n' +
           '• Generar reportes de actividad\n\n'}
          Los datos NO serán vendidos, cedidos ni compartidos con terceros ajenos a la empresa.
        </Section>

        <Section title="4. Localización en Segundo Plano">
          Esta aplicación requiere permiso de ubicación en segundo plano para seguir
          enviando datos GPS incluso cuando la aplicación no está visible en pantalla.
          Este permiso es necesario para el funcionamiento correcto del sistema de monitoreo.
          Puede revocar este permiso en cualquier momento desde la configuración del dispositivo.
        </Section>

        <Section title="5. Almacenamiento de Datos">
          Los datos se transmiten de forma segura mediante HTTPS a los servidores de la empresa.
          En caso de falta de conexión, los datos se almacenan temporalmente en el dispositivo
          y se sincronizan automáticamente al recuperar conectividad. Los datos locales son
          eliminados tras la sincronización exitosa.
        </Section>

        <Section title="6. Período de Retención">
          Los datos de ubicación son conservados por la empresa de acuerdo a sus políticas
          internas. El técnico puede solicitar información sobre sus datos contactando
          directamente al administrador del sistema.
        </Section>

        <Section title="7. Aceptación">
          Al presionar "Acepto los Términos", usted declara haber leído, entendido y aceptado
          las condiciones descritas. Esta aceptación es requisito para el uso de la aplicación.
        </Section>

        <View style={styles.spacer} />
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.acceptBtn} onPress={handleAccept} activeOpacity={0.85}>
          <Text style={styles.acceptText}>Acepto los Términos</Text>
        </TouchableOpacity>
        <Text style={styles.version}>Versión 1.0 · Localizador de Técnicos</Text>
      </View>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: string | string[] }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionBody}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A14',
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1E1E2E',
  },
  logo: {
    fontSize: 22,
    marginBottom: 8,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 6,
  },
  subtitle: {
    color: '#888',
    fontSize: 13,
    lineHeight: 18,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 20,
  },
  section: {
    marginBottom: 22,
  },
  sectionTitle: {
    color: '#00D632',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 6,
  },
  sectionBody: {
    color: '#BBBBBB',
    fontSize: 13,
    lineHeight: 20,
  },
  spacer: {
    height: 16,
  },
  footer: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#1E1E2E',
    gap: 10,
  },
  acceptBtn: {
    backgroundColor: '#00D632',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  acceptText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '700',
  },
  version: {
    color: '#444',
    fontSize: 11,
    textAlign: 'center',
  },
});
