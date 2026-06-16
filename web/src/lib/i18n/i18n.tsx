import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { es as enLocale, ptBR } from 'date-fns/locale'
import type { Locale } from 'date-fns'
import { es } from './es'
import { pt } from './pt'

export type Lang = 'es' | 'pt'

const DICTS: Record<Lang, Record<string, string>> = { es, pt }

const STORAGE_KEY = 'lang'

function detectLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'es' || stored === 'pt') return stored
  } catch { /* localStorage no disponible */ }
  const nav = (typeof navigator !== 'undefined' ? navigator.language : 'es') || 'es'
  return nav.toLowerCase().startsWith('pt') ? 'pt' : 'es'
}

/** Interpola variables {nombre} dentro de una cadena. */
function interpolate(str: string, vars?: Record<string, string | number>): string {
  if (!vars) return str
  return str.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`))
}

export type TFunc = (key: string, vars?: Record<string, string | number>) => string

interface I18nContextValue {
  lang: Lang
  setLang: (l: Lang) => void
  t: TFunc
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang)

  useEffect(() => {
    try { document.documentElement.lang = lang === 'pt' ? 'pt-BR' : 'es' } catch { /* noop */ }
  }, [lang])

  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    try { localStorage.setItem(STORAGE_KEY, l) } catch { /* noop */ }
  }, [])

  const t = useCallback<TFunc>((key, vars) => {
    const value = DICTS[lang][key] ?? DICTS.es[key] ?? key
    return interpolate(value, vars)
  }, [lang])

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n debe usarse dentro de <I18nProvider>')
  return ctx
}

/** Locale de date-fns segun el idioma actual (para format()). */
export function getDateLocale(lang: Lang): Locale {
  return lang === 'pt' ? ptBR : enLocale
}
