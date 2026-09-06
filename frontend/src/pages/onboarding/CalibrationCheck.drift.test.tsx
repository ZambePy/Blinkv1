import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import type { VeredictoDeriva } from '@tracker/calibration';

/**
 * A deriva de pose entre alvos já era medida e já disparava um
 * `console.warn`, mas `grep poseDrift frontend/src/` não achava NADA: nenhuma
 * tela lia. A sessão do relatório `accuracy-report-1788225161304` calibrou com
 * 238 px-equivalentes de deriva (4× o limiar) e seguiu direto para o teste de
 * precisão. Este teste existe para que o caminho volte a ficar mudo só de
 * propósito, nunca por acidente.
 */

const veredito: VeredictoDeriva = {
  piorEixoPx: 238,
  eixo: 'pitch',
  monotona: true,
  acao: 'apoiar-a-nuca',
  mensagem:
    'A cabeça migrou 238px-equivalentes entre o primeiro e o último alvo. A deriva é monótona ' +
    '(r≈-0.98), típica de escorregar na cadeira ao longo da sessão — apoiar a nuca reduz mais ' +
    'que refazer a calibração.',
};

const getPoseDriftVerdict = vi.fn<[], VeredictoDeriva | null>(() => veredito);
const startAccuracyTest = vi.fn();

const alvos = Array.from({ length: 9 }, (_, i) => ({ x: 0.1 + (i % 3) * 0.4, y: 0.1 + Math.floor(i / 3) * 0.4 }));

vi.mock('@tracker/accuracy', () => ({
  startAccuracyTest: (...a: unknown[]) => startAccuracyTest(...a),
  abortAccuracyTest: vi.fn(),
}));
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
      // Cada ponto "coleta" com sucesso na hora; o componente agenda o próximo.
      startCollectingPoint: (_x: number, _y: number, done: (ok: boolean) => void) => done(true),
      completeCalibration: (cb?: (o: { ok: true }) => void) => cb?.({ ok: true }),
      getPoseDriftVerdict,
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

/** Percorre os 9 alvos: cada um agenda o próximo com 1200 ms. */
function calibrar() {
  // Consulta síncrona de propósito: `findBy*` espera em timers reais e trava
  // sob fake timers, que são justamente o que dirige o avanço entre alvos.
  act(() => { fireEvent.click(screen.getByTestId('start-calibration-full')); });
  for (let i = 0; i < 12; i++) {
    act(() => { vi.advanceTimersByTime(1300); });
  }
}

describe('CalibrationCheck — aviso de deriva de pose', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getPoseDriftVerdict.mockReturnValue(veredito);
    startAccuracyTest.mockClear();
  });
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

  it('para e mostra o aviso quando a deriva passa do limiar', () => {
    render(<BrowserRouter><CalibrationCheck /></BrowserRouter>);
    calibrar();

    expect(screen.getByText(/A cabeça se moveu durante a calibração/i)).toBeInTheDocument();
    // O número medido tem de aparecer em destaque: é o que separa "achei que
    // mexi um pouco" de 238px-equivalentes.
    expect(screen.getByTestId('drift-px')).toHaveTextContent('238px');
    expect(screen.getByText(/Progressiva/i)).toBeInTheDocument();
    // E o teste de precisão NÃO pode ter começado por trás do aviso.
    expect(startAccuracyTest).not.toHaveBeenCalled();
  });

  it('oferece refazer e continuar, com refazer em primeiro', () => {
    render(<BrowserRouter><CalibrationCheck /></BrowserRouter>);
    calibrar();

    expect(screen.getByTestId('drift-recalibrar')).toBeInTheDocument();
    expect(screen.getByTestId('drift-continuar')).toBeInTheDocument();
  });

  it('sem deriva acima do limiar, segue direto para o teste sem incomodar', () => {
    getPoseDriftVerdict.mockReturnValue(null);
    render(<BrowserRouter><CalibrationCheck /></BrowserRouter>);
    calibrar();

    expect(screen.queryByText(/A cabeça se moveu durante a calibração/i)).not.toBeInTheDocument();
  });
});
