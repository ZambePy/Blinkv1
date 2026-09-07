import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Target, ArrowRight } from 'lucide-react';
import { PrimaryButton } from '../../../components/ui/PrimaryButton';

/**
 * Prática guiada.
 *
 * **Nunca reprova.** Sem tempo esgotado, sem "errou", sem pontuação. Quem está
 * aqui está aprendendo a usar os próprios olhos como ponteiro, muitas vezes com
 * uma doença que piora — um tutorial que diz "tente de novo" nessa situação é
 * uma barreira, e o paciente não tem como discordar dele.
 *
 * O alvo é um `<button>` comum de propósito: o `GazeContext` já sintetiza o
 * clique após o dwell configurado. Contar o tempo aqui criaria um segundo dwell
 * que divergiria do real no primeiro ajuste, e a prática ensinaria um tempo que
 * não é o do app.
 */

export const ALVOS_DA_PRATICA = 4;

export type VereditoDoTempo = 'rapido' | 'bom' | 'lento' | 'indeterminado';

/** Abaixo disto foi mouse, não olhar. */
const MS_MINIMO_PARA_SER_OLHAR = 200;

/**
 * Compara o tempo até o clique com o dwell configurado.
 *
 * Heurística, e assumida como tal no §8 do spec: mede o que aconteceu, não o
 * conforto de quem estava olhando. A decisão continua sendo do cuidador.
 */
export function vereditoDoTempo(msAteOClique: number, dwellMs: number): VereditoDoTempo {
  // O cuidador testando com o mouse produz ~0 ms. "Disparou rápido demais,
  // aumente o tempo" a partir disso seria conselho inventado.
  if (msAteOClique < MS_MINIMO_PARA_SER_OLHAR) return 'indeterminado';
  if (msAteOClique < dwellMs * 0.6) return 'rapido';
  if (msAteOClique > dwellMs * 2.5) return 'lento';
  return 'bom';
}

export const PraticaGuiada: React.FC<{
  dwellMs: number;
  /** Chamado só quando o cuidador PEDE o ajuste. A prática não muda nada sozinha. */
  aoSugerirAjuste: () => void;
}> = ({ dwellMs, aoSugerirAjuste }) => {
  const { t } = useTranslation();
  const [feitos, setFeitos] = useState(0);
  const [veredito, setVeredito] = useState<VereditoDoTempo | null>(null);
  const inicioDoAlvo = useRef(performance.now());

  const terminou = feitos >= ALVOS_DA_PRATICA;

  const acertou = () => {
    const agora = performance.now();
    setVeredito(vereditoDoTempo(agora - inicioDoAlvo.current, dwellMs));
    inicioDoAlvo.current = agora;
    setFeitos((n) => n + 1);
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
          {t('tutorial.pratica.title')}
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
          {t('tutorial.pratica.lead')}
        </p>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 260,
          borderRadius: '1.25rem',
          border: '1px solid var(--color-card-border)',
        }}
      >
        {terminou ? (
          <strong style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--tint-ok-text)' }}>
            {t('tutorial.pratica.fim')}
          </strong>
        ) : (
          <button
            type="button"
            onClick={acertou}
            aria-label={t('tutorial.pratica.alvo', { n: feitos + 1 })}
            style={{
              // Grande de propósito: a prática é sobre o TEMPO, não sobre a
              // pontaria. Um alvo pequeno mediria a calibração de novo.
              width: 180,
              height: 180,
              borderRadius: '50%',
              border: '4px solid var(--color-primary)',
              background: 'var(--tint-info-bg)',
              color: 'var(--color-text-base)',
              fontSize: '1.05rem',
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
            }}
          >
            <Target size={40} color="var(--color-primary)" aria-hidden="true" />
            {t('tutorial.pratica.alvo', { n: feitos + 1 })}
          </button>
        )}
      </div>

      {/* Sem contagem de erros nem pontuação: só quanto falta, que é
          informação de progresso e não de desempenho. */}
      {!terminou && (
        <span
          role="status"
          aria-live="polite"
          style={{ fontSize: '0.9rem', opacity: 0.7, color: 'var(--color-text-base)' }}
        >
          {t('tutorial.pratica.restantes', { n: ALVOS_DA_PRATICA - feitos })}
        </span>
      )}

      {veredito && (
        <div
          role="status"
          aria-live="polite"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.7rem',
            padding: '1rem 1.15rem',
            borderRadius: '1rem',
            background: veredito === 'bom' ? 'var(--tint-ok-bg)' : 'var(--tint-info-bg)',
            border: `1px solid ${veredito === 'bom' ? 'var(--tint-ok-border)' : 'var(--tint-info-border)'}`,
          }}
        >
          <span style={{ fontSize: '0.98rem', lineHeight: 1.5, color: 'var(--color-text-base)' }}>
            {t(`tutorial.pratica.${veredito}`)}
          </span>

          {/* Sugestão é sugestão: leva ao passo do ajuste, não muda o tempo.
              Mexer no dwell sem o cuidador pedir mudaria o app debaixo do
              paciente no meio do aprendizado. */}
          {(veredito === 'rapido' || veredito === 'lento') && (
            <PrimaryButton
              type="button"
              variant="secondary"
              onClick={aoSugerirAjuste}
              style={{ alignSelf: 'flex-start' }}
            >
              {t('tutorial.pratica.ajustar')} <ArrowRight size={16} aria-hidden="true" />
            </PrimaryButton>
          )}
        </div>
      )}
    </div>
  );
};
