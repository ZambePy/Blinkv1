import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AnelDeDwell } from '../../../components/ui/AnelDeDwell';

/**
 * O que é olhar para clicar.
 *
 * A animação roda no `dwellMs` **configurado** do paciente, não num valor fixo
 * bonito: mostrar 1,5 s a quem tem o dwell em 2,5 s ensina uma expectativa que
 * a tela seguinte contradiz.
 *
 * O anel é o mesmo componente do uso real, com a geometria vinda do core.
 */

const TAMANHO_PX = 120;
/** Respiro no fim do laço, para o "cheio" ser visto antes de recomeçar. */
const PAUSA_MS = 700;

export const OQueEDwell: React.FC<{ dwellMs: number }> = ({ dwellMs }) => {
  const { t } = useTranslation();
  const [progresso, setProgresso] = useState(0);

  // Sem animação para quem pediu movimento reduzido. Sintomas vestibulares são
  // comuns em quadros neurológicos, e um anel pulsando em laço é o gatilho.
  const reduzido =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (reduzido) return;
    let raf = 0;
    let inicio = performance.now();

    const passo = (agora: number) => {
      const decorrido = agora - inicio;
      if (decorrido >= dwellMs + PAUSA_MS) {
        inicio = agora;
        setProgresso(0);
      } else {
        setProgresso(Math.min(1, decorrido / dwellMs));
      }
      raf = requestAnimationFrame(passo);
    };
    raf = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf);
  }, [dwellMs, reduzido]);

  const segundos = (dwellMs / 1000).toFixed(1).replace('.', ',');

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
          {t('tutorial.dwell.title')}
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
          {t('tutorial.dwell.lead')}
        </p>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 220,
          borderRadius: '1.25rem',
          border: '1px solid var(--color-card-border)',
        }}
      >
        {reduzido ? (
          <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
            {[0, 0.5, 1].map((p) => (
              <AnelDeDwell key={p} tamanhoPx={72} progresso={p} />
            ))}
          </div>
        ) : (
          <div
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                width: TAMANHO_PX,
                height: TAMANHO_PX,
                borderRadius: '50%',
                background: 'var(--tint-info-bg)',
              }}
            />
            <AnelDeDwell tamanhoPx={TAMANHO_PX} progresso={progresso} />
          </div>
        )}
      </div>

      <ol
        style={{
          margin: 0,
          paddingLeft: '1.2rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.4rem',
        }}
      >
        {['passo1', 'passo2', 'passo3'].map((k) => (
          <li
            key={k}
            style={{
              fontSize: '0.98rem',
              lineHeight: 1.5,
              color: 'var(--color-text-base)',
              opacity: 0.88,
            }}
          >
            {t(`tutorial.dwell.${k}`)}
          </li>
        ))}
      </ol>

      <strong style={{ fontSize: '1rem', color: 'var(--color-primary)' }}>
        {t('tutorial.dwell.tempo', { s: segundos })}
      </strong>

      {reduzido && (
        <span style={{ fontSize: '0.86rem', opacity: 0.7, color: 'var(--color-text-base)' }}>
          {t('tutorial.dwell.estatico')}
        </span>
      )}
    </div>
  );
};
