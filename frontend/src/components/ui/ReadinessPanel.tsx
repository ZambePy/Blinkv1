import React, { useEffect, useState } from 'react';
import { Check, AlertTriangle, X } from 'lucide-react';
import { useGaze } from '../../context/GazeContext';
import { evaluateReadiness, type ReadinessReport } from '@tracker/setupReadiness';
import { snapshotFromDiagnostics, lerViewport } from '@tracker/setupReadinessAdapter';

/**
 * Painel de prontidão do posto de uso: distância, enquadramento, postura,
 * iluminação, contraste, reflexo em lentes e viewport, avaliados ao vivo
 * antes de gastar tempo de calibração com dado ruim.
 *
 * Avisos (`warn`) não bloqueiam — a decisão é do cuidador. Só `fail` impede.
 * Enquanto a qualidade não foi medida, o painel diz "medindo" em vez de
 * emitir veredito.
 */
export const ReadinessPanel: React.FC<{ onReadyChange?: (ready: boolean) => void }> = ({
  onReadyChange,
}) => {
  const { getDiagnostics } = useGaze();
  const [report, setReport] = useState<ReadinessReport | null>(null);
  const [medindo, setMedindo] = useState(true);

  useEffect(() => {
    // 2 Hz: a avaliação é barata, mas atualizar a 30 Hz faria os textos
    // piscarem e ninguém consegue ler.
    const id = setInterval(() => {
      const d = getDiagnostics();
      if (!d) return;
      const snap = snapshotFromDiagnostics(d, lerViewport());
      if (!snap) {
        setMedindo(true);
        return;
      }
      setMedindo(false);
      const r = evaluateReadiness(snap);
      setReport(r);
      onReadyChange?.(r.canStart);
    }, 500);
    return () => clearInterval(id);
  }, [getDiagnostics, onReadyChange]);

  if (medindo || !report) {
    return (
      <div className="readiness" role="status" aria-live="polite">
        <div className="readiness__measuring">Medindo as condições do posto de uso…</div>
      </div>
    );
  }

  const Icon = ({ status }: { status: string }) =>
    status === 'fail' ? (
      <X size={18} aria-hidden="true" />
    ) : status === 'warn' ? (
      <AlertTriangle size={18} aria-hidden="true" />
    ) : (
      <Check size={18} aria-hidden="true" />
    );

  return (
    <div className="readiness" role="status" aria-live="polite">
      {report.checks.map((c) => (
        <div key={c.id} className={`readiness__item readiness__item--${c.status}`}>
          <span className="readiness__icon">
            <Icon status={c.status} />
          </span>
          <span className="readiness__text">{c.message}</span>
        </div>
      ))}
      {report.blockedHard && (
        <div className="readiness__blocked">Corrija os itens acima antes de calibrar.</div>
      )}
    </div>
  );
};
