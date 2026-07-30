import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { Mountain } from 'lucide-react'
import { fmtNum } from '@/lib/utils'
import { useI18n } from '@/lib/i18n/i18n'

// Nullable a propósito: son agregaciones sobre columnas NULLABLE de
// location_events, así que el backend puede devolver null en cualquiera.
interface ElevationPoint {
  ts: string
  altitude: number | null
  distance_m: number | null
  speed_kmh: number | null
}

interface ElevationChartProps {
  data: ElevationPoint[]
  className?: string
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload as ElevationPoint
  // Cualquiera de estos puede venir null (columnas NULLABLE agregadas con AVG);
  // fmtNum evita que el tooltip tumbe el render de toda la vista.
  return (
    <div className="bg-surface-raised border border-border rounded-lg p-2.5 shadow-xl text-xs">
      <div className="font-mono text-primary font-bold">{fmtNum(d.altitude, 0)} m</div>
      <div className="text-text-muted mt-1">{fmtNum(d.distance_m != null ? d.distance_m / 1000 : null, 2)} km</div>
      <div className="text-warning">{fmtNum(d.speed_kmh, 0)} km/h</div>
    </div>
  )
}

export function ElevationChart({ data, className }: ElevationChartProps) {
  const { t } = useI18n()
  if (!data.length) {
    return (
      <div className={`flex items-center justify-center h-full text-text-muted ${className ?? ''}`}>
        <div className="text-center">
          <Mountain className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <span className="text-sm">{t('chart.noElevation')}</span>
        </div>
      </div>
    )
  }

  // Solo altitudes reales: con un null suelto, Math.min lo trata como 0 y el eje
  // se estira hasta el nivel del mar; en la media, `s + null` la sesga hacia abajo.
  const alts = data.map((d) => d.altitude).filter((a): a is number => typeof a === 'number' && Number.isFinite(a))
  if (alts.length === 0) {
    return (
      <div className={`flex items-center justify-center h-full text-text-muted ${className ?? ''}`}>
        <div className="text-center">
          <Mountain className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <span className="text-sm">{t('chart.noElevation')}</span>
        </div>
      </div>
    )
  }
  const minAlt  = Math.min(...alts)
  const maxAlt  = Math.max(...alts)
  const avgAlt  = alts.reduce((s, a) => s + a, 0) / alts.length

  return (
    <div className={className}>
      {/* Stats rápidas */}
      <div className="flex gap-4 mb-3 text-xs">
        <div>
          <span className="text-text-muted">{t('chart.min')} </span>
          <span className="font-mono text-success">{fmtNum(minAlt, 0)}m</span>
        </div>
        <div>
          <span className="text-text-muted">{t('chart.max')} </span>
          <span className="font-mono text-warning">{fmtNum(maxAlt, 0)}m</span>
        </div>
        <div>
          <span className="text-text-muted">{t('chart.avg')} </span>
          <span className="font-mono text-primary">{fmtNum(avgAlt, 0)}m</span>
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
            tickFormatter={(v) => `${fmtNum(v != null ? v / 1000 : null, 1)}km`}
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
