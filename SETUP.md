# Guía de Configuración — Localizador de Técnicos

## Estructura del proyecto

```
localizador/
├── supabase/        ← migraciones SQL
├── backend/         ← Node.js + Express (analítica y trip detection)
├── web/             ← React + Vite (dashboard web)
└── mobile/          ← React Native + Expo (app en los teléfonos)
```

## Prerequisitos

- Node.js 20+
- Expo CLI: `npm install -g expo-cli`
- Cuenta en [supabase.com](https://supabase.com)
- Para compilar la app: [EAS CLI](https://docs.expo.dev/build/setup/) o Expo Go para desarrollo

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

## Paso 6: App Móvil (React Native / Expo)

```bash
cd mobile
cp .env.example .env
# Editar .env con EXPO_PUBLIC_SUPABASE_URL y EXPO_PUBLIC_SUPABASE_ANON_KEY

npm install
```

### Desarrollo (Expo Go)

```bash
npx expo start
# Escanear QR con la app Expo Go en el teléfono
```

> **Nota:** El rastreo en segundo plano **no funciona** en Expo Go. Para probarlo completo usar un build de desarrollo (ver abajo).

### Build de desarrollo (fondo real)

```bash
# Instalar EAS CLI si no lo tienes
npm install -g eas-cli
eas login

# Build para Android
npx expo run:android
# o build en la nube:
eas build -p android --profile development
```

### Obtener el Device ID del teléfono

Abrir la app en el teléfono: el Device ID aparece en pantalla si el técnico no está registrado. Copiarlo para el Paso 3.

---

## Estructura de archivos importantes

| Archivo | Para qué sirve |
|---|---|
| `supabase/migrations/001_init.sql` | Tablas, PostGIS y particionado |
| `supabase/migrations/002_rls_policies.sql` | Control de acceso por roles |
| `web/.env` | Keys de Supabase para el dashboard |
| `backend/.env` | Keys del backend (service_role) |
| `mobile/.env` | Keys de Supabase para la app |
| `mobile/src/services/locationTask.ts` | Tarea GPS en segundo plano |
| `mobile/src/services/sensorService.ts` | Detección de eventos (frenadas, accidentes) |

---

## Troubleshooting

**Los marcadores no aparecen en el mapa**
→ Verificar que Realtime esté habilitado en Supabase para `location_events`

**La app dice "Dispositivo no registrado"**
→ Copiar el Device ID que muestra la app y agregarlo en la tabla `technicians` (Paso 3)

**El rastreo se detiene al cerrar la app**
→ Asegurarse de usar un build nativo (`expo run:android`), no Expo Go

**Error de CORS en el backend**
→ Agregar la URL del web en `backend/src/index.ts` en el array de `origin`

**Error "Missing EXPO_PUBLIC_SUPABASE_URL"**
→ Asegurarse de haber copiado `mobile/.env.example` a `mobile/.env` y rellenado los valores
