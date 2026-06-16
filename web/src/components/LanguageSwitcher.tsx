import { useI18n, type Lang } from '@/lib/i18n/i18n'
import { cn } from '@/lib/utils'

const OPTIONS: { value: Lang; label: string; flag: string }[] = [
  { value: 'es', label: 'ES', flag: '🇪🇸' },
  { value: 'pt', label: 'PT', flag: '🇧🇷' },
]

/** Selector compacto de idioma (ES | PT). Recuerda la preferencia en localStorage. */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { lang, setLang } = useI18n()

  return (
    <div className={cn('inline-flex items-center gap-0.5 rounded-lg border border-border-soft bg-surface-raised p-0.5', className)}>
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => setLang(opt.value)}
          aria-pressed={lang === opt.value}
          title={opt.value === 'es' ? 'Español' : 'Português (Brasil)'}
          className={cn(
            'flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition-colors',
            lang === opt.value
              ? 'bg-primary text-white'
              : 'text-text-muted hover:text-text-primary'
          )}
        >
          <span className="text-[0.9em] leading-none">{opt.flag}</span>
          {opt.label}
        </button>
      ))}
    </div>
  )
}
