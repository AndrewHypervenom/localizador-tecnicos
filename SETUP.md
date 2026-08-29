# Guía de Configuración — Localizador de Técnicos

## Estructura del proyecto

```
localizador/
├── supabase/        ← migraciones SQL
├── backend/         ← Node.js + Express (analítica y trip detection)
├── web/             ← React + Vite (dashboard web)
└── android-app/     ← Kotlin nativo (app en los teléfonos)
```

## Prerequisitos

- Node.js 20+
- Cuenta en [supabase.com](https://supabase.com)
- Para compilar la app: JDK 17 y el SDK de Android (Android Studio ya los trae)

---

## Paso 1: Configurar Supabase

1. Ir a [supabase.com](https://supabase.com) → **New Project**
2. Dar un nombre al proyecto (ej: `localizador`) y guardar la contraseña
3. Esperar ~2 minutos a que el proyecto inicie

4. Ir a **SQL Editor** y ejecutar en orden:
   - `supabase/migrations/001_init.sql`
   - `supabase/migrations/002_rls_policies.sql`
   - `supabase/migrations/003_seed_demo.sql` (opcional, datos de prueba)

5. Ir a **Settings → API** y copiar:
   - **Project URL** → `SUPABASE_URL`
   - **anon/public key** → `SUPABASE_ANON_KEY`
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY` (solo backend)

6. Ir a **Settings → Database** y copiar la **Connection string** (Transaction mode)
   → `DATABASE_URL`

7. En **Database → Replication → Tables**, habilitar Realtime para:
   - `location_events` (o sus particiones)
   - `motion_events`
   - `trips`

---

## Paso 2: Crear usuarios web

En **Authentication → Users → Add User**:

```
Email: admin@empresa.com
Password: (segura)
```

Luego asignar rol en **SQL Editor**:
```sql
UPDATE auth.users
SET raw_app_meta_data = raw_app_meta_data || '{"role": "admin"}'
WHERE email = 'admin@empresa.com';
```

---

## Paso 3: Registrar técnicos

Obtener el `device_id` de cada teléfono (ver Paso 6) y ejecutar en SQL Editor:

```sql
INSERT INTO technicians (name, device_id, phone) VALUES
  ('Carlos Ramírez', 'abc123def456', '+504 9999-0001');
```

En Android el `device_id` es el **Android ID** del dispositivo.
En iOS es el **identifierForVendor** (se muestra en la app al abrirla por primera vez).

---

## Paso 4: Web Dashboard

```bash
cd web
cp .env.example .env
# Editar .env con VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY

npm install
npm run dev
# Abrir http://localhost:5173
```

---

## Paso 5: Backend de Analítica

```bash
cd backend
cp .env.example .env
# Editar .env con SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL

npm install
npm run dev
# Corre en http://localhost:3001
```

---

## Paso 6: App Móvil (Kotlin nativo)

```bash
cd android-app
cp secrets.properties.example secrets.properties
# Editar secrets.properties con SUPABASE_URL y SUPABASE_ANON_KEY

./gradlew assembleRelease
# -> app/build/outputs/apk/release/app-release.apk
```

Detalles de la app (arquitectura, supervivencia en segundo plano, migración desde
la versión anterior): `android-app/README.md`.

### Probar sin tocar la app del técnico

La variante `debug` usa el sufijo de paquete `.dev`, así que se instala **junto a**
la de producción:

```bash
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

### Vincular un teléfono

El vínculo se hace **escaneando el QR** que genera el panel del líder; no hace
falta copiar identificadores a mano. La pantalla de Diagnóstico de la app muestra
el identificador de instalación por si hay que cotejarlo con la base.

> **Firma:** el APK se firma con `android-app/keystore/localizador-release.keystore`,
> heredada de la versión anterior. Cambiarla obligaría a **todos** los técnicos a
> desinstalar y volver a escanear el QR. Esa llave **no está en git**: hay que
> respaldarla aparte.

---

## Estructura de archivos importantes

| Archivo | Para qué sirve |
|---|---|
| `supabase/migrations/001_init.sql` | Tablas, PostGIS y particionado |
| `supabase/migrations/002_rls_policies.sql` | Control de acceso por roles |
| `web/.env` | Keys de Supabase para el dashboard |
| `backend/.env` | Keys del backend (service_role) |
| `android-app/secrets.properties` | Keys de Supabase para la app (no versionado) |
| `android-app/.../tracking/TrackingService.kt` | Servicio en primer plano que sostiene el rastreo |
| `android-app/.../tracking/LocationEngine.kt` | Captura GPS y niveles de precisión |
| `android-app/.../sync/Uploader.kt` | Cola offline y envío por lotes |
| `android-app/.../data/LegacyImporter.kt` | Herencia del vínculo al actualizar desde la versión anterior |

---

## Troubleshooting

**Los marcadores no aparecen en el mapa**
→ Verificar que Realtime esté habilitado en Supabase para `location_events`

**La app dice "Dispositivo no registrado"**
→ Copiar el Device ID que muestra la app y agregarlo en la tabla `technicians` (Paso 3)

**El rastreo se detiene al cerrar la app**
→ Revisar la pantalla de Diagnóstico: si el fabricante restringe la app en segundo
plano, ahí aparece la guía concreta para esa marca (Xiaomi, Samsung, etc.)

**Error de CORS en el backend**
→ Agregar la URL del web en `backend/src/index.ts` en el array de `origin`

**El técnico aparece como "No registrado" tras actualizar la app**
→ Abrir Diagnóstico y mirar "Herencia de la versión anterior": ahí queda escrito si
no se pudo heredar el vínculo y por qué
