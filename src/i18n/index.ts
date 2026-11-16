// i18n setup shared by the React UI and the non-React engine code.
//
// Conventions:
// - One namespace per module: "common", "toolbar", "part.<componentId>", ...
// - Keys are nested camelCase: "<area>.<item>.<property>", e.g. "attr.file.label".
// - English is the default and the fallback language, so a missing Turkish
//   string falls back to English instead of showing a raw key.
// - Component modules (Aşama 6.0b) ship their own dictionaries and register
//   them with registerNamespace() when they register themselves.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import enCommon from './locales/en/common.json';
import trCommon from './locales/tr/common.json';

export const SUPPORTED_LANGUAGES = ['en', 'tr'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = 'en';
const STORAGE_KEY = 'lds.language';

function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

function readStoredLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLanguage(stored)) return stored;
  } catch {
    // Storage can be unavailable (private mode, blocked site data).
  }
  return DEFAULT_LANGUAGE;
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { common: enCommon },
    tr: { common: trCommon },
  },
  lng: readStoredLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: SUPPORTED_LANGUAGES,
  ns: ['common'],
  defaultNS: 'common',
  // Namespaces may contain dots ("part.blifCircuit"), so only ":" separates
  // namespace from key and only "." separates nested keys.
  nsSeparator: ':',
  keySeparator: '.',
  interpolation: { escapeValue: false }, // React already escapes output
  returnNull: false,
});

export function setLanguage(language: Language): void {
  void i18n.changeLanguage(language);
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // ignore
  }
}

export function currentLanguage(): Language {
  return isLanguage(i18n.resolvedLanguage) ? i18n.resolvedLanguage : DEFAULT_LANGUAGE;
}

/** Registers a module's dictionaries, e.g. registerNamespace('part.blifCircuit', { en, tr }). */
export function registerNamespace(
  namespace: string,
  dictionaries: Partial<Record<Language, Record<string, unknown>>>,
): void {
  for (const language of SUPPORTED_LANGUAGES) {
    const dictionary = dictionaries[language];
    if (dictionary) i18n.addResourceBundle(language, namespace, dictionary, true, true);
  }
}

export default i18n;
