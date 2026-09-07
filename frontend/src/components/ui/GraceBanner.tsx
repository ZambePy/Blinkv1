import React from 'react';
import { useTranslation } from 'react-i18next';
import { CloudOff } from 'lucide-react';
import { useLicense } from '../../context/LicenseContext';

/**
 * Aviso de licença em tolerância offline.
 *
 * O app segue funcionando quando não consegue falar com o servidor — a
 * comunicação de quem tem ELA não pode depender do Wi-Fi. Mas isso não pode
 * ser invisível: o cuidador precisa saber que existe uma pendência antes de
 * ela virar bloqueio, daqui a alguns dias.
 *
 * Discreto de propósito. A tela pertence ao paciente, e um alarme permanente
 * atravessado na comunicação seria pior do que o problema que anuncia.
 */
export const GraceBanner: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { status, lastVerifiedAt } = useLicense();

  if (status !== 'grace') return null;

  const data = lastVerifiedAt
    ? new Date(lastVerifiedAt).toLocaleDateString(i18n.language, {
        day: 'numeric',
        month: 'long',
      })
    : '—';

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 900,
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.4rem 1rem',
        borderRadius: '0 0 0.85rem 0.85rem',
        background: 'rgba(255, 251, 235, 0.96)',
        border: '1px solid #fde68a',
        borderTop: 'none',
        color: '#92400e',
        fontSize: '0.82rem',
        fontWeight: 600,
        pointerEvents: 'none',
        maxWidth: '90vw',
      }}
    >
      <CloudOff size={15} aria-hidden="true" style={{ flexShrink: 0 }} />
      <span>{t('license.grace.banner', { date: data })}</span>
    </div>
  );
};
