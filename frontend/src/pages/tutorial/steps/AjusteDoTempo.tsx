import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Target, Check } from 'lucide-react';
import { ControleDeDwell } from '../../../components/ui/ControleDeDwell';

/**
 * Ajuste do tempo de permanência, com teste ao lado.
 *
 * É a tela em que ELA avançada e boa fixação divergem, e a única forma de
 * acertar é experimentar — o número sozinho não diz nada a ninguém.
 *
 * Grava a cada mudança, sem botão de salvar: o alvo ao lado já é a confirmação,
 * e um passo entre "mexi" e "senti" quebraria o laço que torna a tela útil.
 */
export const AjusteDoTempo: React.FC<{
  dwellMs: number;
  aoMudar: (ms: number) => void;
}> = ({ dwellMs, aoMudar }) => {
  const { t } = useTranslation();
  const [feito, setFeito] = useState(false);
  const timer = useRef<number | null>(null);

  // Limpa o timer ao desmontar: um `setState` depois da desmontagem é o aviso
  // de vazamento que enche o console e esconde os erros que importam.
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    []
  );

  const testar = () => {
    setFeito(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setFeito(false), 1200);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.4rem' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        <h2
          style={{
            margin: 0,
            fontSize: '1.5rem',
            fontWeight: 800,
            color: 'var(--color-text-base)',
          }}
        >
          {t('tutorial.ajuste.title')}
        </h2>
        <p
          style={{
            margin: 0,
            fontSize: '1rem',
            lineHeight: 1.5,
            opacity: 0.8,
            color: 'var(--color-text-base)',
          }}
        >
          {t('tutorial.ajuste.lead')}
        </p>
      </div>

      <ControleDeDwell valorMs={dwellMs} aoMudar={aoMudar} compacto />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 200,
          borderRadius: '1.25rem',
          border: '1px solid var(--color-card-border)',
        }}
      >
        <button
          type="button"
          aria-label={t('tutorial.ajuste.alvo')}
          onClick={testar}
          style={{
            width: 150,
            height: 150,
            borderRadius: '50%',
            border: `4px solid ${feito ? 'var(--tint-ok-text)' : 'var(--color-primary)'}`,
            background: feito ? 'var(--tint-ok-bg)' : 'var(--tint-info-bg)',
            color: 'var(--color-text-base)',
            fontSize: '1rem',
            fontWeight: 800,
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.4rem',
          }}
        >
          {feito ? (
            <>
              <Check size={36} color="var(--tint-ok-text)" aria-hidden="true" />
              {t('tutorial.ajuste.feito')}
            </>
          ) : (
            <>
              <Target size={36} color="var(--color-primary)" aria-hidden="true" />
              {t('tutorial.ajuste.alvo')}
            </>
          )}
        </button>
      </div>
    </div>
  );
};
