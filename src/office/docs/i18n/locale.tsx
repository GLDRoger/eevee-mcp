import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { format, type Lang, type Params } from '@/office/i18n'
import { strings } from './strings'

export type StringKey = keyof typeof strings
export type TFunc = (key: StringKey, params?: Params) => string

const translate: TFunc = (key, params) => format(strings[key], params)

// Mirror for non-React pagination and editor modules.
// set before first render and on every language switch
let moduleLang: Lang = 'en'
export const getLang = (): Lang => moduleLang
export const setModuleLang = (lang: Lang): void => {
  moduleLang = lang
}
/** module-level translator — components should prefer useI18n().t so they re-render on switch */
export const t: TFunc = (key, params) => translate(key, params)

/** BCP-47 locale per UI language, for date/number formatting */
export const DATE_LOCALES: Record<Lang, string> = {
  zh: 'zh-CN',
  en: 'en-US',
  ja: 'ja-JP',
  ko: 'ko-KR',
  fr: 'fr-FR',
  de: 'de-DE',
  es: 'es-ES',
  th: 'th-TH',
  id: 'id-ID',
  ru: 'ru-RU',
  ar: 'ar-SA',
  pt: 'pt-BR',
  it: 'it-IT',
  pl: 'pl-PL',
  nl: 'nl-NL',
  ms: 'ms-MY',
  he: 'he-IL',
  hi: 'hi-IN',
  'zh-TW': 'zh-TW',
}

const LocaleContext = createContext<Lang>('en')

export function LocaleProvider({ initial, children }: { initial: Lang; children: ReactNode }) {
  const [lang] = useState<Lang>(initial)
  useEffect(() => setModuleLang(initial), [initial])
  return <LocaleContext.Provider value={lang}>{children}</LocaleContext.Provider>
}

export interface I18n {
  lang: Lang
  t: TFunc
  /** BCP-47 locale for date/number formatting */
  dateLocale: string
}

export function useI18n(): I18n {
  const lang = useContext(LocaleContext)
  return {
    lang,
    t: (key, params) => translate(key, params),
    dateLocale: DATE_LOCALES[lang],
  }
}
