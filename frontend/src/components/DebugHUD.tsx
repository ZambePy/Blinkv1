import React, { useEffect, useState } from 'react';
import { useGaze } from '../context/GazeContext';
import type { EngineDiagnostics } from '../context/GazeContext';
import { useSearchParams } from 'react-router-dom';

export const DebugHUD: React.FC = () => {
  const [searchParams] = useSearchParams();
  const isDebug = searchParams.get('debug') === '1';
  const { getDiagnostics } = useGaze();
  const [diag, setDiag] = useState<EngineDiagnostics | null>(null);

  useEffect(() => {
    if (!isDebug) return;

    const interval = setInterval(() => {
      setDiag(getDiagnostics());
    }, 250); // 4 Hz update rate

    return () => clearInterval(interval);
  }, [isDebug, getDiagnostics]);

  if (!isDebug || !diag) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        color: '#0f0',
        fontFamily: 'monospace',
        fontSize: '12px',
        padding: '12px',
        borderRadius: '8px',
        pointerEvents: 'none',
        zIndex: 9999,
        lineHeight: 1.5,
        minWidth: '250px',
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '8px' }}>
        <span style={{ color: '#88f' }}>FPS render</span>
        <span>{diag.fpsRender.toFixed(1)}</span>

        <span style={{ color: '#88f' }}>L2CS</span>
        <span>
          {diag.l2cs.status} &middot; {diag.l2cs.hz.toFixed(1)} Hz &middot; {diag.l2cs.latencyMs.toFixed(0)} ms &middot; stale {diag.l2cs.stalePct.toFixed(0)} %
        </span>

        <span style={{ color: '#88f' }}>yaw / pitch</span>
        <span>
          {(diag.gaze.yaw * 180 / Math.PI).toFixed(1)}&deg; / {(diag.gaze.pitch * 180 / Math.PI).toFixed(1)}&deg;
        </span>

        <span style={{ color: '#88f' }}>pose</span>
        <span>
          y {(diag.pose.yaw * 180 / Math.PI).toFixed(1)}&deg; p {(diag.pose.pitch * 180 / Math.PI).toFixed(1)}&deg; r {(diag.pose.roll * 180 / Math.PI).toFixed(1)}&deg;
        </span>

        <span style={{ color: '#88f' }}>features</span>
        <span>
          {diag.features.dims} dims &middot; blink {diag.features.blink ? 'sim' : 'não'}
        </span>

        <span style={{ color: '#88f' }}>predito</span>
        <span>
          ({diag.prediction.x.toFixed(0)}, {diag.prediction.y.toFixed(0)}) px
        </span>

        <span style={{ color: '#88f' }}>calibrado</span>
        <span>
          {diag.calibration.calibrated ? 'sim' : 'não'} &middot; &lambda;={diag.calibration.lambda} &middot; {diag.calibration.samples} amostras
        </span>

        <span style={{ color: '#88f' }}>exp</span>
        <span>
          expand {diag.experiment.expandFactor} &middot; cad {diag.experiment.cadenceMs} ms &middot; gazeCorr {diag.experiment.applyGazeCorrection ? 'on' : 'off'}
        </span>
      </div>
    </div>
  );
};
