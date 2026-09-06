import React from 'react';
import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';
import { supportedLngs, type SupportedLng } from '../../i18n';

interface LanguageSwitcherProps {
  compact?: boolean;
}

const SHORT_LABEL: Record<SupportedLng, string> = { 'pt-BR': 'PT', en: 'EN' };

/** Seletor de idioma do cuidador (mouse). Não é alvo de dwell. */
export const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({ compact }) => {
  const { t, i18n } = useTranslation();
  const current = (i18n.resolvedLanguage ?? 'pt-BR') as SupportedLng;

  return (
    <div
      role="group"
      aria-label={t('settings.language.title')}
      className={`lang-switch ${compact ? 'lang-switch--compact' : ''}`.trim()}
    >
      <Globe size={compact ? 16 : 18} aria-hidden="true" />
      {supportedLngs.map((lng) => (
        <button
          key={lng}
          type="button"
          onClick={() => i18n.changeLanguage(lng)}
          aria-pressed={current === lng}
          aria-label={t(`settings.language.${lng}`)}
          className="lang-switch__btn"
          data-no-dwell="true"
        >
          {SHORT_LABEL[lng]}
        </button>
      ))}
    </div>
  );
};
