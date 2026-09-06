import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';

/**
 * Um alvo que esgota as tentativas é pulado para a sessão não travar — mas o
 * modelo então prediz aquela região por extrapolação. A tela tem de avisar e
 * oferecer refazer, em vez de seguir em silêncio para o teste de precisão.
 */

const alvos = Array.from({ length: 9 }, (_, i) => ({ x: 0.1 + (i % 3) * 0.4, y: 0.1 + Math.floor(i / 3) * 0.4 }));
const startAccuracyTest = vi.fn();

// O alvo do centro nunca coleta; os outros passam de primeira.
const startCollectingPoint = vi.fn((x: number, y: number, done: (ok: boolean) => void) => {
  done(!(x === 0.5 && y === 0.5));
});

vi.mock('@tracker/accuracy', () => ({ startAccuracyTest: (...a: unknown[]) => startAccuracyTest(...a) }));
vi.mock('../../utils/autoTestMeta', () => ({ buildAutoTestMeta: () => ({}) }));

vi.mock('../../context/GazeContext', () => ({
  useGaze: () => ({
    l2csStatus: 'ready',
    getSessionUptimeMs: () => 1000,
    getDiagnostics: () => null,
    recording: { isActive: () => false, start: vi.fn(), stop: vi.fn() },
    calibration: {
      startCalibrationMode: vi.fn(),
      getCalibrationTargets: () => alvos,
      getCalibrationMode: () => 'full',
      startCollectingPoint: (...a: unknown[]) => startCollectingPoint(...(a as [number, number, (ok: boolean) => void])),
      completeCalibration: (cb?: (o: { ok: true }) => void) => cb?.({ ok: true }),
      getPoseDriftVerdict: () => null,
      setCalibrationDistancesCm: vi.fn(),
      setCameraFovDeg: vi.fn(),
      isCalibrated: () => true,
      clear: vi.fn(),
    },
  }),
}));

vi.mock('../../context/SettingsContext', () => ({
  useSettings: () => ({
    settings: { screenDiagonalIn: 23.6, viewingDistanceCm: 60, opticalCondition: 'oculos_simples' },
    updateSettings: vi.fn(),
  }),
}));

import { CalibrationCheck } from './CalibrationCheck';

describe('CalibrationCheck — aviso de alvos ignorados', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    startAccuracyTest.mockClear();
    startCollectingPoint.mockClear();
  });
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

  it('avisa quantos pontos ficaram de fora e não dispara o teste sozinho', () => {
    render(<BrowserRouter><CalibrationCheck /></BrowserRouter>);
    act(() => { fireEvent.click(screen.getByTestId('start-calibration-full')); });
    // 8 alvos bons (1,2 s cada) + 3 tentativas do centro (1,5 s cada) + folga.
    for (let i = 0; i < 20; i++) {
      act(() => { vi.advanceTimersByTime(1300); });
    }

    expect(screen.getByTestId('skipped-warning')).toHaveTextContent('1 ponto foi ignorado');
    expect(screen.getByTestId('drift-recalibrar')).toBeInTheDocument();
    expect(startAccuracyTest).not.toHaveBeenCalled();
  });
});
