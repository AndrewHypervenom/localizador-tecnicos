import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Clock, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

// 00:00 → 23:30 en intervalos de 30 min (48 opciones)
const TIMES = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2).toString().padStart(2, '0')
  const m = i % 2 === 0 ? '00' : '30'
  return `${h}:${m}`
})

interface Props {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}

export function TimeSelect({ value, onChange, placeholder = 'Hora', className }: Props) {
  const [open, setOpen] = useState(false)
  const btnRef  = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 })

  // Cierra al hacer clic fuera
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (!btnRef.current?.contains(t) && !listRef.current?.contains(t)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Cierra con Escape
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // Scroll al ítem seleccionado al abrir
  useEffect(() => {
    if (!open || !value) return
    const idx = TIMES.indexOf(value)
    if (idx === -1) return
    requestAnimationFrame(() => {
      const item = listRef.current?.children[idx] as HTMLElement | undefined
      item?.scrollIntoView({ block: 'center' })
    })
  }, [open, value])

  function handleOpen() {
    if (!btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    // Si hay poco espacio abajo, abre hacia arriba
    const spaceBelow = window.innerHeight - r.bottom
    const dropH = 220
    const top = spaceBelow < dropH ? r.top - dropH - 4 : r.bottom + 4
    setCoords({ top: top + window.scrollY, left: r.left + window.scrollX, width: r.width })
    setOpen(v => !v)
  }

  return (
    <div className={cn('relative', className)}>
      <button
        ref={btnRef}
        type="button"
        onClick={handleOpen}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm transition-all',
          'bg-base hover:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/30',
          open
            ? 'border-primary ring-2 ring-primary/30'
            : 'border-border-soft',
          value ? 'text-text-primary' : 'text-text-muted'
        )}
      >
        <Clock className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
        <span className="flex-1 text-left font-mono tracking-wide">
          {value || placeholder}
        </span>
        <ChevronDown className={cn(
          'w-3.5 h-3.5 text-text-muted transition-transform duration-150',
          open && 'rotate-180'
        )} />
      </button>

      {open && createPortal(
        <ul
          ref={listRef}
          style={{ position: 'absolute', top: coords.top, left: coords.left, width: coords.width, zIndex: 99999, maxHeight: '220px' }}
          className="bg-surface border border-border-soft rounded-xl shadow-2xl overflow-y-auto py-1"
        >
          {TIMES.map(t => (
            <li key={t}>
              <button
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => { onChange(t); setOpen(false) }}
                className={cn(
                  'w-full text-left px-4 py-2 text-sm font-mono tracking-wide transition-colors',
                  t === value
                    ? 'bg-primary text-base font-semibold'
                    : 'text-text-primary hover:bg-surface-raised'
                )}
              >
                {t}
              </button>
            </li>
          ))}
        </ul>,
        document.body
      )}
    </div>
  )
}
