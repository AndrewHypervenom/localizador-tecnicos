import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import cron from 'node-cron'
import analyticsRoutes from './routes/analytics.routes'
import adminRoutes from './routes/admin.routes'
import reportsRoutes from './routes/reports.routes'
import { detectAndCloseTrips } from './services/tripDetectionService'

const app  = express()
const PORT = process.env.PORT || 3001

app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:5173',
    process.env.WEB_URL || 'http://localhost:3000',
  ],
  credentials: true,
}))
app.use(express.json())

// Routes
app.use('/api/analytics', analyticsRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/reports', reportsRoutes)

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() })
})

// Cron: detectar viajes cada 5 minutos
cron.schedule('*/5 * * * *', () => {
  detectAndCloseTrips().catch(console.error)
})

app.listen(PORT, () => {
  console.log(`[Backend] Servidor corriendo en http://localhost:${PORT}`)
  console.log(`[Backend] Trip detection job activo (cada 5 min)`)
  // Correr inmediatamente al iniciar
  detectAndCloseTrips().catch(console.error)
})
