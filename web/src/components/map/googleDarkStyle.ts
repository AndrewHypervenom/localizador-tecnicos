// Estilo oscuro para Google Maps (basado en el "Night mode" de Google),
// afinado para que combine con el tema oscuro del dashboard.
// Formato: https://developers.google.com/maps/documentation/javascript/style-reference
import type L from 'leaflet'

export const googleDarkStyle: L.gridLayer.GoogleMutantStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#0f1117' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0f1117' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8a93a6' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#2a2f3a' }] },
  { featureType: 'administrative.country', elementType: 'labels.text.fill', stylers: [{ color: '#9aa3b2' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#c2c9d6' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#16201a' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#22262f' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#1a1d24' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9aa3b2' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#2b303b' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3a4150' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#1a1d24' }] },
  { featureType: 'road.local', elementType: 'labels.text.fill', stylers: [{ color: '#6b7280' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#222632' }] },
  { featureType: 'transit.station', elementType: 'labels.text.fill', stylers: [{ color: '#8a93a6' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0a1622' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#3d5066' }] },
]
