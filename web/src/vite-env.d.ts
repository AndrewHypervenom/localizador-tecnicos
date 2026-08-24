/// <reference types="vite/client" />

// Inyectado por Vite (define) en build-time: ID único de la versión desplegada.
declare const __APP_VERSION__: string

interface Window {
  /**
   * La API de Google Maps invoca esta función global cuando rechaza la clave
   * (inválida, dominio no autorizado o facturación desactivada). `MapBaseLayer`
   * la usa para cambiarse solo al mapa de CARTO.
   */
  gm_authFailure?: () => void
}
