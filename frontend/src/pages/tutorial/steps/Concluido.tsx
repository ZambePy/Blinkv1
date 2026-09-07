import React from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Settings } from 'lucide-react';

/**
 * Conclusão.
 *
 * O "dá para refazer em Ajustes" só é dito porque o atalho existe de fato
 * (`AtalhoDeTutorial`). Prometer um caminho que não está lá é pior que não
 * prometer nada: o cuidador procura, não acha, e passa a duvidar do resto.
 */
export const Concluido: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '1.3rem',
        textAlign: 'center',
      }}
    >
      <CheckCircle2 size={56} color="var(--tint-ok-text)" aria-hidden="true" />

      <h2
        style={{ margin: 0, fontSize: '1.6rem', fontWeight: 800, color: 'var(--color-text-base)' }}
      >
        {t('tutorial.concluido.title')}
      </h2>

      <p
        style={{
          margin: 0,
          fontSize: '1.05rem',
          lineHeight: 1.5,
          opacity: 0.85,
          color: 'var(--color-text-base)',
        }}
      >
        {t('tutorial.concluido.lead')}
      </p>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem',
          padding: '0.9rem 1.15rem',
          borderRadius: '1rem',
          background: 'var(--tint-info-bg)',
          border: '1px solid var(--tint-info-border)',
        }}
      >
        <Settings size={18} color="var(--color-primary)" aria-hidden="true" />
        <span style={{ fontSize: '0.95rem', color: 'var(--color-text-base)' }}>
          {t('tutorial.concluido.refazer')}
        </span>
      </div>
    </div>
  );
};
