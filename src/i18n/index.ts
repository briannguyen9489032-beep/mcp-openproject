import { EN_LOCALE } from './en'
import { VI_LOCALE } from './vi'

export type UiLocale = 'en' | 'vi'

export const LOCALES: Record<UiLocale, Record<string, string>> = {
  en: EN_LOCALE,
  vi: VI_LOCALE
}

export function t(
  locale: UiLocale,
  key: string,
  params?: Record<string, string | number>
): string {
  const dict = LOCALES[locale] ?? LOCALES.en
  let template = dict[key] ?? LOCALES.en[key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      template = template.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v))
    }
  }
  return template
}

export function createTranslator(locale: UiLocale) {
  return (key: string, params?: Record<string, string | number>): string =>
    t(locale, key, params)
}
