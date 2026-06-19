import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// ID único por build: cambia en cada despliegue. Se inyecta en la app
// (__APP_VERSION__) y se emite en /version.json para que el cliente detecte
// versiones nuevas sin que el usuario recargue a mano.
const buildId = Date.now().toString()

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(buildId),
  },
  plugins: [
    react(),
    {
      // Emite /version.json con el mismo buildId inyectado en la app.
      name: 'emit-version-json',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ version: buildId }),
        })
      },
    },
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
