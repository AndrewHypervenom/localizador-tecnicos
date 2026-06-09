import ReactLeafletGoogleLayer from 'react-leaflet-google-layer'
import { googleDarkStyle } from './googleDarkStyle'

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined

// Capa base única de todos los mapas del sitio: Google Maps en modo oscuro.
// Sin fallback: si falta la API key el mapa no carga (se avisa por consola).
export function MapBaseLayer() {
  if (!GOOGLE_MAPS_API_KEY) {
    console.error('Falta VITE_GOOGLE_MAPS_API_KEY: el mapa de Google no se cargará.')
    return null
  }
  return (
    <ReactLeafletGoogleLayer
      apiKey={GOOGLE_MAPS_API_KEY}
      type="roadmap"
      styles={googleDarkStyle}
      maxZoom={20}
    />
  )
}
