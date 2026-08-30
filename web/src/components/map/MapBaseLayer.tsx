import { useEffect, useState } from 'react'
import { TileLayer } from 'react-leaflet'
import ReactLeafletGoogleLayer from 'react-leaflet-google-layer'
import { googleDarkStyle } from './googleDarkStyle'

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined
const PROVEEDOR_FORZADO   = import.meta.env.VITE_MAP_PROVIDER as string | undefined
const ESTILO_CARTO        = import.meta.env.VITE_MAP_STYLE as string | undefined
const CARTO_API_KEY       = import.meta.env.VITE_CARTO_API_KEY as string | undefined

// ⚠️ MEDIDO EL 2026-08-29 EN PRODUCCIÓN: CARTO YA NO ES GRATIS SIN CLAVE.
//
// Cambió su política y ahora estampa "API KEY REQUIRED / carto.com/basemaps/apikey"
// en diagonal sobre CADA tesela, incluidas las que tienen contenido. Comprobado
// descargando la tesela suelta, no solo en el navegador:
//
//   https://a.basemaps.cartocdn.com/dark_all/12/1205/1995.png  ->  HTTP 200
//
// Devuelve **200 OK** con la marca ya dibujada dentro, así que no hay ningún
// error que capturar: es el mismo fallo deshonesto que ya documentamos para
// Google ("sin facturación no falla, que sería lo honesto"), repetido con el
// proveedor al que se había huido. El panel del líder llevaba así desde el
// despliegue, con el mapa empapelado.
//
// Por eso el predeterminado pasa a ser **Esri Dark Gray Canvas**: no pide clave,
// no estampa nada y ya nace oscuro. Su fondo es rgb(77,77,79) —frente al
// rgb(9,9,9) de Dark Matter—, así que NO lleva el realce de brillo: lleva su
// propio filtro, que lo oscurece hasta el tono de la interfaz.
//
// CARTO sigue disponible, pero solo con clave: sin ella se ignora y se cae a
// Esri, porque servir el mapa marcado es peor que no servirlo.
const BASES = {
  oscuro:  { proveedor: 'esri',  ruta: '',                        etiqueta: 'Esri Dark Gray' },
  claro:   { proveedor: 'carto', ruta: 'rastertiles/light_all',   etiqueta: 'CARTO Positron' },
  colorido:{ proveedor: 'carto', ruta: 'rastertiles/voyager',     etiqueta: 'CARTO Voyager'  },
  cartoOscuro: { proveedor: 'carto', ruta: 'dark_all',            etiqueta: 'CARTO Dark'     },
} as const

type ClaveBase = keyof typeof BASES

function baseElegida(): ClaveBase {
  const pedida = (ESTILO_CARTO && ESTILO_CARTO in BASES)
    ? ESTILO_CARTO as ClaveBase
    : 'oscuro'

  // Pedir una base de CARTO sin clave devolvería teselas con la marca de agua.
  // Se avisa y se cae a la base libre en vez de servirlas.
  if (BASES[pedida].proveedor === 'carto' && !CARTO_API_KEY) {
    console.warn(
      `[Mapa] VITE_MAP_STYLE="${pedida}" usa CARTO, que ahora exige clave: sin ` +
      'VITE_CARTO_API_KEY las teselas llegan con "API KEY REQUIRED" encima. ' +
      'Se usa la base de Esri.'
    )
    return 'oscuro'
  }
  return pedida
}

/**
 * Capa base de todos los mapas del sitio.
 *
 * Hay tres proveedores, y la razón importa:
 *
 * **Google** se ve muy bien, pero exige una cuenta de FACTURACIÓN activa. Sin
 * ella no falla —que sería lo honesto—: sirve el mapa en modo degradado, que es
 * peor porque aparenta funcionar. Estampa "For development purposes only"
 * repetido por todo el mapa, lo lava en gris y **descarta el estilo
 * personalizado** (por eso se veían los puntos de interés que el estilo apaga).
 * Eso no tiene arreglo desde el código: se activa en Google Cloud Console.
 *
 * **CARTO** hacía justo esto mismo desde 2026: sin clave estampa "API KEY
 * REQUIRED" en cada tesela, también con HTTP 200. Ya solo se usa con clave.
 *
 * **Esri Dark Gray Canvas** no pide clave, no estampa nada y ya nace oscuro. Es
 * el predeterminado, y la única de las tres que no depende de una factura.
 *
 * Google y CARTO se piden a propósito (`VITE_MAP_PROVIDER=google`,
 * `VITE_CARTO_API_KEY`). Si Google llega a rechazar la clave, se cae solo a la
 * base libre en caliente.
 */
export function MapBaseLayer() {
  const [googleRechazado, setGoogleRechazado] = useState(false)

  // Google llama a esta función global cuando rechaza la clave (inválida, dominio
  // no autorizado, facturación desactivada). Es la única señal que da por código:
  // la filigrana de "development" no dispara nada, así que ese caso se cubre solo
  // con VITE_MAP_PROVIDER=carto.
  useEffect(() => {
    const anterior = window.gm_authFailure
    window.gm_authFailure = () => {
      console.error(
        'Google Maps rechazó la clave (comprueba que la facturación esté activa ' +
        'en Google Cloud Console). Se cambia al mapa de CARTO.'
      )
      setGoogleRechazado(true)
      anterior?.()
    }
    return () => { window.gm_authFailure = anterior }
  }, [])

  // Google es OPT-IN, no el valor por defecto. Antes bastaba con que hubiera
  // clave, y eso hacía que el despliegue heredara el mapa con la filigrana: la
  // clave está puesta en las variables de Vercel, mientras que `web/.env` es
  // local y no se sube. Pidiéndolo de forma explícita, activar Google es una
  // decisión que se toma cuando la facturación ya está lista, no un accidente
  // de configuración.
  const usarGoogle =
    PROVEEDOR_FORZADO === 'google' &&
    !!GOOGLE_MAPS_API_KEY &&
    !googleRechazado

  if (usarGoogle) {
    return (
      <ReactLeafletGoogleLayer
        apiKey={GOOGLE_MAPS_API_KEY}
        type="roadmap"
        styles={googleDarkStyle}
        maxZoom={20}
      />
    )
  }

  const base = baseElegida()

  if (BASES[base].proveedor === 'esri') {
    return (
      <TileLayer
        // Ojo al orden: Esri sirve /{z}/{y}/{x}, al revés que CARTO y OSM.
        url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
        attribution="&copy; Esri &copy; OpenStreetMap"
        // Esta base solo tiene teselas hasta z16: de z17 en adelante devuelve una
        // tesela vacía con HTTP 200 (2521 bytes, idéntica en 17, 18 y 19). Con
        // `maxNativeZoom` Leaflet reescala la de z16 en vez de pedir el vacío, así
        // que el mapa sigue acercándose hasta 20 —borroso, pero con contenido— y
        // el seguimiento de un técnico no se queda en negro al hacer zoom.
        maxNativeZoom={16}
        maxZoom={20}
        className="capa-base capa-base--esri"
      />
    )
  }

  return (
    <TileLayer
      // `{r}` pide las teselas al doble de resolución en pantallas densas; sin
      // eso el texto del mapa se ve borroso.
      url={
        `https://{s}.basemaps.cartocdn.com/${BASES[base].ruta}/{z}/{x}/{y}{r}.png` +
        `?api_key=${CARTO_API_KEY}`
      }
      attribution="&copy; OpenStreetMap &copy; CARTO"
      subdomains="abcd"
      maxZoom={20}
      className={`capa-base capa-base--${base}`}
    />
  )
}
