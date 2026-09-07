import React from 'react';
import { CheckCircle2, AlertTriangle, XCircle, HelpCircle } from 'lucide-react';
import type { CheckStatus } from '@tracker/setupReadiness';

/**
 * Verde, amarelo, vermelho — a partir do `CheckStatus` que o
 * `evaluateReadiness` já produz.
 *
 * Não decide nada: recebe o veredito pronto do core. Um segundo lugar aplicando
 * limiares divergiria do primeiro no primeiro ajuste, e aí a tela diria verde
 * enquanto a calibração recusaria o mesmo frame.
 *
 * O ícone acompanha a cor de propósito. Cerca de 8% dos homens têm alguma
 * deficiência na distinção de vermelho e verde, e o cuidador é quem lê esta
 * tela — cor sozinha não é informação acessível.
 */

const TOM: Record<CheckStatus, { cor: string; fundo: string; borda: string }> = {
  ok: { cor: 'var(--tint-ok-text)', fundo: 'var(--tint-ok-bg)', borda: 'var(--tint-ok-border)' },
  warn: {
    cor: 'var(--tint-warn-text)',
    fundo: 'var(--tint-warn-bg)',
    borda: 'var(--tint-warn-border)',
  },
  fail: {
    cor: 'var(--tint-danger-text)',
    fundo: 'var(--tint-danger-bg)',
    borda: 'var(--tint-danger-border)',
  },
  unknown: {
    cor: 'var(--color-text-base)',
    fundo: 'transparent',
    borda: 'var(--color-card-border)',
  },
};

const ICONE: Record<CheckStatus, React.ComponentType<{ size?: number; color?: string }>> = {
  ok: CheckCircle2,
  warn: AlertTriangle,
  fail: XCircle,
  unknown: HelpCircle,
};

export const Semaforo: React.FC<{
  status: CheckStatus;
  titulo: string;
  detalhe?: string;
  /** Medida ao vivo, quando faz sentido mostrar o número. */
  valor?: string;
}> = ({ status, titulo, detalhe, valor }) => {
  const tom = TOM[status];
  const Icone = ICONE[status];

  return (
    <div
      data-status={status}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.75rem',
        padding: '0.85rem 1rem',
        borderRadius: '0.9rem',
        background: tom.fundo,
        border: `1px solid ${tom.borda}`,
      }}
    >
      <Icone size={19} color={tom.cor} aria-hidden="true" />
      <div
        style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', flex: 1, minWidth: 0 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
          <strong style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text-base)' }}>
            {titulo}
          </strong>
          {valor && (
            <span
              style={{ fontSize: '0.95rem', fontWeight: 800, color: tom.cor, whiteSpace: 'nowrap' }}
            >
              {valor}
            </span>
          )}
        </div>
        {detalhe && (
          <span
            style={{
              fontSize: '0.88rem',
              lineHeight: 1.45,
              color: 'var(--color-text-base)',
              opacity: 0.8,
            }}
          >
            {detalhe}
          </span>
        )}
      </div>
    </div>
  );
};
