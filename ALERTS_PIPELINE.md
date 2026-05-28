# Pipeline de alertas en tiempo real — pasos de despliegue

El código está implementado y compila (mobile, web, backend). Estos pasos
manuales activan el pipeline en tu infraestructura (no se ejecutaron por
seguridad: tocan la base de producción y secretos).

## 1. Migración SQL (geofencing + esquema de alertas)
Aplica `supabase/migrations/20260528_0001_alerts_pipeline.sql` en el SQL Editor
de Supabase (o `supabase db push`). Crea:
- `motion_events.notified_at`, `motion_events.escalated_at`
- `technicians.current_zone_ids`
- tabla `push_subscriptions`
- trigger PostGIS `trg_detect_zone_events` que genera `zone_events` enter/exit
- añade `zone_events` y `motion_events` a la publicación `supabase_realtime`

> ✓ El esquema usado por el trigger fue **verificado contra el código existente**
> (backend usa `location::geometry`; `zones_geojson` y `zone_events` según los
> hooks web). Caveat menor documentado en el SQL: las zonas con `route_date` se
> comparan contra la fecha UTC del punto.

## 2. Claves VAPID (Web Push)
```
cd backend
npx web-push generate-vapid-keys
```
Agrega a `backend/.env`:
```
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:alertas@positivosmais.com
ALERTS_WEBHOOK_SECRET=<una cadena aleatoria larga>
```
(La clave pública la sirve el backend en `GET /api/notifications/vapid-public-key`;
el frontend la consume solo.)

## 3. Database Webhook de Supabase
En Supabase → Database → Webhooks, crea uno:
- Tabla: `motion_events`, evento: `INSERT`
- URL: `https://<tu-backend>/api/notifications/dispatch`
- Header: `x-webhook-secret: <ALERTS_WEBHOOK_SECRET>`

Esto dispara el envío Web Push en cada alerta nueva (accidente, SOS, frenada,
offline, batería baja…). El despacho es idempotente (`notified_at`), así que no
duplica con el cron.

## 4. Listo
- El cron del backend (cada 2 min) genera alertas `offline` y `battery_low` y
  escala accidentes/SOS sin acuse (`escalateUnacknowledged`).
- En la web, el líder pulsa **"Activar alertas"** (cabecera del panel de
  Alertas) para suscribirse a Web Push y recibir avisos con el navegador
  cerrado.
- En la app, el técnico tiene el botón **🆘 ENVIAR SOS**.

## Verificación rápida
- SOS desde la app → toast + sonido en la web en segundos, y notificación del SO
  si el navegador está cerrado.
- Insertar `location_events` de prueba dentro/fuera de una zona activa → aparece
  `zone_events` y el toast de zona.
- Dejar un técnico activo sin enviar > 10 min → alerta `offline`.
