import React from 'react';
import { useTranslation } from 'react-i18next';
import { Timer } from 'lucide-react';
import {
  DWELL_MIN_MS,
  DWELL_MAX_MS,
  PRESETS_DE_DWELL,
  limitarDwellMs,
  presetMaisProximo,
} from '../../dwellMs';

/**
 * Controle do tempo de permanência — **um só**, usado pelo tutorial e pelas
 * Configurações.
 *
 * Dois controles para a mesma grandeza é como limiares divergem: alguém ajusta
 * a faixa num e esquece o outro, e a partir daí a mesma configuração significa
 * coisas diferentes dependendo da tela em que foi mexida.
 *
 * O slider é o controle principal e os presets são atalhos. Era o contrário —
 * três botões e nada entre eles — e a distância entre um paciente com ELA
 * avançada e alguém com boa fixação não cabe em três degraus.
 */

const emSegundos = (ms: number) => (ms / 1000).toFixed(1).replace('.', ',');

export const ControleDeDwell: React.FC<{
  valorMs: number;
  aoMudar: (ms: number) => void;
  /** Esconde o texto de ajuda quando a tela em volta já explicou. */
  compacto?: boolean;
}> = ({ valorMs, aoMudar, compacto }) => {
  const { t } = useTranslation();
  const atual = limitarDwellMs(valorMs);
  const preset = presetMaisProximo(atual);
  const segundos = emSegundos(atual);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
        }}
      >
        <label
          htmlFor="dwell-slider"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '1rem',
            fontWeight: 700,
            color: 'var(--color-text-base)',
          }}
        >
          <Timer size={18} color="var(--color-primary)" aria-hidden="true" />
          {t('dwell.label')}
        </label>
        <strong style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--color-primary)' }}>
          {t('dwell.seconds', { s: segundos })}
        </strong>
      </div>

      {!compacto && (
        <span
          style={{
            fontSize: '0.88rem',
            lineHeight: 1.5,
            opacity: 0.78,
            color: 'var(--color-text-base)',
          }}
        >
          {t('dwell.hint')}
        </span>
      )}

      <input
        id="dwell-slider"
        type="range"
        min={DWELL_MIN_MS}
        max={DWELL_MAX_MS}
        step={50}
        value={atual}
        // `limitarDwellMs` mesmo com min/max no elemento: o valor também chega
        // de storage editado à mão, e um dwell fora da faixa nunca completa.
        onChange={(e) => aoMudar(limitarDwellMs(Number(e.target.value)))}
        // "1500" lido por um leitor de tela não diz nada; "1,5 segundos" diz.
        aria-valuetext={t('dwell.valueText', { s: segundos })}
        style={{ width: '100%', accentColor: 'var(--color-primary)', cursor: 'pointer' }}
      />

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {PRESETS_DE_DWELL.map((p) => {
          const ativo = preset?.id === p.id;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={ativo}
              onClick={() => aoMudar(p.ms)}
              style={{
                flex: 1,
                minWidth: 88,
                padding: '0.5rem 0.9rem',
                borderRadius: '0.7rem',
                border: `1px solid ${ativo ? 'var(--tint-info-border)' : 'var(--color-card-border)'}`,
                background: ativo ? 'var(--tint-info-bg)' : 'transparent',
                color: 'var(--color-text-base)',
                fontSize: '0.9rem',
                fontWeight: ativo ? 800 : 600,
                cursor: 'pointer',
              }}
            >
              {t(`dwell.presets.${p.id}`)}
            </button>
          );
        })}
      </div>
    </div>
  );
};
