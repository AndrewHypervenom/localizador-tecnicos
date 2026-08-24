// Estilo del mapa de Google para el tema oscuro del panel.
// Formato: https://developers.google.com/maps/documentation/javascript/style-reference
import type L from 'leaflet'

// El estilo anterior partía de un gris casi negro (#0f1117) y el mapa quedaba
// tan apagado que no se distinguían calles ni barrios: el líder veía una mancha
// negra con puntos de colores encima. Este parte de un pizarra medio, bastante
// más claro, con las carreteras escalonadas en tres tonos para que la trama de
// la ciudad se lea de un vistazo.
//
// Sigue siendo oscuro —el panel lo es— pero ya no compite con los marcadores:
// los verdes, ámbar y rojos del estado del técnico son lo más brillante en
// pantalla, que es justo lo que debe llamar la atención.

const TIERRA        = '#252b38'  // base
const TIERRA_ALTA   = '#2d3441'  // manzanas y suelo construido
const AGUA          = '#17202e'
const PARQUE        = '#22322a'

const VIA_LOCAL     = '#333b4a'
const VIA_ARTERIA   = '#3f4859'
const VIA_RAPIDA    = '#525d72'
const VIA_BORDE     = '#1e242f'  // contorno que separa la vía del suelo

const TEXTO         = '#c3ccdb'
const TEXTO_FUERTE  = '#e6ebf3'  // nombres de ciudad
const TEXTO_TENUE   = '#8b97ab'
const TEXTO_HALO    = '#1a1f29'  // halo detrás de las etiquetas: sin esto se
                                 // pierden encima de las carreteras claras

export const googleDarkStyle: L.gridLayer.GoogleMutantStyle[] = [
  { elementType: 'geometry', stylers: [{ color: TIERRA }] },
  { elementType: 'labels.text.fill', stylers: [{ color: TEXTO }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: TEXTO_HALO }] },

  // Límites administrativos: visibles pero discretos.
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#3a4353' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.neighborhood', elementType: 'labels.text.fill', stylers: [{ color: TEXTO_TENUE }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: TEXTO_FUERTE }] },
  { featureType: 'administrative.country', elementType: 'labels.text.fill', stylers: [{ color: TEXTO }] },

  // Suelo construido: un punto por encima de la base, para que las manzanas se
  // distingan del campo abierto sin llamar la atención.
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: TIERRA_ALTA }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: TIERRA }] },

  // Puntos de interés fuera: en un mapa de rastreo son ruido y tapan a los
  // técnicos. Solo se dejan los parques, que ayudan a ubicarse.
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: PARQUE }, { visibility: 'on' }] },

  // Carreteras en tres niveles: cuanto más importante, más clara.
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: VIA_LOCAL }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: VIA_BORDE }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: TEXTO_TENUE }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: VIA_ARTERIA }] },
  { featureType: 'road.arterial', elementType: 'labels.text.fill', stylers: [{ color: TEXTO }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: VIA_RAPIDA }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: VIA_BORDE }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: TEXTO_FUERTE }] },
  // Los iconos de las señales de carretera meten manchas de color que compiten
  // con los marcadores de estado.
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },

  // Transporte público: presente, sin protagonismo.
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#2b3240' }] },
  { featureType: 'transit', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit.station', elementType: 'labels.text.fill', stylers: [{ color: TEXTO_TENUE }] },

  { featureType: 'water', elementType: 'geometry', stylers: [{ color: AGUA }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#4d637d' }] },
]
