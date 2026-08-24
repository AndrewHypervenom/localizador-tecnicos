import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// ── Build del SITIO DEMO ──────────────────────────────────────────────────────
//
// Compila únicamente `demo-panel.html`: el panel de técnicos alimentado con la
// flota sintética de `src/lib/demoData.ts`. Es un sitio aparte del panel real —
// distinto dominio, sin login, sin base de datos — pensado para enseñar la
// interfaz desde cualquier equipo.
//
// DOS COSAS QUE ESTE ARCHIVO GARANTIZA, y por qué:
//
//   1. `envDir` apunta a una carpeta que no existe, así que Vite NO carga
//      `web/.env`. Sin esto, el build del demo se llevaría dentro la
//      `VITE_SUPABASE_ANON_KEY` real y la publicaría en un sitio sin login. Las
//      credenciales de abajo son de pega y sirven solo para que el cliente de
//      Supabase se pueda construir: el demo no hace ni una consulta.
//
//   2. La entrada es `demo-panel.html` y NADA MÁS. El `index.html` de la
//      aplicación real no entra en este bundle, así que el sitio demo no puede
//      servir el panel de verdad ni por accidente.
//
// Uso:  npm run build:demo   →   dist-demo/
//
export default defineConfig({
  // Carpeta inexistente a propósito: corta la carga de `.env` (ver nota 1).
  envDir: path.resolve(__dirname, 'sin-env'),

  define: {
    __APP_VERSION__: JSON.stringify('demo'),
    // Credenciales inertes. Apuntan a un dominio reservado por la RFC 2606 que
    // no resuelve, de modo que aunque algo intentase una consulta, fallaría
    // sola en vez de tocar un servidor de verdad.
    'import.meta.env.VITE_SUPABASE_URL':      JSON.stringify('https://demo.invalid'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('clave-de-demostracion-sin-valor'),
  },

  plugins: [react()],

  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },

  build: {
    outDir: 'dist-demo',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'demo-panel.html'),
    },
  },
})
