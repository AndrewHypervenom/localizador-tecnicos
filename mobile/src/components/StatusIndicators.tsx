import { View, Text, StyleSheet } from 'react-native';

// ─────────────────────────────────────────────────────────────────────────────
// Íconos dibujados con Views nativas (sin librerías externas ni emojis).
// Sirven para que, en una captura de pantalla de la app, sea evidente si el
// GPS está apagado, no hay permiso o no hay internet — aunque el técnico
// recorte la barra de notificaciones del sistema.
// ─────────────────────────────────────────────────────────────────────────────

const HOLE = '#141420';      // color del "hueco" interno (= fondo de la tarjeta)
const SLASH = '#ef4444';     // diagonal roja de "desactivado"

/** Diagonal roja superpuesta = elemento desactivado / sin servicio. */
function Slash() {
  return <View style={styles.slash} pointerEvents="none" />;
}

/** Pin de ubicación (GPS) — marcador: cabeza circular + punta triangular + punto. */
export function LocationPinIcon({ color, disabled }: { color: string; disabled?: boolean }) {
  return (
    <View style={styles.iconBox}>
      <View style={styles.pinWrap}>
        <View style={[styles.pinHead, { backgroundColor: color }]} />
        <View style={[styles.pinPoint, { borderTopColor: color }]} />
        <View style={styles.pinDot} />
      </View>
      {disabled && <Slash />}
    </View>
  );
}

/** Barras de señal (internet / datos). */
export function SignalIcon({ color, disabled }: { color: string; disabled?: boolean }) {
  return (
    <View style={[styles.iconBox, styles.signalRow]}>
      {[5, 9, 13, 17].map((h) => (
        <View key={h} style={{ width: 4, height: h, borderTopLeftRadius: 1.5, borderTopRightRadius: 1.5, backgroundColor: color }} />
      ))}
      {disabled && <Slash />}
    </View>
  );
}

/** Círculo con check (permiso de ubicación concedido / denegado). */
export function CheckCircleIcon({ color, disabled }: { color: string; disabled?: boolean }) {
  return (
    <View style={styles.iconBox}>
      <View style={[styles.checkCircle, { backgroundColor: color }]}>
        <View style={styles.checkMark} />
      </View>
      {disabled && <Slash />}
    </View>
  );
}

/** Triángulo de advertencia con signo de exclamación. */
export function WarningTriangle({ size = 18, color = '#f59e0b' }: { size?: number; color?: string }) {
  return (
    <View style={{ width: size + 10, height: size + 8, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: 0,
          height: 0,
          borderLeftWidth: size * 0.62,
          borderRightWidth: size * 0.62,
          borderBottomWidth: size,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderBottomColor: color,
        }}
      />
      <View style={{ position: 'absolute', top: size * 0.5, width: 2.6, height: size * 0.32, borderRadius: 1.3, backgroundColor: '#1a1200' }} />
      <View style={{ position: 'absolute', top: size * 0.9, width: 2.6, height: 2.6, borderRadius: 1.3, backgroundColor: '#1a1200' }} />
    </View>
  );
}

// ── Fila de estado individual ───────────────────────────────────────────────

export function StatusRow({
  icon,
  label,
  value,
  ok,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <View style={styles.iconSlot}>{icon}</View>
        <Text style={styles.rowLabel}>{label}</Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={[styles.rowValue, ok ? styles.valueOk : styles.valueBad]}>{value}</Text>
        <View style={[styles.rowDot, ok ? styles.dotOk : styles.dotBad]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  iconBox:   { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  iconSlot:  { width: 26, alignItems: 'center' },
  signalRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 2.5 },

  slash: {
    position: 'absolute',
    width: 30,
    height: 2.6,
    borderRadius: 2,
    backgroundColor: SLASH,
    transform: [{ rotate: '45deg' }],
  },

  // Pin de ubicación tipo marcador: cabeza circular + punta triangular hacia
  // abajo + punto interior. La punta es lo que lo hace inconfundible (no un ojo).
  pinWrap:  { width: 16, height: 21 },
  pinHead:  { position: 'absolute', top: 0, left: 0, width: 16, height: 16, borderRadius: 8 },
  pinPoint: {
    position: 'absolute',
    top: 7,
    left: 0,
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderTopWidth: 13,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  pinDot:   { position: 'absolute', top: 4.5, left: 4.5, width: 7, height: 7, borderRadius: 3.5, backgroundColor: HOLE },

  // Permiso: círculo con check
  checkCircle: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  checkMark: {
    width: 5.5,
    height: 10,
    borderColor: '#ffffff',
    borderRightWidth: 2.5,
    borderBottomWidth: 2.5,
    transform: [{ rotate: '45deg' }],
    marginTop: -2,
  },

  // Fila
  row:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 },
  rowLeft:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowLabel: { fontSize: 14, color: '#cbd5e1', fontWeight: '600' },
  rowValue: { fontSize: 13, fontWeight: '700' },
  valueOk:  { color: '#00D632' },
  valueBad: { color: '#f87171' },
  rowDot:   { width: 9, height: 9, borderRadius: 5 },
  dotOk:    { backgroundColor: '#00D632' },
  dotBad:   { backgroundColor: '#ef4444' },
});
