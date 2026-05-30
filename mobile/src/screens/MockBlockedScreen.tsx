import { ActivityIndicator, SafeAreaView, StyleSheet, Text, View } from 'react-native';

// Pantalla de bloqueo total cuando se detecta una app de "Fake GPS".
// No tiene botón de cierre a propósito: solo desaparece cuando los fixes
// vuelven a ser reales (al cerrar la app de ubicación falsa o reiniciar).
export default function MockBlockedScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.icon}>⛔</Text>
        <Text style={styles.title}>Ubicación falsa detectada</Text>
        <Text style={styles.body}>
          Se detectó una aplicación que está modificando tu ubicación
          (Fake GPS / ubicación simulada).
        </Text>
        <Text style={styles.body}>
          Para seguir usando el Localizador, cierra esa aplicación o reinicia
          el teléfono. El rastreo está suspendido hasta entonces.
        </Text>
        <View style={styles.waitRow}>
          <ActivityIndicator color="#fca5a5" />
          <Text style={styles.waiting}>Esperando ubicación real…</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#2a0505', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card:      { width: '100%', backgroundColor: '#3a0808', borderRadius: 16, padding: 28, alignItems: 'center', gap: 14, borderWidth: 1, borderColor: '#7f1d1d' },
  icon:      { fontSize: 56 },
  title:     { fontSize: 22, fontWeight: '800', color: '#fecaca', textAlign: 'center' },
  body:      { fontSize: 15, color: '#fca5a5', textAlign: 'center', lineHeight: 22 },
  waitRow:   { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  waiting:   { fontSize: 13, color: '#fca5a5', fontStyle: 'italic' },
});
