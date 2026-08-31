import { createContext, useContext, useEffect } from 'react'
import type { ReactNode } from 'react'
import { createI18n, htmlLang, type Lang, type Params } from '@/office/i18n'
import { strings } from './strings'

const translate = createI18n(strings)

export type StringKey = keyof typeof strings.zh
export type TFunc = (key: StringKey, params?: Params) => string

const LocaleContext = createContext<Lang>('en')

export function LocaleProvider({ initial, children }: { initial: Lang; children: ReactNode }) {
  useEffect(() => {
    document.documentElement.lang = htmlLang(initial)
  }, [initial])
  return <LocaleContext.Provider value={initial}>{children}</LocaleContext.Provider>
}

export function useI18n(): { lang: Lang; t: TFunc } {
  const lang = useContext(LocaleContext)
  return { lang, t: (key, params) => translate(lang, key, params) }
}
