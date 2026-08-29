# Prueba de campo antes de repartir — v2.0.0

APK: `app/build/outputs/apk/release/app-release.apk` (11,7 MB)
Firma verificada: SHA-1 `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`
(la misma de la versión anterior — por eso entra como actualización y no obliga a
escanear el QR). `versionCode` 20, sube desde el 6.

---

## Bloque 0 — La migración (haz esto primero, en 2 o 3 teléfonos)

Es el mayor riesgo del corte y **no se puede comprobar en un teléfono limpio**:
hace falta uno que hoy tenga la app anterior funcionando y vinculada.

```bash
adb install -r app-release.apk      # -r = encima, conservando los datos
```

> Si `adb install -r` falla con `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, **PARA**.
> Significa que la firma no coincide y seguir obligaría a desinstalar, borrando el
> vínculo de todos los técnicos. No lo fuerces con `-d` ni desinstales.

| # | Qué hacer | Qué tiene que pasar |
|---|---|---|
| 0.1 | Abrir la app | Aparece **el nombre del técnico**, no la cámara de QR |
| 0.2 | Menú → Diagnóstico | "Herencia de la versión anterior" **no aparece**. Si aparece, ahí está escrito el motivo: cópialo |
| 0.3 | Ver el historial reciente en Diagnóstico | Debe listar "Datos heredados de la versión anterior: dispositivo=sí, técnico=sí" |
| 0.4 | Mirar el sitio web | El técnico sigue siendo el mismo, con su historial |

Si 0.1 manda a escanear el QR, **no repartas**: avisa y revisa el motivo de 0.2.

---

## Bloque 1 — Lo que reportaron los líderes

| # | Qué hacer | Qué tiene que pasar |
|---|---|---|
| 1.1 | Iniciar localización | En el sitio, el técnico se pone verde en menos de 1 min |
| 1.2 | Dejar el teléfono quieto 25 min con la pantalla apagada | **Sigue verde o ámbar, nunca rojo.** Es el bug reportado: la app late cada 5 min y el panel declara muerto a los 20 |
| 1.3 | Cerrar la app deslizándola de Recientes | La notificación reaparece en segundos y los puntos siguen llegando |
| 1.4 | Apagar el GPS 2 min y volver a encenderlo | Se reengancha solo, sin abrir la app |
| 1.5 | Modo avión 10 min y volver | La cola se drena sola; no se pierde ningún punto |
| 1.6 | Reiniciar el teléfono, **sin abrir la app** | El rastreo se reanuda solo en pocos minutos |
| 1.7 | Dejarlo quieto 15 min | Diagnóstico dice "Reposo profundo" y **sigue enviando puntos** |

El 1.2 y el 1.3 son los que fallaban. No los saltes.

---

## Bloque 2 — Por marca

Cada capa de fabricante mata las apps a su manera. Haz **1.3 y 1.6** en cada una.

| Marca | Dónde está el ajuste que hay que dejar abierto |
|---|---|
| **Xiaomi / Redmi / POCO** (MIUI, HyperOS) | Ajustes → Aplicaciones → Localizador → **Ahorro de batería: Sin restricciones** + **Inicio automático: activado**. Además, en Recientes, deslizar hacia abajo el icono de la app para **fijarla** (candado) |
| **Samsung** (One UI) | Ajustes → Batería → Límites de uso en segundo plano → sacar la app de "Aplicaciones en suspensión" + Batería → **Sin restricciones** |
| **Motorola** | Bastante cercano a Android puro. Ajustes → Batería → **Sin restricciones**. Revisar que "Optimización de batería" esté desactivada para la app |
| **Nothing Phone** | Android casi puro. Ajustes → Aplicaciones → Localizador → Batería → **Sin restricciones** |
| **Huawei / Honor sin servicios de Google** | La app cae sola a `LocationManager`. Ajustes → Batería → Inicio de aplicaciones → Localizador → **gestionar manualmente**, con las tres opciones activadas |

La app enseña la guía de la marca detectada en su propia pantalla; el técnico no
tiene que saberse esta tabla.

---

## Bloque 3 — Comprobar desde el servidor

Con la app corriendo un rato, esto dice si el latido llega con la cadencia buena.
Sustituye `<CLAVE_ANON>` por la clave pública.

```bash
curl -s "https://yzhytztfxeoljfbvegyu.supabase.co/rest/v1/technician_heartbeat?select=technician_id,last_heartbeat,app_version,app_state,gps_on,net_on,perm,last_fix_age_s&order=last_heartbeat.desc&limit=20" \
  -H "apikey: <CLAVE_ANON>" -H "Authorization: Bearer <CLAVE_ANON>"
```

Qué mirar en las filas con `app_version` 2.0.0:

- **`last_heartbeat`** no debería tener más de ~6 min de antigüedad en un teléfono
  encendido. Si pasa de 20 min, el panel lo pinta rojo y el bug sigue vivo.
- **`last_fix_age_s`** creciendo sin parar (miles de segundos) con `gps_on=true`,
  `net_on=true` y `perm=full` es el otro fallo: el servicio quedó mudo. En la
  versión anterior había teléfonos con 44 h así.

---

## Estado de esta versión

**Verificado en esta máquina:**

- Compila `assembleRelease` con R8 y ofuscación.
- Firmada con la llave heredada — comprobado con `apksigner`.
- El servidor acepta las escrituras con la sola clave pública (probado con un
  `technician_id` inexistente, sin escribir datos reales).
- La cadencia del latido (5 min por alarma, 3 min el watchdog) queda holgadamente
  por debajo del umbral de 20 min del panel.

**No verificado — es lo que se prueba con esta guía:**

- La herencia desde la app anterior contra una instalación real (Bloque 0).
- El comportamiento por marca (Bloque 2).
- El consumo real de batería en una jornada.
