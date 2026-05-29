import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceArea, ReferenceLine,
} from 'recharts'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Gauge } from 'lucide-react'

interface SpeedPoint {
  ts: string
  speed_kmh: number
  speed_band: 'low' | 'medium' | 'high'
}

interface SpeedChartProps {
  data: SpeedPoint[]
  className?: string
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload as SpeedPoint
  const color = d.speed_band === 'high' ? '#EF4444'
    : d.speed_band === 'medium' ? '#F59E0B' : '#10B981'
  return (
    <div className="bg-surface-raised border border-border rounded-lg p-2.5 shadow-xl text-xs">
      <div className="font-mono font-bold" style={{ color }}>
        {d.speed_kmh.toFixed(1)} km/h
      </div>
      <div className="text-text-muted mt-1">
        {format(new Date(d.ts), 'hh:mm:ss a', { locale: es })}
      </div>
    </div>
  )
}

export function SpeedChart({ data, className }: SpeedChartProps) {
  if (!data.length) {
    return (
      <div className={`flex items-center justify-center h-full text-text-muted ${className ?? ''}`}>
        <div className="text-center">
          <Gauge className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <span className="text-sm">Sin datos de velocidad</span>
        </div>
      </div>
    )
  }

  const maxSpeed = Math.max(...data.map((d) => d.speed_kmh))
  const avgSpeed = data.reduce((s, d) => s + d.speed_kmh, 0) / data.length
  // A pie las velocidades son bajas; con 0 decimales un promedio de 3.4 km/h
  // se mostraría como "0". Usamos 1 decimal por debajo de 10 km/h.
  const fmtSpeed = (v: number) => (v < 10 ? v.toFixed(1) : v.toFixed(0))

  return (
    <div className={className}>
      {/* Stats rápidas */}
      <div className="flex gap-4 mb-3 text-xs">
        <div>
          <span className="text-text-muted">Máx </span>
          <span className="font-mono text-danger">{fmtSpeed(maxSpeed)} km/h</span>
        </div>
        <div>
          <span className="text-text-muted">Prom </span>
          <span className="font-mono text-warning">{fmtSpeed(avgSpeed)} km/h</span>
        </div>
        <div>
          <span className="text-text-muted">Puntos </span>
          <span className="font-mono text-text-secondary">{data.length}</span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={150}>
        <LineChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#252540" />
          {/* Bandas de velocidad como referencia visual */}
          <ReferenceArea y1={0}   y2={30}  fill="#10B981" fillOpacity={0.04} />
          <ReferenceArea y1={30}  y2={80}  fill="#F59E0B" fillOpacity={0.04} />
          <ReferenceArea y1={80}  y2={200} fill="#EF4444" fillOpacity={0.04} />
          <ReferenceLine y={avgSpeed} stroke="#F59E0B" strokeDasharray="4 4" strokeOpacity={0.6} />
          <XAxis
            dataKey="ts"
            tickFormatter={(v) => format(new Date(v), 'h:mm a', { locale: es })}
            tick={{ fill: '#64748B', fontSize: 10 }}
            axisLine={{ stroke: '#252540' }}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fill: '#64748B', fontSize: 10 }}
            axisLine={{ stroke: '#252540' }}
            tickLine={false}
            tickFormatter={(v) => `${v}`}
            domain={[0, Math.max(maxSpeed * 1.15, 10)]}
          />
          <Tooltip content={<CustomTooltip />} />
          <Line
            type="monotone"
            dataKey="speed_kmh"
            stroke="#00D632"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: '#00D632', stroke: '#0A0A14', strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
