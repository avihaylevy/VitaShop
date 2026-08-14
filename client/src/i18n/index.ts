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

/**
 * ISSUE-038 — the chosen language survives a FULL page load. In-app the SPA
 * kept the choice; a refresh, deep link, bookmark or email link reset the
 * interface to Hebrew, discarding a stated preference (it corrupted a
 * verification pass, which is how it was found). One localStorage key, read
 * at init and written on every change; storage failures (privacy mode)
 * degrade to the old start-in-Hebrew behaviour.
 */
export const LANGUAGE_STORAGE_KEY = 'vitashop:language'

function storedLanguage(): SupportedLanguage | null {
  try {
    const value = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
    return value === 'he' || value === 'en' ? value : null
  } catch {
    return null
  }
}

const initialLanguage: SupportedLanguage = storedLanguage() ?? defaultLanguage

void i18next.use(initReactI18next).init({
  lng: initialLanguage,
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

applyDocumentDirection(initialLanguage)

// Persist every change, wherever it is triggered from (the header toggle,
// the mobile menu — one listener instead of N call sites).
i18next.on('languageChanged', (language) => {
  if (language !== 'he' && language !== 'en') return
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
  } catch {
    // Privacy mode: the choice lasts the session only, as before.
  }
})

export default i18next
