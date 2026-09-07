import React from 'react';
import { useTranslation } from 'react-i18next';
import { Ruler, ArrowUpDown } from 'lucide-react';
import { Semaforo } from '../../../components/ui/Semaforo';
import { FramingIndicator } from '../../../components/ui/FramingIndicator';
import { Cabecalho } from './EscolhaDaCamera';
import { ESTABILIDADE_EXIGIDA_MS } from '../estabilidade';
import type { ReadinessCheck } from '@tracker/setupReadiness';

/**
 * Posicionamento do paciente — o passo mais importante do preparo.
 *
 * Não mede nada por conta própria: recebe os checks que o `evaluateReadiness`
 * já produz. Um segundo avaliador de distância ao lado do que existe divergiria
 * do primeiro no primeiro ajuste de limiar, e a tela diria verde enquanto a
 * calibração recusaria o mesmo frame.
 *
 * Monta o `FramingIndicator`, que estava **órfão** no projeto — escrito,
 * funcionando, e sem nenhum chamador de produção.
 *
 * A altura da tela aparece como instrução, não como medição: a câmera não sabe
 * onde o monitor está. Fingir um veredito aqui seria pior que instruir.
 */

const IDS_DE_POSICAO = ['face', 'distance', 'centering', 'headPose'] as const;

export const Posicionamento: React.FC<{
  checks: ReadinessCheck[];
  distanciaCm: number | null;
  msEstavel: number;
  verde: boolean;
}> = ({ checks, distanciaCm, msEstavel, verde }) => {
  const { t } = useTranslation();
  const doPasso = checks.filter((c) => (IDS_DE_POSICAO as readonly string[]).includes(c.id));
  const progresso = Math.min(1, msEstavel / ESTABILIDADE_EXIGIDA_MS);
  const segundos = Math.ceil((ESTABILIDADE_EXIGIDA_MS - msEstavel) / 1000);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.3rem' }}>
      <Cabecalho titulo={t('setup.posicionamento.title')} lead={t('setup.posicionamento.lead')} />

      <FramingIndicator />

      <Semaforo
        status={distanciaCm === null ? 'unknown' : 'ok'}
        titulo={t('setup.posicionamento.distance')}
        valor={
          distanciaCm === null
            ? t('setup.posicionamento.distanceUnknown')
            : `${Math.round(distanciaCm)} cm`
        }
      />

      {doPasso.map((c) => (
        <Semaforo key={c.id} status={c.status} titulo={c.message} />
      ))}

      <div
        style={{
          display: 'flex',
          gap: '0.75rem',
          padding: '0.9rem 1.05rem',
          borderRadius: '0.9rem',
          border: '1px solid var(--color-card-border)',
        }}
      >
        <ArrowUpDown
          size={19}
          color="var(--color-primary)"
          aria-hidden="true"
          style={{ flexShrink: 0, marginTop: 2 }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          <strong style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text-base)' }}>
            {t('setup.posicionamento.screenHeight')}
          </strong>
          <span
            style={{
              fontSize: '0.88rem',
              lineHeight: 1.45,
              opacity: 0.8,
              color: 'var(--color-text-base)',
            }}
          >
            {t('setup.posicionamento.screenHeightHint')}
          </span>
        </div>
      </div>

      {/* A janela de estabilidade. O contador zera ao sair do verde — sem isso o
          cuidador clica no instante de sorte e a calibração parte de uma pose
          que durou 30 ms. */}
      <div
        role="status"
        aria-live="polite"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.55rem',
          padding: '1rem 1.15rem',
          borderRadius: '1rem',
          background: progresso >= 1 ? 'var(--tint-ok-bg)' : 'var(--tint-info-bg)',
          border: `1px solid ${progresso >= 1 ? 'var(--tint-ok-border)' : 'var(--tint-info-border)'}`,
        }}
      >
        <strong
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.98rem',
            fontWeight: 800,
            color: 'var(--color-text-base)',
          }}
        >
          <Ruler size={18} aria-hidden="true" />
          {progresso >= 1
            ? t('setup.posicionamento.ready')
            : verde
              ? t('setup.posicionamento.holding', { segundos: Math.max(1, segundos) })
              : t('setup.posicionamento.holdTitle')}
        </strong>

        <span
          style={{
            fontSize: '0.88rem',
            lineHeight: 1.45,
            opacity: 0.85,
            color: 'var(--color-text-base)',
          }}
        >
          {!verde && msEstavel === 0
            ? t('setup.posicionamento.holdBody', { segundos: ESTABILIDADE_EXIGIDA_MS / 1000 })
            : !verde
              ? t('setup.posicionamento.lost')
              : t('setup.posicionamento.holdBody', { segundos: ESTABILIDADE_EXIGIDA_MS / 1000 })}
        </span>

        <div
          aria-hidden="true"
          style={{
            height: 6,
            borderRadius: 999,
            background: 'var(--color-card-border)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${progresso * 100}%`,
              borderRadius: 999,
              background: progresso >= 1 ? 'var(--tint-ok-text)' : 'var(--color-primary)',
              transition: 'width 0.2s linear',
            }}
          />
        </div>
      </div>
    </div>
  );
};
