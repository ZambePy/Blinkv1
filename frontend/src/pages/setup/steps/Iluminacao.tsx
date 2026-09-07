import React from 'react';
import { useTranslation } from 'react-i18next';
import { Sun, Info } from 'lucide-react';
import { Semaforo } from '../../../components/ui/Semaforo';
import { Cabecalho } from './EscolhaDaCamera';
import type { ReadinessCheck } from '@tracker/setupReadiness';

/**
 * Luz do ambiente.
 *
 * Os vereditos vêm prontos do `evaluateReadiness` — brilho, contraste, reflexo
 * especular em lente e cintilação de rede. As mensagens acionáveis ("sem janela
 * atrás", "sem luz direta nos óculos") saem de lá.
 *
 * **O campo de lux existe apesar de haver check automático, não em vez dele.**
 * O check mede o recorte do olho DEPOIS da exposição automática da webcam, então
 * aprova uma sala escura — já aconteceu neste projeto: 43 lux passaram como
 * "iluminação boa". Sem o valor medido a sessão não é reproduzível por
 * terceiros. `accuracy.ts` tirou `luxAmbiente` do protocolo em 2026-09-06; esta
 * tela devolve o campo à interface sem devolvê-lo à obrigatoriedade.
 *
 * Nada aqui bloqueia: luz ruim piora a precisão, não impede a sessão, e a
 * decisão é do cuidador — que sabe que a luz vai melhorar em dez minutos.
 */

const IDS_DE_LUZ = ['lighting', 'contrast', 'glasses', 'flicker'] as const;

export const Iluminacao: React.FC<{
  checks: ReadinessCheck[];
  lux: string;
  aoMudarLux: (v: string) => void;
}> = ({ checks, lux, aoMudarLux }) => {
  const { t } = useTranslation();
  const doPasso = checks.filter((c) => (IDS_DE_LUZ as readonly string[]).includes(c.id));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.3rem' }}>
      <Cabecalho titulo={t('setup.iluminacao.title')} lead={t('setup.iluminacao.lead')} />

      {doPasso.length === 0 ? (
        <Semaforo status="unknown" titulo={t('setup.camera.measuring')} />
      ) : (
        doPasso.map((c) => <Semaforo key={c.id} status={c.status} titulo={c.message} />)
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <label
          htmlFor="setup-lux"
          style={{
            fontSize: '0.9rem',
            fontWeight: 700,
            opacity: 0.9,
            color: 'var(--color-text-base)',
          }}
        >
          {t('setup.iluminacao.luxLabel')} ({t('setup.iluminacao.luxOptional')})
        </label>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <span
            aria-hidden="true"
            style={{ position: 'absolute', left: '0.9rem', display: 'flex', pointerEvents: 'none' }}
          >
            <Sun size={19} color="#64748b" />
          </span>
          <input
            id="setup-lux"
            type="text"
            inputMode="numeric"
            value={lux}
            onChange={(e) => aoMudarLux(e.target.value)}
            placeholder={t('setup.iluminacao.luxPlaceholder')}
            style={{
              background: 'var(--field-bg)',
              border: '1px solid var(--field-border)',
              borderRadius: '0.9rem',
              padding: '0.9rem 0.9rem 0.9rem 2.9rem',
              fontSize: '1rem',
              width: '100%',
              color: 'var(--color-text-base)',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
          <Info
            size={16}
            color="var(--color-primary)"
            aria-hidden="true"
            style={{ flexShrink: 0, marginTop: 3 }}
          />
          <span
            style={{
              fontSize: '0.85rem',
              lineHeight: 1.5,
              opacity: 0.78,
              color: 'var(--color-text-base)',
            }}
          >
            {t('setup.iluminacao.luxWhy')}
          </span>
        </div>
        <span style={{ fontSize: '0.85rem', opacity: 0.65, color: 'var(--color-text-base)' }}>
          {t('setup.iluminacao.luxSkip')}
        </span>
      </div>
    </div>
  );
};
