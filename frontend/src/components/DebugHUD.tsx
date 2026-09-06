import React, { useEffect, useState } from 'react';
import { useGaze } from '../context/GazeContext';
import type { EngineDiagnostics } from '../context/GazeContext';
import { lerParametroDeUrl } from '../urlParams';
import { medicaoEmAndamento } from '../medicaoEmAndamento';

const rad2deg = (r: number) => ((r * 180) / Math.PI).toFixed(1);

/** HUD de diagnóstico do operador (`?debug=1`). Nunca aparece para o paciente. */
export const DebugHUD: React.FC = () => {
  // `lerParametroDeUrl` e não `useSearchParams`: com `HashRouter` o react-router
  // só enxerga a query DEPOIS do `#`, e a documentação instrui `?debug=1` antes.
  const isDebug = lerParametroDeUrl('debug') === '1';
  const { getDiagnostics, state } = useGaze();
  const [diag, setDiag] = useState<EngineDiagnostics | null>(null);

  useEffect(() => {
    if (!isDebug) return;
    const interval = setInterval(() => {
      setDiag(getDiagnostics());
    }, 250);
    return () => clearInterval(interval);
  }, [isDebug, getDiagnostics]);

  // Some durante calibração e teste de precisão: os alvos ficam nas bordas e
  // este painel fica no canto superior direito, em cima deles.
  if (!isDebug || !diag || medicaoEmAndamento(state)) return null;

  const estagios = Object.entries(diag.stageLatency)
    .sort((a, b) => b[1].p95Ms - a[1].p95Ms)
    .slice(0, 4);

  return (
    <div className="hud" aria-hidden="true">
      <div className="hud__grid">
        <span className="hud__key">FPS render</span>
        <span>{diag.fpsRender.toFixed(1)}</span>

        <span className="hud__key">L2CS</span>
        <span>
          {diag.l2cs.status} &middot; {diag.l2cs.hz.toFixed(1)} Hz &middot;{' '}
          {diag.l2cs.latencyMs.toFixed(0)} ms &middot;{' '}
          {/* `stale` acima de 50%: o modelo roda com 4 das 6 dimensões. */}
          <span className={diag.l2cs.stalePct > 50 ? 'hud__bad' : undefined}>
            stale {diag.l2cs.stalePct.toFixed(0)} %
          </span>{' '}
          &middot; conf {diag.l2cs.confidence.toFixed(2)}
          {/* Fila presa acima de zero = submissão travada, com status 'ready'. */}
          {diag.l2cs.pendingCount > 0 && (
            <>
              {' '}
              &middot; <span className="hud__warn">fila {diag.l2cs.pendingCount}</span>
            </>
          )}
        </span>

        <span className="hud__key">yaw / pitch</span>
        <span>
          {rad2deg(diag.gaze.yaw)}&deg; / {rad2deg(diag.gaze.pitch)}&deg;
        </span>

        <span className="hud__key">pose</span>
        <span>
          y {rad2deg(diag.pose.yaw)}&deg; p {rad2deg(diag.pose.pitch)}&deg; r{' '}
          {rad2deg(diag.pose.roll)}&deg;
        </span>

        <span className="hud__key">features</span>
        <span>
          {diag.features.dims} dims &middot; blink {diag.features.blink ? 'sim' : 'não'}
        </span>

        <span className="hud__key">predito</span>
        <span>
          ({diag.prediction.x.toFixed(0)}, {diag.prediction.y.toFixed(0)}) px
        </span>

        <span className="hud__key">calibrado</span>
        <span>
          {diag.calibration.calibrated ? 'sim' : 'não'} &middot; &lambda;={diag.calibration.lambda}{' '}
          &middot; {diag.calibration.samples} amostras
        </span>

        <span className="hud__key">exp</span>
        <span>
          expand {diag.experiment.expandFactor} &middot; cad {diag.experiment.cadenceMs} ms
        </span>

        {/* Latência por estágio: os quatro mais caros por p95. Estágios que
            nunca rodaram não aparecem — ausência é "não executou". */}
        <span className="hud__key">latência</span>
        <span>
          {estagios.length === 0
            ? 'sem amostras'
            : estagios
                .map(([nome, s]) => `${nome} ${s.p50Ms.toFixed(1)}/${s.p95Ms.toFixed(1)}`)
                .join(' · ')}
        </span>
      </div>
      <div className="hud__foot">p50/p95 em ms &middot; console: __irisflowLatencia()</div>
    </div>
  );
};
