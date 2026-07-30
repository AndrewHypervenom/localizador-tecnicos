# Localizador PositivoS+ — app Android nativa (Kotlin)

Reescritura en Kotlin de `mobile/` (React Native + Expo). Mismo backend, mismas
tablas, mismo comportamiento visible para el líder; cambia por completo cómo se
sostiene el rastreo.

---

## 1. Por qué se caía el rastreo

Diagnóstico sobre el código de `mobile/`, no sobre síntomas:

| # | Causa | Efecto |
|---|---|---|
| 1 | **Todo vivía en el hilo de JavaScript.** Posiciones, cola, latido y watchdog corrían en el mismo runtime. | Cuando MIUI/EMUI congelaba el proceso, se caía todo a la vez. **El vigilante moría con el vigilado.** |
| 2 | **Cambiar de nivel de captura hacía stop+start** del request nativo (`applyTrackingTier`). | Ventana sin escucha en cada transición; en varios equipos el re-arranque fallaba en silencio → servicio "iniciado pero mudo". Es el bug que `STALE_FIX_MS = 90s` intentaba parchear. |
| 3 | **La cola era un array JSON entero en AsyncStorage.** Cada punto leía, parseaba y reescribía hasta 1,5 MB. | Decenas de ms de CPU e I/O por fix en gama baja; una escritura interrumpida se llevaba la cola completa. |
| 4 | **El movimiento se deducía de la velocidad del GPS.** | Obligaba a mantener el GNSS encendido a 5 s todo el día solo para saber si el técnico estaba quieto. |
| 5 | **El arranque tras reinicio levantaba un runtime RN completo** vía HeadlessJS. | Lento y con mucha RAM justo en la tormenta de arranque: alta probabilidad de que el sistema lo matara. |
| 6 | **`ensureAuth()` lanzaba excepción antes de vaciar la cola.** | Ver punto 2 de la sección siguiente. Probablemente la causa directa del incidente actual. |

---

## 2. ⚠️ Hallazgo en el servidor — REQUIERE ACCIÓN

Durante la verificación se probó el backend real:

```
POST /auth/v1/signup   →   HTTP 500
{"error_code":"unexpected_failure","msg":"Database error creating anonymous user"}
```

**El alta de usuarios anónimos está rota en el proyecto de Supabase.** Suele ser
un trigger sobre `auth.users` que falla (una función tipo `handle_new_user` que
inserta en una tabla pública y viola una restricción, o le falta permiso).

Por qué importa tanto: en `mobile/src/services/locationTask.ts` el vaciado de la
cola es

```js
await ensureAuth();          // ← lanza excepción si no hay sesión y no puede crearla
await flushLocationQueue();  // ← nunca se ejecuta
```

En cualquier teléfono que necesite una sesión nueva —instalación nueva, datos
borrados, o token de refresco caducado— la app **sigue capturando posiciones y no
envía ni una**. El técnico ve la app trabajando; el líder lo ve desaparecido.
Encaja exactamente con el síntoma reportado.

Se comprobó además que **la sesión anónima no hace ninguna falta**: las políticas
de acceso ya conceden permiso al rol público. Con la sola clave pública:

| Prueba | Resultado |
|---|---|
| `GET /technicians` | 200, devuelve datos |
| `POST /location_events` | pasa el RLS, falla solo en la clave foránea (técnico inexistente) |
| `POST /motion_events` | ídem |
| `POST /technician_heartbeat` | ídem |

**La app Kotlin ya es inmune**: si no consigue sesión, sigue trabajando con la
clave pública en lugar de abortar el envío (`SupabaseClient.ensureAuth`), y lo
enseña en la pantalla de diagnóstico. Aun así **conviene arreglar el trigger en
Supabase**, o desactivar los registros anónimos a propósito si ya no se usan.

---

## 3. Qué hace distinto la app nueva

**Supervivencia — cuatro mecanismos independientes.** Basta con que sobreviva uno:

1. `START_STICKY` — el sistema recrea el servicio si lo mata por memoria.
2. **Alarma repetida** (`AlarmManager`, cada 3 min). Al dispararse una alarma,
   Android concede una ventana temporal fuera de las restricciones de segundo
   plano: es la única vía fiable para volver a levantar un servicio en primer
   plano. Con reserva inexacta si no hay permiso de alarmas exactas.
3. **WorkManager periódico** (15 min) — sobrevive a reinicios y a que el proceso
   muera; además reintenta los envíos cuando vuelve la red.
4. **`BootReceiver`** — arranca el servicio nativo directamente al reiniciar.

Y `onTaskRemoved`: quitar la app de Recientes programa su resurrección (para
detener el rastreo está el botón, no el gesto).

**Batería.** Tres palancas que antes no existían:

- **Reconocimiento de actividad** (`ActivityTransition`): el sistema ya sabe con
  los sensores de movimiento si el teléfono está quieto o en un vehículo, sin
  encender el GPS. Volver a captura densa tarda segundos.
- **Sensor de movimiento significativo**: red de seguridad de coste casi nulo
  para equipos sin servicios de Google.
- **Entrega agrupada** (`setMaxUpdateDelayMillis`): el chip acumula posiciones y
  despierta la CPU una vez en lugar de una por fix.

**Puntos en reposo sin GPS.** Estando anclado, la posición a reportar ya se
conoce: es el ancla. Un temporizador emite los puntos con **exactamente la misma
cadencia que veía el líder antes**, sin obligar al GNSS a despertarse. Salvaguarda
importante: solo emite si el motor sigue entregando posiciones reales — si el
técnico apaga la ubicación, los puntos se detienen y el líder ve "sin señal", que
es lo correcto.

**Sin hueco al cambiar de nivel.** Se reutiliza el mismo objeto callback: volver a
pedir actualizaciones con otro `LocationRequest` sustituye la petición de forma
atómica. El stop+start queda solo para la reparación explícita.

**Cola en SQLite** (Room), transaccional, con apartado de filas irrecuperables
para que un registro "veneno" no atasque la cola para siempre.

**Sin servicios de Google también funciona**: si no hay GMS, cae a
`LocationManager` (Huawei y mercado gris).

### Lo que se conservó sin tocar

La lógica afinada en campo se portó literal: ancla anti-deriva (radio 30 m,
salidas por velocidad franca / caminata sostenida / desplazamiento), umbral de
detenido 0,7 m/s, filtro de precisión 50 m, cadencia de subida en reposo 25 s,
tiers de 5 s y 30 s, envío por lotes cada 30 s, backoff exponencial, bitácora de
dispositivo completa, anti Fake GPS, SOS y las guías por fabricante.

---

## 4. Migración: nadie vuelve a escanear el QR

- **Mismo `applicationId`** (`com.empresa.localizador`) y **misma firma** (SHA-1
  `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`, la llave de
  `mobile/android/app/debug.keystore`, copiada a `keystore/`). El APK entra como
  **actualización en sitio**, sin desinstalar.
- `versionCode` 20 (el anterior era 6).
- **`LegacyImporter`** lee el SQLite de AsyncStorage (`databases/RKStorage`) y
  hereda: identificador de instalación, técnico vinculado, nombre, términos
  aceptados, avisos ya descartados **y los puntos que quedaran sin enviar**, que
  pasan a la cola nueva en vez de perderse.

> ⚠️ **La firma no se puede cambiar** sin romper la actualización: Android rechaza
> un APK del mismo paquete firmado con otra llave y obligaría a desinstalar, lo
> que borraría el vínculo de **todos** los técnicos. Contrapartida: es la llave de
> depuración pública de la plantilla React Native, así que cualquiera puede firmar
> un APK que se instale encima. Si algún día quieres una llave propia, hay que
> planificar una reinstalación coordinada (o pasar a Play App Signing).

---

## 5. Compilar

```bash
cd android-app
cp secrets.properties.example secrets.properties   # y rellenar
./gradlew assembleRelease
# -> app/build/outputs/apk/release/app-release.apk  (11,7 MB)
```

`secrets.properties` toma las mismas credenciales que `mobile/.env`
(`EXPO_PUBLIC_SUPABASE_URL` → `SUPABASE_URL`, etc.). No se versiona.

La variante `debug` usa el sufijo `.dev`, así que se puede instalar **junto a** la
app de producción para probar sin tocar la del técnico.

---

## 6. Estado: qué está verificado y qué no

Verificado:

- ✅ Compila (`assembleRelease`, R8 activado) y todos los componentes conservan
  su nombre tras la ofuscación.
- ✅ Firmado con la llave heredada — comprobado con `apksigner`.
- ✅ El backend acepta las escrituras con la clave pública (probado contra el
  servidor real con un `technician_id` inexistente, sin escribir datos reales).
- ✅ El formato de las filas coincide con el esquema (`POINT(lng lat)`, ISO-8601,
  la partición `location_events_2026_07` existe).

**No verificado — hace falta un teléfono:**

- ❌ **Nunca se ha ejecutado.** No había ningún dispositivo conectado por ADB.
- ❌ La herencia desde AsyncStorage no se ha probado contra una instalación real
  de la app RN.
- ❌ Comportamiento en campo: consumo real de batería, supervivencia en MIUI,
  precisión del reconocimiento de actividad, lectura del QR.

### Prueba mínima recomendada antes de repartir

1. En un teléfono con la app RN funcionando y vinculada, instalar encima:
   `adb install -r app-release.apk`.
2. Comprobar que **sigue apareciendo el nombre del técnico** sin escanear QR
   (valida `LegacyImporter`).
3. Iniciar localización y verificar en el sitio web que llegan puntos.
4. Cerrar la app desde Recientes → debe reaparecer la notificación en segundos.
5. Apagar y encender la ubicación → debe reengancharse.
6. Reiniciar el teléfono → debe reanudarse sin abrir la app.
7. Dejarlo quieto 15 min → debe pasar a "Reposo profundo" en Diagnóstico y seguir
   enviando puntos.
8. Modo avión 10 min y volver → la cola debe drenarse sola.

---

## 7. Decisiones tomadas sin confirmación

Se preguntó por plataforma, distribución, estrategia de corte e interfaz, pero no
hubo respuesta, así que se decidió con la evidencia del repo. **Conviene
revisarlas:**

| Decisión | Motivo | Si no es lo que querías |
|---|---|---|
| **Solo Android** | No existe carpeta `ios/`: nunca se construyó para iPhone. Todo el código es específico de Android. | Habría que hacer una app Swift aparte, o mantener la Expo solo para iOS. |
| **Reemplazo en sitio** (mismo paquete y firma) | Es lo único que evita que los técnicos re-escaneen el QR. | Para pilotar en paralelo: cambiar `applicationId` a `com.empresa.localizador.pilot` en `app/build.gradle.kts`; esos equipos sí escanean QR de nuevo. |
| **Rediseño Compose + pantalla de diagnóstico** | Mismos colores, textos y avisos; interacción nativa. Añade una pantalla que exporta un informe para zanjar discusiones. | Es puramente visual, fácil de ajustar. |
| **`minSdk` 24** (Android 7) | Cubre teléfonos viejos de flota. | Subirlo permitiría simplificar algún camino heredado. |
| **Cliente REST propio** en vez del SDK de Supabase | Control total del reintento y de la clasificación transitorio/permanente, que es lo que evita perder puntos o atascar la cola. | — |

---

## 8. Pendiente

- [ ] **Arreglar el alta anónima en Supabase** (sección 2) o desactivarla adrede.
- [ ] Probar en teléfono real (sección 6).
- [ ] Decidir qué hacer con `mobile/`: conviene **conservarla** hasta que la
      versión Kotlin esté validada en campo.
- [ ] `MDM_PROVISIONING.md` de `mobile/` sigue vigente palabra por palabra; solo
      cambian los nombres de clase internos.
- [ ] Valorar una llave de firma propia con un plan de reinstalación (sección 4).
