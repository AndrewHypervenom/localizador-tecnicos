import { useEffect, useState } from 'react'
import { TileLayer } from 'react-leaflet'
import ReactLeafletGoogleLayer from 'react-leaflet-google-layer'
import { googleDarkStyle } from './googleDarkStyle'

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined
const PROVEEDOR_FORZADO   = import.meta.env.VITE_MAP_PROVIDER as string | undefined
const ESTILO_CARTO        = import.meta.env.VITE_MAP_STYLE as string | undefined

// Bases de CARTO. No necesitan clave ni facturación y nunca estampan nada encima.
//
// El estilo por defecto es 'claro' a propósito. La base oscura de CARTO es casi
// negra: incluso forzándole el brillo, las calles no se distinguen y el mapa
// queda como una mancha —el mismo problema que se veía con el mapa degradado de
// Google—. Una base clara y desaturada es además la que mejor hace resaltar los
// marcadores de estado (verde, ámbar, rojo), que es lo que el líder debe ver.
const BASES_CARTO = {
  claro:   { ruta: 'rastertiles/light_all', etiqueta: 'CARTO Positron' },
  colorido:{ ruta: 'rastertiles/voyager',   etiqueta: 'CARTO Voyager'  },
  oscuro:  { ruta: 'dark_all',              etiqueta: 'CARTO Dark'     },
} as const

type ClaveBase = keyof typeof BASES_CARTO

function baseCarto(): ClaveBase {
  return (ESTILO_CARTO && ESTILO_CARTO in BASES_CARTO)
    ? ESTILO_CARTO as ClaveBase
    : 'claro'
}

/**
 * Capa base de todos los mapas del sitio.
 *
 * Hay dos proveedores, y la razón importa:
 *
 * **Google** se ve muy bien, pero exige una cuenta de FACTURACIÓN activa. Sin
 * ella no falla —que sería lo honesto—: sirve el mapa en modo degradado, que es
 * peor porque aparenta funcionar. Estampa "For development purposes only"
 * repetido por todo el mapa, lo lava en gris y **descarta el estilo
 * personalizado** (por eso se veían los puntos de interés que el estilo apaga).
 * Eso no tiene arreglo desde el código: se activa en Google Cloud Console.
 *
 * **CARTO** no necesita clave ni facturación, se ve limpio y no estampa nada.
 *
 * Por eso CARTO es lo predeterminado y Google se pide a propósito con
 * `VITE_MAP_PROVIDER=google`. Además, si Google llega a rechazar la clave, se
 * vuelve solo a CARTO en caliente.
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

  const base = baseCarto()

  return (
    <TileLayer
      // `{r}` pide las teselas al doble de resolución en pantallas densas; sin
      // eso el texto del mapa se ve borroso.
      url={`https://{s}.basemaps.cartocdn.com/${BASES_CARTO[base].ruta}/{z}/{x}/{y}{r}.png`}
      attribution="&copy; OpenStreetMap &copy; CARTO"
      subdomains="abcd"
      maxZoom={20}
      className={`capa-base capa-base--${base}`}
    />
  )
}
