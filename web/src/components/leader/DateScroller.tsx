import { useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  format, addDays, subDays, startOfWeek, parseISO,
  isToday, isSameDay,
} from 'date-fns'
import { es } from 'date-fns/locale'
import { cn } from '@/lib/utils'

interface Props {
  selected: string          // 'YYYY-MM-DD'
  onChange: (date: string) => void
  weekStart: string         // 'YYYY-MM-DD' — Monday of displayed week
  onWeekChange: (weekStart: string) => void
  markedDates?: string[]    // dates that have routes (show dot)
}

export function DateScroller({ selected, onChange, weekStart, onWeekChange, markedDates = [] }: Props) {
  const markedSet = useMemo(() => new Set(markedDates), [markedDates])

  const weekDays = useMemo(() => {
    const monday = parseISO(weekStart)
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  }, [weekStart])

  const prevWeek = () => onWeekChange(format(subDays(parseISO(weekStart), 7), 'yyyy-MM-dd'))
  const nextWeek = () => onWeekChange(format(addDays(parseISO(weekStart), 7), 'yyyy-MM-dd'))

  const monthLabel = useMemo(() => {
    const start = parseISO(weekStart)
    const end   = addDays(start, 6)
    const sm    = format(start, 'MMM', { locale: es })
    const em    = format(end,   'MMM', { locale: es })
    const sy    = format(start, 'yyyy')
    if (sm === em) return `${sm} ${sy}`
    return `${sm} / ${em} ${sy}`
  }, [weekStart])

  return (
    <div className="bg-surface border border-border-soft rounded-2xl overflow-hidden select-none">
      {/* Month + navigation */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-soft">
        <button
          onClick={prevWeek}
          className="p-1.5 rounded-lg hover:bg-surface-raised transition-colors text-text-muted hover:text-text-primary"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-text-primary text-sm font-semibold capitalize">{monthLabel}</span>
        <button
          onClick={nextWeek}
          className="p-1.5 rounded-lg hover:bg-surface-raised transition-colors text-text-muted hover:text-text-primary"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Days row */}
      <div className="grid grid-cols-7 gap-0">
        {weekDays.map(day => {
          const dateStr    = format(day, 'yyyy-MM-dd')
          const isSelected = dateStr === selected
          const isCurrentDay = isToday(day)
          const hasRoutes  = markedSet.has(dateStr)
          const dayName    = format(day, 'EEE', { locale: es })
          const dayNum     = format(day, 'd')

          return (
            <button
              key={dateStr}
              onClick={() => onChange(dateStr)}
              className={cn(
                'flex flex-col items-center gap-1 py-3 px-1 transition-all duration-150 relative',
                isSelected
                  ? 'bg-primary text-white'
                  : isCurrentDay
                    ? 'hover:bg-primary/5'
                    : 'hover:bg-surface-raised',
              )}
            >
              {/* Day name */}
              <span className={cn(
                'text-xs capitalize font-medium leading-none',
                isSelected ? 'text-white/80' : 'text-text-muted',
              )}>
                {dayName.replace('.', '')}
              </span>

              {/* Day number */}
              <span className={cn(
                'text-sm font-bold leading-none w-7 h-7 flex items-center justify-center rounded-full transition-colors',
                isSelected
                  ? 'text-white bg-white/20'
                  : isCurrentDay
                    ? 'text-primary border-2 border-primary'
                    : 'text-text-primary',
              )}>
                {dayNum}
              </span>

              {/* Dot for routes */}
              <span className={cn(
                'w-1 h-1 rounded-full transition-colors',
                hasRoutes
                  ? isSelected ? 'bg-white/60' : 'bg-primary'
                  : 'bg-transparent',
              )} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Returns the ISO string for the Monday of the week containing the given date */
export function getWeekStart(dateStr: string): string {
  const d = parseISO(dateStr)
  const monday = startOfWeek(d, { weekStartsOn: 1 })
  return format(monday, 'yyyy-MM-dd')
}
