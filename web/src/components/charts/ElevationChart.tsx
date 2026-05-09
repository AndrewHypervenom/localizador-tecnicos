import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { Mountain } from 'lucide-react'

interface ElevationPoint {
  ts: string
  altitude: number
  distance_m: number
  speed_kmh: number
}

interface ElevationChartProps {
  data: ElevationPoint[]
  className?: string
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload as ElevationPoint
  return (
    <div className="bg-surface-raised border border-border rounded-lg p-2.5 shadow-xl text-xs">
      <div className="font-mono text-primary font-bold">{d.altitude.toFixed(0)} m</div>
      <div className="text-text-muted mt-1">{(d.distance_m / 1000).toFixed(2)} km</div>
      <div className="text-warning">{d.speed_kmh.toFixed(0)} km/h</div>
    </div>
  )
}

export function ElevationChart({ data, className }: ElevationChartProps) {
  if (!data.length) {
    return (
      <div className={`flex items-center justify-center h-full text-text-muted ${className ?? ''}`}>
        <div className="text-center">
          <Mountain className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <span className="text-sm">Sin datos de elevación</span>
        </div>
      </div>
    )
  }

  const minAlt  = Math.min(...data.map((d) => d.altitude))
  const maxAlt  = Math.max(...data.map((d) => d.altitude))
  const avgAlt  = data.reduce((s, d) => s + d.altitude, 0) / data.length

  return (
    <div className={className}>
      {/* Stats rápidas */}
      <div className="flex gap-4 mb-3 text-xs">
        <div>
          <span className="text-text-muted">Min </span>
          <span className="font-mono text-success">{minAlt.toFixed(0)}m</span>
        </div>
        <div>
          <span className="text-text-muted">Max </span>
          <span className="font-mono text-warning">{maxAlt.toFixed(0)}m</span>
        </div>
        <div>
          <span className="text-text-muted">Prom </span>
          <span className="font-mono text-primary">{avgAlt.toFixed(0)}m</span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={150}>
        <AreaChart data={data} margin={{ top: 5, right: 5, left: 10, bottom: 0 }}>
          <defs>
            <linearGradient id="elevGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"   stopColor="#00D632" stopOpacity={0.4} />
              <stop offset="95%"  stopColor="#00D632" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#252540" />
          <XAxis
            dataKey="distance_m"
            tickFormatter={(v) => `${(v / 1000).toFixed(1)}km`}
            tick={{ fill: '#64748B', fontSize: 10 }}
            axisLine={{ stroke: '#252540' }}
            tickLine={false}
          />
          <YAxis
            domain={[minAlt - 50, maxAlt + 50]}
            tick={{ fill: '#64748B', fontSize: 10 }}
            axisLine={{ stroke: '#252540' }}
            tickLine={false}
            tickFormatter={(v) => `${v}m`}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine
            y={avgAlt}
            stroke="#00D632"
            strokeDasharray="4 4"
            strokeOpacity={0.5}
          />
          <Area
            type="monotone"
            dataKey="altitude"
            stroke="#00D632"
            strokeWidth={2}
            fill="url(#elevGrad)"
            dot={false}
            activeDot={{ r: 4, fill: '#00D632', stroke: '#0A0A14', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
