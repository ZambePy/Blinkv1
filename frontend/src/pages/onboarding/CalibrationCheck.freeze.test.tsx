import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';

/**
 * Regressão da tela travada em "9 / 9".
 *
 * `completeCalibration` treina os dois regressores E roda o diagnóstico de
 * ajuste (9 folds leave-one-target-out × 2 olhos) de forma SÍNCRONA. Medido
 * com um perfil realista (225 amostras, 27 dims após a expansão polinomial):
 * 533 ms nos dois treinos + 3514 ms no diagnóstico = ~4 s de main thread
 * bloqueado.
 *
 * Como `setStage('testing')` era chamado no MESMO tick síncrono, o React 18
 * agrupava a atualização e o navegador nunca chegava a pintar a tela
 * "Iniciando teste de precisão": o paciente ficava olhando "9 / 9" congelado
 * por segundos, sem nenhum sinal de que o sistema estava vivo.
 *
 * O contrato aqui é o mínimo verificável: quando o treino COMEÇA, a tela de
 * transição já tem de estar no DOM.
 */

const startAccuracyTest = vi.fn();
const getCalibrationFitDiagnostics = vi.fn(() => null);
const getTargetsSkipped = vi.fn(() => [] as { x: number; y: number }[]);
const alvos = Array.from({ length: 9 }, (_, i) => ({ x: 0.1 + (i % 3) * 0.4, y: 0.1 + Math.floor(i / 3) * 0.4 }));

/** O que estava na tela no instante em que o treino foi disparado. */
let domNoInicioDoTreino: string | null = null;

vi.mock('@tracker/accuracy', () => ({
  startAccuracyTest: (...a: unknown[]) => startAccuracyTest(...a),
  abortAccuracyTest: vi.fn(),
}));
vi.mock('../../utils/autoTestMeta', () => ({
  buildAutoTestMeta: () => ({}),
  montarMetaDeMedicao: () => ({}),
}));

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
      startCollectingPoint: (_x: number, _y: number, done: (ok: boolean) => void) => done(true),
      // Faz o papel dos ~4 s de treino: registra a tela no momento da chamada.
      completeCalibration: (cb?: (o: { ok: true }) => void) => {
        domNoInicioDoTreino = document.body.textContent;
        cb?.({ ok: true });
      },
      getPoseDriftVerdict: () => null,
      getCalibrationFitDiagnostics,
      getTargetsSkipped,
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

/**
 * Percorre os 9 alvos avançando o relógio em passos de 100 ms.
 *
 * O passo pequeno é o ponto do teste: `act()` só comita o estado do React ao
 * SAIR do bloco. Num passo de 1200 ms o timer do último alvo E os rAF caem no
 * mesmo `act`, e o DOM ainda estaria velho na hora do treino — artefato do
 * ambiente, não do navegador. Com 100 ms, o `setStage` comita ao fim de um
 * `act` e os rAF rodam no seguinte, que é a ordem real: o React comita ao fim
 * da tarefa e o quadro pinta depois.
 */
function calibrar() {
  act(() => { fireEvent.click(screen.getByTestId('start-calibration-full')); });
  // 160 passos cobrem a contagem inicial ("Prepare-se") mais os 9 alvos.
  for (let i = 0; i < 160; i++) act(() => { vi.advanceTimersByTime(100); });
}

describe('CalibrationCheck — não congela em 9/9 durante o treino', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    domNoInicioDoTreino = null;
    startAccuracyTest.mockClear();
    getCalibrationFitDiagnostics.mockClear();
    getTargetsSkipped.mockClear();
  });
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

  it('pinta "Iniciando teste de precisão" ANTES de começar o treino', () => {
    render(<BrowserRouter><CalibrationCheck /></BrowserRouter>);
    calibrar();

    expect(domNoInicioDoTreino).not.toBeNull();
    expect(domNoInicioDoTreino).toContain('Iniciando teste de precisão');
  });

  /**
   * O diagnóstico de ajuste custa ~9 s (leave-one-target-out sobre as 606
   * amostras que a calibração coleta). A tela só precisa da CONTAGEM de alvos
   * pulados, que sai de `getTargetsSkipped` sem rodar o LOO. Chamar o
   * diagnóstico completo aqui devolve a tela travada entre a calibração e o
   * teste — foi exatamente esse o bug.
   */
  it('não dispara o diagnóstico caro no caminho para o teste', () => {
    render(<BrowserRouter><CalibrationCheck /></BrowserRouter>);
    calibrar();
    act(() => { vi.advanceTimersByTime(500); });

    expect(getTargetsSkipped).toHaveBeenCalled();
    expect(getCalibrationFitDiagnostics).not.toHaveBeenCalled();
  });

  it('ainda chega ao teste de precisão depois do treino', () => {
    render(<BrowserRouter><CalibrationCheck /></BrowserRouter>);
    calibrar();
    act(() => { vi.advanceTimersByTime(500); });
    expect(startAccuracyTest).toHaveBeenCalled();
  });
});
