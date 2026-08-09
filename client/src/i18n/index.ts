import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'

import { resources } from './resources'

export const supportedLanguages = ['he', 'en'] as const
export type SupportedLanguage = (typeof supportedLanguages)[number]

export const defaultLanguage: SupportedLanguage = 'he'

export const languageDirection: Record<SupportedLanguage, 'rtl' | 'ltr'> = {
  he: 'rtl',
  en: 'ltr',
}

void i18next.use(initReactI18next).init({
  lng: defaultLanguage,
  fallbackLng: defaultLanguage,
  supportedLngs: supportedLanguages,
  resources,
  defaultNS: 'common',
  interpolation: {
    escapeValue: false,
  },
})

export function applyDocumentDirection(language: SupportedLanguage) {
  document.documentElement.lang = language
  document.documentElement.dir = languageDirection[language]
}

applyDocumentDirection(defaultLanguage)

export default i18next
