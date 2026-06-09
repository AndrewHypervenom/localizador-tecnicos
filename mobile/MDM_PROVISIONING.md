# Aprovisionar la flota sin prompts (Android Enterprise / MDM)

> Objetivo: que el técnico **no vea ningún diálogo** de "Permitir ubicación
> siempre / solo con la app" ni de "ahorro de batería", y que la app rastree
> en segundo plano desde el primer arranque.

## Por qué hace falta un MDM

En un teléfono normal (instalación desde APK o Play Store) los dos diálogos
son **obligatorios por Android/Google** y **no se pueden saltar por código**:

- **Ubicación "siempre"**: desde Android 11, el SO ni siquiera permite pedir
  "Permitir todo el tiempo" en un diálogo; obliga al usuario a elegirlo a mano.
- **Optimización de batería**: el usuario debe confirmar la exención.

La **única** forma de eliminar los prompts es que los equipos sean
**gestionados** (managed) y el MDM **pre-conceda** los permisos por política.
La app no cambia: el MDM aplica las políticas al instalar.

Paquete de la app: `com.empresa.localizador`

---

## Opción A — Android Enterprise (recomendado para celulares de empresa)

Sirve cualquier EMM compatible con Android Enterprise: **Google Workspace /
Android Management API**, **Microsoft Intune**, **TinyMDM**, **Headwind MDM**,
**Scalefusion**, **Esper**, etc. Los nombres de las políticas son estándar.

### 1. Inscribir el dispositivo como *fully managed* (device owner)
El equipo debe quedar como **propiedad de la empresa / totalmente gestionado**
(no "perfil de trabajo"). Esto se hace con:
- QR de aprovisionamiento al encender un equipo nuevo o reseteado, o
- token `afw#...` en el setup, o
- enrolamiento por NFC / zero-touch.

> Solo en modo *fully managed* (device owner) el MDM puede auto-conceder
> permisos peligrosos como la ubicación en segundo plano.

### 2. Política de permisos en tiempo de ejecución
Configura **"Default permission policy" = GRANT** (auto-conceder) para la app,
o concede explícitamente:

| Permiso | Valor |
|---|---|
| `android.permission.ACCESS_FINE_LOCATION` | GRANT |
| `android.permission.ACCESS_COARSE_LOCATION` | GRANT |
| `android.permission.ACCESS_BACKGROUND_LOCATION` | GRANT |
| `android.permission.POST_NOTIFICATIONS` | GRANT |
| `android.permission.ACTIVITY_RECOGNITION` | GRANT |

En la **Android Management API** (Google) el `Policy` queda así:

```json
{
  "applications": [
    {
      "packageName": "com.empresa.localizador",
      "installType": "FORCE_INSTALLED",
      "defaultPermissionPolicy": "GRANT",
      "permissionGrants": [
        { "permission": "android.permission.ACCESS_FINE_LOCATION", "policy": "GRANT" },
        { "permission": "android.permission.ACCESS_BACKGROUND_LOCATION", "policy": "GRANT" },
        { "permission": "android.permission.POST_NOTIFICATIONS", "policy": "GRANT" }
      ]
    }
  ]
}
```

Con esto **el diálogo de "ubicación siempre" no aparece**: la app arranca con
el permiso ya concedido.

### 3. Exención de optimización de batería
Activa la política equivalente a **"Battery optimization: exempt / disabled"**
para la app (en muchos EMM se llama *"Keep app active in background"*,
*"Battery exemption"* o *"App standby exemption"*).

> El código ya lo respeta: `ensureBatteryOptimizationExempt()` comprueba
> `Battery.isBatteryOptimizationEnabledAsync()` y, si el MDM ya eximió la app,
> **no muestra ningún diálogo**.

### 4. (Opcional) Forzar ubicación siempre activa
- Política **"Location mode" = HIGH_ACCURACY** (o `LOCATION_ENFORCED`) para que
  el GPS no se pueda apagar.
- Bloquear que el usuario desactive la ubicación: deshabilitar el toggle.

### 5. Bloquear force-stop y borrar datos (anti-sabotaje) — IMPORTANTE
Esta es la política que **cierra el ataque "mato la app y digo que no sirve"**.
Aplica la *user restriction* **`DISALLOW_APPS_CONTROL`** al dispositivo: impide
que el técnico haga **"Forzar detención"** o **"Borrar datos"** de cualquier app
gestionada desde *Ajustes › Apps*. Sin force-stop, la app no se puede matar a
mano y el rastreo no se interrumpe.

En la **Android Management API** (Google) va en el `Policy`:

```json
{
  "appAutoUpdatePolicy": "ALWAYS",
  "uninstallAppsDisabled": true,
  "applications": [
    {
      "packageName": "com.empresa.localizador",
      "installType": "FORCE_INSTALLED",
      "defaultPermissionPolicy": "GRANT"
    }
  ],
  "advancedSecurityOverrides": { "untrustedAppsPolicy": "DISALLOW_INSTALL" }
}
```

- `uninstallAppsDisabled: true` → el técnico **no puede desinstalar** la app.
- Para bloquear force-stop/borrar datos, activa **`DISALLOW_APPS_CONTROL`** (en
  Intune: *Device restrictions › "Block user from controlling apps"*; en otros
  EMM suele llamarse *"Disallow apps control"* o *"Prevent force stop"*).
- Marca la app como **persistente / "keep alive" / "run on boot"** si tu EMM lo
  ofrece (Esper, Scalefusion, SOTI): refuerza el autoarranque tras reinicio.

### 6. Autoarranque tras reinicio (refuerza el boot receiver de la app)
La app ya trae un **BroadcastReceiver de BOOT_COMPLETED** (config plugin
`plugins/withBootReceiver.js`) que reanuda el rastreo sola tras reiniciar el
equipo. En la flota gestionada, **activa también** la política de la app como
*persistent / auto-start on boot* del EMM — así el arranque es doblemente
seguro (cinturón y tirantes), sobre todo en MIUI/HyperOS donde el autostart está
bloqueado por defecto (ver sección Xiaomi).

### 7. (Opcional) Modo kiosko
Si los equipos son solo para rastrear, fija la app en **kiosk / lock task mode**
para que el técnico no pueda cambiar permisos ni cerrarla.

> **Recomendación:** NO actives kiosko de entrada salvo que el equipo sea de uso
> exclusivo de la app. Bloquea todo el teléfono y estorba al técnico. El bloqueo
> de force-stop/desinstalar (paso 5) + exención de batería + autostart ya logra
> el grueso del blindaje sin volver el equipo inusable.

---

## Xiaomi / Redmi / POCO (MIUI / HyperOS) — IMPORTANTE

Xiaomi añade **su propia capa de batería** encima de Android. La exención de
batería estándar de Android (`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`) **NO** la
afecta: el equipo se queda en *"Ahorro de batería (recomendado)"* y mata el
servicio aunque Android lo tenga en whitelist. **No hay API pública** para
poner *"Sin restricciones"* desde la app.

Para dejarlo en **"Sin restricciones" sin que el técnico toque nada**, en la
flota gestionada hay que aplicar, además de las políticas de arriba:

1. **Autostart / inicio automático** habilitado para `com.empresa.localizador`
   (MIUI lo bloquea por defecto).
2. **Ahorro de batería por app = "Sin restricciones"** (la pantalla de la captura).
3. Desactivar **MIUI Optimization** / restricciones de segundo plano.

Cómo se aplica por MDM en Xiaomi:
- Usa el **OEMConfig de Xiaomi** (Xiaomi publica una app *OEMConfig* para
  Android Enterprise) o un EMM con **soporte Xiaomi** (Esper, Scalefusion,
  Hexnode, SOTI). Ahí expones políticas tipo *"Autostart: enabled"* y
  *"Battery saver: no restrictions"* para la app.
- En modo *fully managed* el OEMConfig escribe esos ajustes de MIUI sin
  intervención del usuario.

> Sin MDM, en Xiaomi **no se puede automatizar**: alguien (TI o el propio
> técnico) debe entrar **una vez** a *Ajustes › Apps › Localizador › Ahorro de
> batería › Sin restricciones* y activar *Autostart*. La app ya abre esa
> pantalla de MIUI directamente al iniciar (un solo toque), pero el toque final
> lo da Xiaomi, no se puede evitar por código.

---

## Opción B — Sin MDM (teléfonos personales / no gestionados)

No se pueden eliminar los prompts. Lo que la app ya hace para minimizarlos:

1. **Pantalla previa** que indica al técnico elegir **"Permitir todo el tiempo"**
   antes de que salga el diálogo del sistema (`HomeScreen.handleToggle`).
2. El prompt de **batería se pide una sola vez** y solo si el equipo no está ya
   exento (`ensureBatteryOptimizationExempt`).

Instrucción para el técnico (una sola vez, al instalar):
1. Al pulsar **Iniciar**, en "Ubicación" toca **"Permitir todo el tiempo"**.
   - Si solo aparece "Mientras usas la app", luego ve a
     **Ajustes › Apps › Localizador › Permisos › Ubicación › Permitir siempre**.
2. Activa **"Usar ubicación precisa"**.
3. Cuando pida **"Permitir ejecución en segundo plano / no optimizar batería"**,
   acepta.

---

## Verificación rápida

En un equipo gestionado, tras instalar:

```bash
# Ubicación en segundo plano concedida sin diálogo:
adb shell dumpsys package com.empresa.localizador | grep -i ACCESS_BACKGROUND_LOCATION
# -> debe decir: granted=true

# App exenta de optimización de batería:
adb shell dumpsys deviceidle whitelist | grep com.empresa.localizador

# Receiver de arranque registrado (autoarranque tras reinicio):
adb shell dumpsys package com.empresa.localizador | grep -i BootReceiver

# Force-stop bloqueado (DISALLOW_APPS_CONTROL): el botón "Forzar detención" debe
# salir deshabilitado en Ajustes › Apps › Localizador.
adb shell dumpsys device_policy | grep -i no_control_apps
```

Si todo da positivo, el técnico no verá prompts y **no podrá** matar ni borrar la
app.

---

## Qué evidencia captura la app por sí sola (sin MDM)

Aunque no apliques MDM, la app ya deja en `motion_events` un rastro con hora de
cada intento de sabotaje, que el líder ve en el panel de Alertas y en los
reportes (hoja "Bitácora de dispositivo"):

| Acción del técnico | Evento registrado |
|---|---|
| Apagar el GPS | `gps_off` |
| Apagar datos / Wi-Fi | `net_off` |
| Usar Fake GPS | `mock_on` (y bloquea la app) |
| Restringir la batería de la app | `battery_restricted` |
| Bajar de "Permitir siempre" a "Solo en uso" o revocar | `perm_revoked` |
| Cerrar la app a la fuerza / swipe de recientes | `tracking_killed` |
| Adelantar el reloj del teléfono | `clock_skew` |
| Quedarse sin señal sin causa declarada | `offline` severidad 70 |

Además, el **latido (heartbeat)** prueba que la app sigue viva minuto a minuto
aunque no haya señal GPS: en la vista del líder el técnico aparece **amarillo
"App activa — sin señal"** (no "Desconectado"), lo que refuta el *"la app no
sirve"* y las capturas con la barra de notificaciones recortada.
