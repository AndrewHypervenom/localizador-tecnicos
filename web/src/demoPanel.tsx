// ── Banco de pruebas visual del panel de técnicos ─────────────────────────────
//
// Renderiza el componente REAL (`TechnicianList`) contra el store REAL, sembrado
// con la flota sintética de `lib/demoData.ts`. Sirve para sacar una captura de la
// interfaz sin pasar por el login y sin que el panel toque Supabase.
//
// No es una maqueta redibujada: si mañana cambian los colores, las etiquetas o
// los umbrales del semáforo, esta pantalla cambia con ellos, porque es el mismo
// componente y el mismo motor de estados que ve el líder.
//
// Sólo existe en desarrollo: Vite únicamente sirve `demo-panel.html` con
// `npm run dev`, y no está en el `index.html` que se compila para producción.
//
//   npm run dev   →   http://localhost:5173/demo-panel.html
//
import React from 'react'
import ReactDOM from 'react-dom/client'
import { I18nProvider } from './lib/i18n/i18n'
import { TechnicianList } from './components/panels/TechnicianList'
import { useTrackingStore } from './store/trackingStore'
import { buildDemoTechnicians } from './lib/demoData'
import './index.css'

// Se siembra ANTES de montar para que el primer render ya salga con la flota
// puesta: así la captura no puede pillar el estado vacío intermedio.
useTrackingStore.getState().replaceTechnicians(buildDemoTechnicians())

function Harness() {
  return (
    <div className="min-h-screen bg-base p-6 flex items-start justify-start">
      {/* Ancho de la barra lateral del panel, para que la captura salga con las
          mismas proporciones que ve el líder en el sitio. */}
      <div
        id="panel"
        className="w-[360px] h-[760px] bg-surface border border-border-soft rounded-2xl overflow-hidden"
      >
        <TechnicianList className="h-full" variant="leader" />
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <Harness />
    </I18nProvider>
  </React.StrictMode>
)
