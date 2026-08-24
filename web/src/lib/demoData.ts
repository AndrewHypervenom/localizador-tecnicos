// ── Modo demo: datos SINTÉTICOS para capturar la interfaz ─────────────────────
//
// PARA QUÉ. Enseñar el diseño del panel (contadores del semáforo, lista de
// técnicos, mapa) sin depender de lo que esté haciendo la flota real en ese
// momento, y SIN tocar Supabase.
//
// POR QUÉ NO SE HACE CON DATOS REALES. Los contadores "App sirviendo / Sin señal
// / Rastreo caído" salen de `technician_current_status`, que clasifica según si
// llegó una posición o un latido de verdad. Forzar esos números sobre una empresa
// real —sembrando `location_events` falsos o hardcodeando el estado— produce una
// captura que afirma que unos técnicos concretos están siendo rastreados cuando
// no lo están. Eso no es una captura bonita: es un dato inventado con nombre y
// apellido. Por eso el demo vive aparte, con gente que no existe.
//
// LAS DOS GARANTÍAS QUE HACEN ESTO SEGURO:
//
//   1. `import.meta.env.DEV` — Vite lo fija a `false` al compilar. El modo demo
//      NO PUEDE encenderse en un build de producción por mucho que alguien
//      escriba `?demo=1` en la URL del sitio desplegado. Es una constante en
//      tiempo de compilación, así que además el bundler borra este módulo entero
//      del build final.
//   2. Nada de aquí se escribe. El demo corta las consultas y las suscripciones
//      de realtime; solo siembra el store de memoria del navegador.
//
// CÓMO SE USA:  npm run dev   →   http://localhost:5173/?demo=1
//
import type { TechnicianState } from '@/store/trackingStore'

/** Marca de "demo encendido" dentro de esta pestaña. */
const DEMO_KEY = 'geotrack:demo'

/**
 * ¿Estamos en modo demo? Sólo en desarrollo Y con `?demo=1` explícito.
 * El orden importa: `import.meta.env.DEV` va primero para que el empaquetador
 * pueda eliminar la rama entera en producción.
 *
 * Se recuerda en `sessionStorage` porque los redirects de sesión y de rol
 * (`<Navigate to="/admin">` en App.tsx) se comen la query string: sin el pestillo
 * habría que volver a escribir `?demo=1` después de cada login. `sessionStorage`
 * y no `localStorage` a propósito — muere al cerrar la pestaña, así que nadie se
 * queda en demo sin darse cuenta al día siguiente.
 * Para salir: `?demo=0`, o cerrar la pestaña.
 */
export function isDemoMode(): boolean {
  if (!import.meta.env.DEV) return false
  if (typeof window === 'undefined') return false

  const param = new URLSearchParams(window.location.search).get('demo')
  if (param === '1') { sessionStorage.setItem(DEMO_KEY, '1'); return true }
  if (param === '0') { sessionStorage.removeItem(DEMO_KEY);   return false }
  return sessionStorage.getItem(DEMO_KEY) === '1'
}

const MIN = 60_000

/** Bogotá — centro aproximado, para que los marcadores caigan sobre ciudad. */
const BASE_LAT = 4.6097
const BASE_LNG = -74.0817

/**
 * Personas ficticias, en el MISMO formato que el padrón real (mayúsculas, nombre
 * completo de tres o cuatro partes) para que la captura se vea como el sistema
 * de verdad. Los apellidos están escogidos para no coincidir con ningún técnico
 * del padrón: la forma es la real, la persona no existe.
 *
 * NO cambiar estos nombres por los reales. El color de cada fila afirma algo
 * concreto —"el teléfono de esta persona está reportando ahora"— y ponerlo en
 * verde sobre un nombre real de un técnico que no está siendo rastreado
 * convierte la captura en un dato inventado con nombre y apellido. Si hacen
 * falta los nombres reales en una captura, entonces los colores tienen que ser
 * los reales: se sale del demo con `?demo=0`.
 */
interface DemoSpec {
  name: string
  /** Minutos desde la última posición GPS. */
  seenMinAgo: number
  /** Velocidad en m/s. > ~0.3 con posición fresca ⇒ 'moving'. */
  speed: number
  battery: number
  /** Minutos desde el último latido; `null` = sin latido (app muerta). */
  hbMinAgo: number | null
  hbGpsOn?: boolean
  /** Desplazamiento respecto al centro, en grados. */
  dLat: number
  dLng: number
}

// 10 en verde (mezcla de 'moving' e 'idle' para que la lista se vea viva),
// 1 en ámbar y 1 en rojo. Los estados NO se escriben a mano: se derivan de estas
// marcas de tiempo mediante `computeStatus` del store, igual que con datos
// reales. Así el demo no puede enseñar un color que el propio motor de estados
// no produciría — si alguien cambia los umbrales, el demo cambia con ellos.
const SPECS: DemoSpec[] = [
  // ── Verde · en movimiento (posición < 90 s y velocidad > 1 km/h) ──
  { name: 'CAMILO ESTEBAN BOHÓRQUEZ TOVAR',  seenMinAgo: 0.4, speed: 11.2, battery: 82, hbMinAgo: 1, dLat:  0.0142, dLng: -0.0208 },
  { name: 'NELSON ANDRÉS ZAMBRANO PULIDO',   seenMinAgo: 0.6, speed:  7.8, battery: 64, hbMinAgo: 2, dLat: -0.0195, dLng:  0.0121 },
  { name: 'MAURICIO ELIÉCER CANTILLO REYES', seenMinAgo: 0.5, speed: 14.1, battery: 91, hbMinAgo: 1, dLat:  0.0231, dLng:  0.0176 },
  { name: 'ÓSCAR IVÁN BETANCUR MONROY',      seenMinAgo: 0.9, speed:  5.4, battery: 47, hbMinAgo: 3, dLat: -0.0088, dLng: -0.0264 },
  // ── Verde · en sitio (posición < 5 min, parado trabajando) ──
  { name: 'JULIÁN ORLANDO MOSQUERA VALBUENA', seenMinAgo: 1.8, speed: 0, battery: 73, hbMinAgo: 2, dLat:  0.0301, dLng: -0.0092 },
  { name: 'DIEGO ARMANDO SARMIENTO CUÉLLAR',  seenMinAgo: 2.4, speed: 0, battery: 55, hbMinAgo: 1, dLat: -0.0247, dLng: -0.0155 },
  { name: 'RICARDO ANTONIO PEÑALOZA TRIANA',  seenMinAgo: 3.1, speed: 0, battery: 38, hbMinAgo: 4, dLat:  0.0064, dLng:  0.0289 },
  { name: 'FABIÁN STEVEN OTÁLORA BUITRAGO',   seenMinAgo: 3.7, speed: 0, battery: 88, hbMinAgo: 2, dLat: -0.0132, dLng:  0.0243 },
  { name: 'NÉSTOR JULIO GUEVARA MANRIQUE',    seenMinAgo: 4.2, speed: 0, battery: 26, hbMinAgo: 3, dLat:  0.0178, dLng: -0.0311 },
  { name: 'HERNÁN DARÍO LOZANO CIFUENTES',    seenMinAgo: 4.6, speed: 0, battery: 69, hbMinAgo: 1, dLat: -0.0056, dLng:  0.0068 },
  // ── Ámbar · la app late pero no llegan posiciones, con motivo concreto ──
  // GPS apagado en el teléfono: el ámbar más accionable de todos.
  { name: 'WILSON EDUARDO AGUIRRE SIERRA', seenMinAgo: 46, speed: 0, battery: 51, hbMinAgo: 3, hbGpsOn: false, dLat: 0.0212, dLng: 0.0037 },
  // ── Rojo · ni posiciones ni latido: hay que llamarlo ──
  { name: 'GUSTAVO ADOLFO PINEDA CARVAJAL', seenMinAgo: 61 * 26, speed: 0, battery: 12, hbMinAgo: null, dLat: -0.0289, dLng: -0.0071 },
]

/**
 * Construye la flota de demo con marcas de tiempo RELATIVAS al momento de la
 * llamada. Se regenera en cada refresco para que el "hace X minutos" que se lee
 * junto a cada nombre no envejezca mientras la pestaña está abierta — si no, a
 * los veinte minutos habría un punto verde diciendo "sin moverse hace 24 min",
 * que es justo la incoherencia que el semáforo existe para evitar.
 */
export function buildDemoTechnicians(): TechnicianState[] {
  const now = Date.now()
  return SPECS.map((s, i) => ({
    id:       `demo-${String(i + 1).padStart(2, '0')}`,
    name:     s.name,
    // Un `deviceId` no vacío es obligatorio: sin él la fila sale GRIS
    // ("sin teléfono vinculado") y no cuenta en ninguno de los tres contadores.
    deviceId: `demo-device-${i + 1}`,
    lastSeen: new Date(now - s.seenMinAgo * MIN).toISOString(),
    lat:      BASE_LAT + s.dLat,
    lng:      BASE_LNG + s.dLng,
    lastSpeed: s.speed,
    battery:  s.battery,
    // El store lo recalcula desde `lastSeen`/`lastHeartbeat`; se manda 'offline'
    // como valor inicial neutro para no sugerir que este dato manda.
    status:   'offline',
    lastHeartbeat: s.hbMinAgo === null ? undefined : new Date(now - s.hbMinAgo * MIN).toISOString(),
    hbGpsOn:  s.hbMinAgo === null ? undefined : (s.hbGpsOn ?? true),
    hbNetOn:  s.hbMinAgo === null ? undefined : true,
    hbPerm:   s.hbMinAgo === null ? undefined : 'full',
    hbBattery: s.battery,
    trail:    [],
  }))
}
