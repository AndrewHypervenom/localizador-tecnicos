import { TileLayer } from 'react-leaflet'
import ReactLeafletGoogleLayer from 'react-leaflet-google-layer'
import { googleDarkStyle } from './googleDarkStyle'

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined

// Capa base única de todos los mapas del sitio: Google Maps en modo oscuro.
// Si no hay API key configurada, cae al tile oscuro de CARTO para no romper el mapa.
export function MapBaseLayer() {
  if (GOOGLE_MAPS_API_KEY) {
    return (
      <ReactLeafletGoogleLayer
        apiKey={GOOGLE_MAPS_API_KEY}
        type="roadmap"
        styles={googleDarkStyle}
        maxZoom={20}
      />
    )
  }
  return (
    <TileLayer
      url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      attribution="© OpenStreetMap contributors, © CARTO"
      maxZoom={19}
    />
  )
}
