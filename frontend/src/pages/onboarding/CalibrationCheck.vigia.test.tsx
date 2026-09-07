import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';

/**
 * Vigia de 6 s da tela de calibração, e a saída do diálogo de deriva.
 *
 * O caso real: o operador relatou a tela travada em "Iniciando teste de
 * precisão" sem NENHUMA mensagem, indefinidamente. O vigia existia justamente
 * para isso e nunca disparou — o efeito dependia de `getDiagnostics`, cuja
 * identidade é refeita pelo `useMemo` do GazeContext a cada transição de estado
 * do engine. Cada re-render remontava o efeito, o `clearTimeout` matava o
 * temporizador antes dos 6 s, e o vigia ficava inerte exatamente no cenário
 * que ele deveria cobrir.
 *
 * Aqui o `startAccuracyTest` é um stub que NÃO abre overlay nenhum (é o
 * travamento), e o componente re-renderiza a cada 500 ms.
 */

const startAccuracyTest = vi.fn();
const alvos = Array.from({ length: 9 }, (_, i) => ({
  x: 0.1 + (i % 3) * 0.4,
  y: 0.1 + Math.floor(i / 3) * 0.4,
}));

vi.mock('@tracker/accuracy', () => ({ startAccuracyTest: (...a: unknown[]) => startAccuracyTest(...a) }));
vi.mock('../../utils/autoTestMeta', () => ({
  buildAutoTestMeta: () => ({}),
  montarMetaDeMedicao: () => ({}),
}));

let derivaVerdict: { piorEixoPx: number; eixo: string; monotona: boolean; acao: string; mensagem: string } | null = null;

// Identidade estável, como o `useMemo([])` do GazeContext real.
const calibration = {
  startCalibrationMode: vi.fn(),
  getCalibrationTargets: () => alvos,
  getCalibrationMode: () => 'full',
  startCollectingPoint: (_x: number, _y: number, done: (ok: boolean) => void) => done(true),
  completeCalibration: (cb?: (o: { ok: true }) => void) => cb?.({ ok: true }),
  getPoseDriftVerdict: () => derivaVerdict,
  getCalibrationFitDiagnostics: () => ({ targetsSkipped: [] }),
  setCalibrationDistancesCm: vi.fn(),
  setCameraFovDeg: vi.fn(),
  getCurrentCameraDistanceCm: () => null,
  isCalibrated: () => true,
  clear: vi.fn(),
  abort: vi.fn(),
  getActiveOpticalCondition: () => 'desconhecido',
};

// Alterna a cada leitura: força um re-render por poll (500 ms), reproduzindo o
// que o `state` do engine faz no app real.
let alterna = false;
const recording = {
  isActive: () => (alterna = !alterna),
  start: vi.fn(),
  stop: vi.fn(),
  getStats: () => ({ frames: 0, dropped: 0 }),
  exportAsJSONL: () => '',
  clear: vi.fn(),
};

vi.mock('../../context/GazeContext', () => ({
  useGaze: () => ({
    l2csStatus: 'ready',
    getSessionUptimeMs: () => 1000,
    // Identidade NOVA a cada render, como o contexto real.
    getDiagnostics: () => null,
    recording,
    calibration,
  }),
}));

vi.mock('../../context/SettingsContext', () => ({
  useSettings: () => ({
    settings: {
      screenDiagonalIn: 23.6,
      viewingDistanceCm: 60,
      screenGeometrySource: 'default',
      screenScaleFactor: 1,
    },
    updateSettings: vi.fn(),
  }),
}));

import { CalibrationCheck } from './CalibrationCheck';

/** Percorre os 9 alvos: cada um agenda o próximo com 1200 ms. */
function calibrar() {
  act(() => { fireEvent.click(screen.getByTestId('start-calibration-full')); });
  for (let i = 0; i < 14; i++) act(() => { vi.advanceTimersByTime(1300); });
}

describe('CalibrationCheck — vigia do teste de precisão', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    startAccuracyTest.mockClear();
    derivaVerdict = null;
    alterna = false;
  });
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

  it('avisa quando o teste não abre em 6 s, mesmo com a tela re-renderizando', () => {
    render(<BrowserRouter><CalibrationCheck /></BrowserRouter>);
    calibrar();
    expect(startAccuracyTest).toHaveBeenCalled();
    // Nenhum `#accuracy-overlay` foi criado — é o travamento relatado.
    expect(document.getElementById('accuracy-overlay')).toBeNull();

    // Avança em passos que deixam o React aplicar cada re-render do poll.
    for (let i = 0; i < 30; i++) act(() => { vi.advanceTimersByTime(500); });

    expect(screen.getByText(/O teste de precisão não começou/i)).toBeInTheDocument();
  });

  it('não avisa quando o overlay do teste aparece', () => {
    startAccuracyTest.mockImplementation(() => {
      const o = document.createElement('div');
      o.id = 'accuracy-overlay';
      document.body.appendChild(o);
    });
    render(<BrowserRouter><CalibrationCheck /></BrowserRouter>);
    calibrar();
    for (let i = 0; i < 30; i++) act(() => { vi.advanceTimersByTime(500); });

    expect(screen.queryByText(/O teste de precisão não começou/i)).not.toBeInTheDocument();
    document.getElementById('accuracy-overlay')?.remove();
  });
});

describe('CalibrationCheck — saída do aviso de deriva', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    startAccuracyTest.mockClear();
    derivaVerdict = {
      piorEixoPx: 238, eixo: 'pitch', monotona: true, acao: 'apoiar-a-nuca',
      mensagem: 'A cabeça migrou 238px-equivalentes.',
    };
    alterna = false;
  });
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

  it('os dois botões são acionáveis pelo olhar (sem data-no-dwell)', () => {
    render(<BrowserRouter><CalibrationCheck /></BrowserRouter>);
    calibrar();

    // O diálogo é a única saída da tela; com `data-no-dwell` o dispatcher os
    // tratava como desabilitados e um usuário gaze-only ficava preso nele.
    for (const id of ['drift-recalibrar', 'drift-continuar']) {
      const b = screen.getByTestId(id);
      expect(b).not.toHaveAttribute('data-no-dwell');
      expect(b).not.toBeDisabled();
      // Dwell longo: acionamento deliberado, não bloqueio.
      expect(Number(b.getAttribute('data-dwell-ms'))).toBeGreaterThanOrEqual(2000);
    }
  });
});
