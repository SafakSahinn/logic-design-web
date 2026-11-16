import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, currentLanguage, setLanguage } from './index';

interface LanguageSwitcherProps {
  theme: 'light' | 'dark';
}

/** Segmented "EN | TR" control for the toolbar. */
export function LanguageSwitcher({ theme }: LanguageSwitcherProps) {
  const { t } = useTranslation('common');
  const active = currentLanguage();
  const dark = theme === 'dark';

  return (
    <div
      role="group"
      title={t('language.switcher.tooltip')}
      aria-label={t('language.switcher.tooltip')}
      className={`flex items-center rounded-xl border overflow-hidden shadow-2xs select-none font-semibold ${
        dark ? 'border-slate-600 bg-slate-800' : 'border-slate-200 bg-white'
      }`}
    >
      {SUPPORTED_LANGUAGES.map((language) => {
        const selected = language === active;
        return (
          <button
            key={language}
            type="button"
            onClick={() => setLanguage(language)}
            aria-pressed={selected}
            title={t(`language.switcher.${language}`)}
            className={`px-2 py-1 text-xs cursor-pointer transition-colors ${
              selected
                ? dark
                  ? 'bg-amber-400/20 text-amber-300'
                  : 'bg-slate-700 text-white'
                : dark
                  ? 'text-slate-300 hover:bg-slate-700'
                  : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {language.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
