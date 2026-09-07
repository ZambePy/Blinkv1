import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, AlertTriangle, RefreshCw, ArrowRight } from 'lucide-react';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { lerCalibracao, type LeituraDaCalibracao } from './veredito';
import { getCalibrationFitDiagnostics, type CalibrationFitDiagnostics } from '@tracker/calibration';

/**
 * Resultado da calibração, em linguagem de cuidador.
 *
 * O MOTIVO vem antes do número: "você se mexeu entre os alvos" é acionável;
 * "LOO 87 px" não é. O número fica ao lado, porque quem está medindo vai
 * querer — mas não é o que a tela diz primeiro.
 *
 * **Refazer nunca é obrigatório.** Mesmo no pior veredito o botão de seguir
 * está lá: a decisão é do cuidador, que sabe coisas que o software não sabe —
 * o paciente está cansado hoje, a luz vai melhorar em dez minutos, a consulta
 * é daqui a pouco.
 */

const TOM: Record<LeituraDaCalibracao['veredicto'], { bg: string; borda: string; cor: string }> = {
  bom: { bg: 'var(--tint-ok-bg)', borda: 'var(--tint-ok-border)', cor: 'var(--tint-ok-text)' },
  aceitavel: {
    bg: 'var(--tint-warn-bg)',
    borda: 'var(--tint-warn-border)',
    cor: 'var(--tint-warn-text)',
  },
  refazer: {
    bg: 'var(--tint-danger-bg)',
    borda: 'var(--tint-danger-border)',
    cor: 'var(--tint-danger-text)',
  },
};

export const ResultadoDaCalibracao: React.FC<{
  /**
   * Injetável para teste. Sem ela, LÊ DO CORE — sem isso a tela em produção
   * cairia sempre em "aceitável" sobre um diagnóstico nulo, com cara de
   * veredito.
   */
  diagnostico?: CalibrationFitDiagnostics | null;
  aoSeguir?: () => void;
}> = ({ diagnostico, aoSeguir }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const diag = diagnostico !== undefined ? diagnostico : getCalibrationFitDiagnostics();
  const leitura = lerCalibracao(diag);
  // O destino vem de quem chamou: a regra de "tutorial na primeira vez" mora
  // na calibração, e reproduzi-la aqui criaria duas cópias dela.
  const destino = (location.state as { destino?: string } | null)?.destino ?? '/menu';
  const tom = TOM[leitura.veredicto];
  const Icone = leitura.veredicto === 'bom' ? CheckCircle2 : AlertTriangle;

  return (
    <main
      role="main"
      aria-labelledby="resultado-calib-title"
      style={{
        minHeight: '100vh',
        background: 'var(--settings-bg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem 1.5rem',
      }}
    >
      <div
        className="glass-card"
        style={{
          width: '100%',
          maxWidth: 600,
          background: 'var(--color-card-bg)',
          border: '1px solid var(--color-card-border)',
          borderRadius: '1.5rem',
          padding: '2rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.4rem',
        }}
      >
        <h1
          id="resultado-calib-title"
          style={{
            margin: 0,
            fontSize: '1.2rem',
            fontWeight: 700,
            opacity: 0.7,
            color: 'var(--color-text-base)',
          }}
        >
          {t('calib.resultado.title')}
        </h1>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.7rem',
            padding: '1.25rem',
            borderRadius: '1.15rem',
            background: tom.bg,
            border: `1px solid ${tom.borda}`,
          }}
        >
          <strong
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              fontSize: '1.3rem',
              fontWeight: 800,
              color: 'var(--color-text-base)',
            }}
          >
            <Icone size={24} color={tom.cor} aria-hidden="true" />
            {t(`calib.resultado.${leitura.veredicto}`)}
          </strong>

          <span
            style={{
              fontSize: '1rem',
              lineHeight: 1.55,
              color: 'var(--color-text-base)',
              opacity: 0.9,
            }}
          >
            {t(`calib.resultado.${leitura.veredicto}Body`)}
          </span>

          {/* O motivo, quando há. Vem ANTES dos números. */}
          {leitura.motivo && (
            <span
              style={{
                fontSize: '0.98rem',
                lineHeight: 1.55,
                color: 'var(--color-text-base)',
                fontWeight: 600,
              }}
            >
              {t(`calib.resultado.motivo.${leitura.motivo}`)}
            </span>
          )}
        </div>

        {/* Os números, para quem está medindo. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          {leitura.looErrorPx !== null && (
            <span style={{ fontSize: '0.9rem', opacity: 0.7, color: 'var(--color-text-base)' }}>
              {t('calib.resultado.erro', { px: Math.round(leitura.looErrorPx) })}
            </span>
          )}
          {leitura.derivaGraus !== null && (
            <span style={{ fontSize: '0.9rem', opacity: 0.7, color: 'var(--color-text-base)' }}>
              {t('calib.resultado.deriva', { g: leitura.derivaGraus.toFixed(1).replace('.', ',') })}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
          {/* Sempre habilitado, em TODOS os vereditos. */}
          <PrimaryButton
            type="button"
            fullWidth
            onClick={() => (aoSeguir ? aoSeguir() : navigate(destino, { replace: true }))}
            style={{ padding: '0.95rem' }}
          >
            {t('calib.resultado.seguir')} <ArrowRight size={18} aria-hidden="true" />
          </PrimaryButton>

          <PrimaryButton
            type="button"
            variant="secondary"
            fullWidth
            onClick={() => navigate('/calibration-check')}
          >
            <RefreshCw size={17} aria-hidden="true" /> {t('calib.resultado.refazerBtn')}
          </PrimaryButton>

          <span
            style={{
              fontSize: '0.85rem',
              textAlign: 'center',
              opacity: 0.65,
              color: 'var(--color-text-base)',
            }}
          >
            {t('calib.resultado.semObrigacao')}
          </span>
        </div>
      </div>
    </main>
  );
};
