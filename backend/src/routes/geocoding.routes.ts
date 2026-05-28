import { Router, Request, Response } from 'express'
import Anthropic from '@anthropic-ai/sdk'

const router = Router()

// ── Helpers ───────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

async function geocodeGoogle(query: string): Promise<{ lat: number; lng: number; displayName: string } | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY
  if (!key) return null
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 6000)
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${key}&language=es&region=co`
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timeout)
    if (!res.ok) return null
    const data = await res.json() as {
      status: string
      results: Array<{ formatted_address: string; geometry: { location: { lat: number; lng: number } } }>
    }
    if (data.status !== 'OK' || !data.results.length) return null
    const r = data.results[0]
    return { lat: r.geometry.location.lat, lng: r.geometry.location.lng, displayName: r.formatted_address }
  } catch {
    return null
  }
}

// ── POST /api/geocoding/batch ─────────────────────────────────────────────────
// Geocodifica un array de direcciones en paralelo usando:
//   1. Claude (una sola llamada para normalizar todas)
//   2. Google Maps en paralelo para las que necesiten coords precisas
// Muy rápido: ~3-5 s para 30 direcciones en lugar de 30+ s secuenciales.

interface AddressInput { direccion: string; ciudad: string; cliente?: string }

router.post('/batch', async (req: Request, res: Response) => {
  const { addresses } = req.body as { addresses: AddressInput[] }
  if (!addresses?.length) return res.json({ results: [] })

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY no configurada' })
  }
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    return res.status(503).json({ error: 'GOOGLE_MAPS_API_KEY no configurada' })
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  // ── Paso 1: Claude normaliza TODAS las direcciones en una sola llamada ──────
  const addressList = addresses
    .map((a, i) => `${i}. direccion="${a.direccion}" ciudad="${a.ciudad}"`)
    .join('\n')

  const prompt = `Eres un experto en nomenclatura urbana colombiana. Normaliza cada dirección y proporciona coordenadas GPS.

DIRECCIONES:
${addressList}

REGLAS DE NORMALIZACIÓN:
- CL/CLL/CLLE → "Calle"  |  CRA/KRA/CR/KR → "Carrera"  |  AV → "Avenida"
- AVCR/AVKR → "Avenida Carrera"  |  AVCL → "Avenida Calle"
- DG/DIAG → "Diagonal"  |  TV/TR → "Transversal"  |  AC → "Autopista Central"
- Preserva sufijos de cuadrante: SUR, NORTE, ESTE, OCCIDENTE, BIS
  Ej: "CL 57CSUR" → "Calle 57C Sur"  |  "CRA 86SUR" → "Carrera 86 Sur"
- Elimina: APT, APTO, LC, LOCAL, OFC, PISO, PI, TORRE, BLOQUE, INT, MZ, LOTE, NIVEL
- Edificios/CCs conocidos: "TITAN PLAZA" → "Titan Plaza", "TOBERIN" → "Toberín"
- Si es rural (KM, VEREDA, VDA, ZONA FRANCA, parque industrial): marca approximateOnly=true
  Y extrae el nombre del negocio/edificio en "businessName" (limpio, sin abreviaciones)
  Ej: "DAATCENTER NAOS 1.5KM VÍA BRICEÑO..." → businessName: "Datacenter Naos", ciudad: "Tocancipá"
  Ej: "BODEGAS CENTRALES KM 5 VÍA..." → businessName: "Bodegas Centrales"

COORDENADAS DE REFERENCIA BOGOTÁ (para estimar):
Centro: 4.6534,-74.0836 | Norte (Cl 100+): 4.70,-74.05 | Sur (Cl 50Sur+): 4.58,-74.12
Suroccidente: 4.62,-74.16 | Noroccidente: 4.69,-74.10 | Kennedy: 4.62,-74.15
Chía: 4.863,-74.061 | Tocancipá: 4.970,-73.908 | Soacha: 4.579,-74.217

Devuelve SOLO un array JSON (sin texto adicional):
[{"id":0,"normalizedAddress":"Carrera 7 24-89, Bogotá","lat":4.614,"lng":-74.067,"confidence":"high","approximateOnly":false,"businessName":null},...]

Para rurales: {"id":1,"normalizedAddress":"Zona Franca Tocancipá","lat":4.970,"lng":-73.908,"confidence":"low","approximateOnly":true,"businessName":"Datacenter Naos"}

confidence: "high"=calle específica, "medium"=sector/barrio, "low"=solo ciudad`

  let claudeItems: Array<{
    id: number
    normalizedAddress: string
    lat?: number
    lng?: number
    confidence: 'high' | 'medium' | 'low'
    approximateOnly?: boolean
    businessName?: string | null
  }> = []

  try {
    const msg = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages:   [{ role: 'user', content: prompt }],
    })
    const text = ((msg.content[0] as { type: string; text: string }).text || '').trim()
    const match = text.match(/\[[\s\S]*\]/)
    if (match) claudeItems = JSON.parse(match[0])
    console.log(`[geocoding/batch] Claude normalizó ${claudeItems.length}/${addresses.length} direcciones`)
  } catch (err) {
    console.error('[geocoding/batch] Claude error:', err)
  }

  // ── Paso 2: Google Maps en PARALELO para coords precisas ───────────────────
  const results = await Promise.all(
    addresses.map(async (addr, i) => {
      const ci = claudeItems.find(c => c.id === i)
      const ciudadLimpia = addr.ciudad.replace(/,?\s*D\.?C\.?/i, '').trim()

      // Si es rural/industrial, intentar primero Google Maps como POI con el nombre del negocio
      if (ci?.approximateOnly) {
        if (ci.businessName) {
          const qPoi = `${ci.businessName}, ${ciudadLimpia}, Colombia`
          const rPoi = await geocodeGoogle(qPoi)
          if (rPoi) {
            console.log(`[geocoding/batch] [${i}] Google POI OK: "${qPoi}" → (${rPoi.lat.toFixed(4)}, ${rPoi.lng.toFixed(4)})`)
            return { id: i, lat: rPoi.lat, lng: rPoi.lng, displayName: rPoi.displayName, confidence: 'google-poi', radius: 0.3 }
          }
        }
        if (ci.lat && ci.lng) {
          console.log(`[geocoding/batch] [${i}] rural/approx: (${ci.lat}, ${ci.lng})`)
          return { id: i, lat: ci.lat, lng: ci.lng, displayName: ci.normalizedAddress, confidence: 'claude-approx', radius: 2.0 }
        }
      }

      // Intento 1: Google Maps con la dirección normalizada por Claude
      if (ci?.normalizedAddress) {
        const q1 = `${ci.normalizedAddress}, ${ciudadLimpia}, Colombia`
        const r1 = await geocodeGoogle(q1)
        if (r1) {
          console.log(`[geocoding/batch] [${i}] Google OK (norm): "${q1}" → (${r1.lat.toFixed(4)}, ${r1.lng.toFixed(4)})`)
          return { id: i, lat: r1.lat, lng: r1.lng, displayName: r1.displayName, confidence: 'google', radius: 0.3 }
        }
      }

      // Intento 2: Google Maps con la dirección raw
      const q2 = `${addr.direccion}, ${ciudadLimpia}, Colombia`
      const r2 = await geocodeGoogle(q2)
      if (r2) {
        console.log(`[geocoding/batch] [${i}] Google OK (raw): "${q2}" → (${r2.lat.toFixed(4)}, ${r2.lng.toFixed(4)})`)
        return { id: i, lat: r2.lat, lng: r2.lng, displayName: r2.displayName, confidence: 'google', radius: 0.3 }
      }

      // Fallback: coordenadas aproximadas de Claude
      if (ci?.lat && ci.lng) {
        const radius = ci.confidence === 'high' ? 0.4 : ci.confidence === 'medium' ? 0.7 : 1.5
        console.log(`[geocoding/batch] [${i}] Claude approx (${ci.confidence}): (${ci.lat}, ${ci.lng})`)
        return { id: i, lat: ci.lat, lng: ci.lng, displayName: ci.normalizedAddress, confidence: `claude-${ci.confidence}`, radius }
      }

      console.warn(`[geocoding/batch] [${i}] FAIL: "${addr.direccion}, ${addr.ciudad}"`)
      return { id: i, confidence: 'failed', radius: 0.3 }
    })
  )

  const ok   = results.filter(r => r.lat).length
  const fail = results.filter(r => !r.lat).length
  console.log(`[geocoding/batch] Resultado: ${ok} OK, ${fail} FAIL de ${addresses.length} total`)

  return res.json({ results })
})

// ── POST /api/geocoding/resolve (individual, para búsquedas manuales) ─────────
router.post('/resolve', async (req: Request, res: Response) => {
  const { direccion, ciudad, cliente } = req.body as { direccion: string; ciudad: string; cliente?: string }
  if (!direccion || !ciudad) return res.status(400).json({ error: 'direccion y ciudad requeridos' })
  if (!process.env.GOOGLE_MAPS_API_KEY) return res.status(503).json({ error: 'GOOGLE_MAPS_API_KEY no configurada' })

  const ciudadLimpia = ciudad.replace(/,?\s*D\.?C\.?/i, '').trim()

  // ── Paso 1: Claude normaliza la dirección (igual que en /batch) ───────────
  let normalizedAddress: string | null = null
  let claudeLat: number | null = null
  let claudeLng: number | null = null

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      const clienteCtx = cliente ? `\ncliente: "${cliente}"` : ''
      const msg = await anthropic.messages.create({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 256,
        messages:   [{
          role:    'user',
          content: `Normaliza esta dirección colombiana y estima coordenadas GPS. Devuelve SOLO un JSON.

dirección: "${direccion}"
ciudad: "${ciudadLimpia}"${clienteCtx}

REGLAS:
- CL/CLL/CLLE→Calle | CRA/KRA/CR/KR→Carrera | AV→Avenida | DG/DIAG→Diagonal | TV/TR→Transversal
- Preserva sufijos: SUR, NORTE, ESTE, OCCIDENTE, BIS
- Agrega # y - donde corresponda: "Calle 74A Sur 92 71" → "Calle 74A Sur #92-71"
- Elimina: APT, APTO, LC, LOCAL, OFC, PISO, TORRE, BLOQUE, INT, MZ, LOTE

COORDS BOGOTÁ (referencia): Centro:4.6534,-74.0836 | Norte(Cl100+):4.70,-74.05 | Sur(Cl50Sur+):4.58,-74.12 | Suroccidente(Bosa/Kennedy):4.62,-74.16 | Noroccidente:4.69,-74.10

Formato de respuesta (solo JSON, sin texto extra):
{"normalizedAddress":"Calle 74A Sur #92-71, Bogotá","lat":4.628,"lng":-74.204}`,
        }],
      })
      const text = ((msg.content[0] as { type: string; text: string }).text || '').trim()
      const match = text.match(/\{[\s\S]*?\}/)
      if (match) {
        const parsed = JSON.parse(match[0])
        if (parsed.normalizedAddress) normalizedAddress = parsed.normalizedAddress
        if (parsed.lat && parsed.lng)  { claudeLat = parsed.lat; claudeLng = parsed.lng }
      }
      console.log(`[geocoding/resolve] Claude → "${normalizedAddress}" (${claudeLat?.toFixed(4)}, ${claudeLng?.toFixed(4)})`)
    } catch (err) {
      console.error('[geocoding/resolve] Claude error:', err)
    }
  }

  // ── Paso 2: Google Maps con dirección normalizada por Claude ──────────────
  if (normalizedAddress) {
    const q = normalizedAddress.toLowerCase().includes(ciudadLimpia.toLowerCase())
      ? `${normalizedAddress}, Colombia`
      : `${normalizedAddress}, ${ciudadLimpia}, Colombia`
    const r = await geocodeGoogle(q)
    if (r) {
      console.log(`[geocoding/resolve] Google OK (norm): "${q}" → (${r.lat.toFixed(4)}, ${r.lng.toFixed(4)})`)
      return res.json({ ...r, confidence: 'google', radius: 0.3 })
    }
  }

  await sleep(100)

  // ── Paso 3: Google Maps con dirección raw ─────────────────────────────────
  const q2 = `${direccion}, ${ciudadLimpia}, Colombia`
  const r2 = await geocodeGoogle(q2)
  if (r2) {
    console.log(`[geocoding/resolve] Google OK (raw): "${q2}" → (${r2.lat.toFixed(4)}, ${r2.lng.toFixed(4)})`)
    return res.json({ ...r2, confidence: 'google', radius: 0.3 })
  }

  await sleep(100)

  // ── Paso 4: Google Maps limpiando unidad/apartamento ─────────────────────
  const baseDir = direccion.replace(/\b(APT|APTO|LOCAL|LC|OFC|OFICINA|PISO|PI\d*|TORRE|BLOQUE|INT|MZ|LOTE|NIVEL)\s*[\w-]*/gi, '').replace(/\s+/g, ' ').trim()
  if (baseDir !== direccion) {
    const r3 = await geocodeGoogle(`${baseDir}, ${ciudadLimpia}, Colombia`)
    if (r3) return res.json({ ...r3, confidence: 'google', radius: 0.3 })
  }

  // ── Paso 5: Coordenadas aproximadas de Claude como último recurso ─────────
  if (claudeLat && claudeLng) {
    console.log(`[geocoding/resolve] Claude approx: (${claudeLat}, ${claudeLng})`)
    return res.json({
      lat:         claudeLat,
      lng:         claudeLng,
      displayName: normalizedAddress ?? `${direccion}, ${ciudadLimpia}`,
      confidence:  'claude-approx',
      radius:      0.5,
    })
  }

  return res.json({ confidence: 'failed', radius: 0.3 })
})

export default router
