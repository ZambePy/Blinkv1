import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';

// Grade nominal de 9, devolvida ENQUANTO nenhum modo foi iniciado.
const GRADE_NOMINAL = [
  { x: 0.1, y: 0.1 }, { x: 0.5, y: 0.1 }, { x: 0.9, y: 0.1 },
  { x: 0.1, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.9, y: 0.5 },
  { x: 0.1, y: 0.9 }, { x: 0.5, y: 0.9 }, { x: 0.9, y: 0.9 },
];

// 4 cantos, devolvidos DEPOIS de startCalibrationMode({quick:true}).
const CANTOS_RAPIDO = [
  { x: 0.08, y: 0.08 }, { x: 0.92, y: 0.08 },
  { x: 0.08, y: 0.92 }, { x: 0.92, y: 0.92 },
];

// Grade completa recalculada pela geometria da sessão: MESMO tamanho da
// nominal, coordenadas DIFERENTES. É o caso do modo completo, que também
// diverge sempre que a distância medida não é a default.
const GRADE_SESSAO = GRADE_NOMINAL.map((p) => ({
  x: 0.17 + (p.x - 0.1) * (0.66 / 0.8),
  y: 0.17 + (p.y - 0.1) * (0.66 / 0.8),
}));

let modoIniciado: 'quick' | 'full' | null = null;

const startCalibrationMode = vi.fn((opts?: { quick?: boolean }) => {
  modoIniciado = opts?.quick ? 'quick' : 'full';
});
const getCalibrationTargets = vi.fn(() => {
  if (modoIniciado === 'quick') return CANTOS_RAPIDO;
  if (modoIniciado === 'full') return GRADE_SESSAO;
  return GRADE_NOMINAL;
});
const startCollectingPoint = vi.fn(
  (_x: number, _y: number, done: (ok: boolean) => void) => done(true),
);
const startAccuracyTest = vi.fn();

vi.mock('@tracker/accuracy', () => ({
  startAccuracyTest: (...a: unknown[]) => startAccuracyTest(...a),
}));
vi.mock('../../utils/autoTestMeta', () => ({ buildAutoTestMeta: () => ({}) }));

vi.mock('../../context/GazeContext', () => ({
  useGaze: () => ({
    l2csStatus: 'ready',
    getSessionUptimeMs: () => 1000,
    recording: { isActive: () => false, start: vi.fn(), stop: vi.fn() },
    calibration: {
      startCalibrationMode: (...a: unknown[]) => startCalibrationMode(...a),
      getCalibrationTargets: () => getCalibrationTargets(),
      getCalibrationMode: () => modoIniciado ?? 'full',
      startCollectingPoint: (...a: unknown[]) => startCollectingPoint(...a),
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
    settings: {
      screenDiagonalIn: 23.6,
      viewingDistanceCm: 60,
      opticalCondition: 'oculos_simples',
    },
    updateSettings: vi.fn(),
  }),
}));

import { CalibrationCheck } from './CalibrationCheck';

/** Percorre todos os alvos: cada um agenda o próximo com 1200 ms. */
function percorrer(passos: number) {
  for (let i = 0; i < passos; i++) {
    act(() => { vi.advanceTimersByTime(1300); });
  }
}

/** Coordenadas efetivamente enviadas ao núcleo, como pares arredondados. */
function alvosColetados(): Array<[number, number]> {
  return startCollectingPoint.mock.calls.map((c) => [
    Math.round((c[0] as number) * 1000) / 1000,
    Math.round((c[1] as number) * 1000) / 1000,
  ]);
}

function comoPares(lista: Array<{ x: number; y: number }>): Array<[number, number]> {
  return lista.map((p) => [
    Math.round(p.x * 1000) / 1000,
    Math.round(p.y * 1000) / 1000,
  ]);
}

describe('CalibrationCheck — alvos treinados == alvos exibidos', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    modoIniciado = null;
    startCollectingPoint.mockClear();
    startCalibrationMode.mockClear();
    getCalibrationTargets.mockClear();
    startAccuracyTest.mockClear();
  });
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

  it('modo rápido coleta exatamente os 4 cantos, não pontos da grade de 9', () => {
    render(<BrowserRouter><CalibrationCheck /></BrowserRouter>);
    act(() => { fireEvent.click(screen.getByTestId('start-calibration-quick')); });
    percorrer(7);

    const coletados = alvosColetados();
    expect(coletados).toHaveLength(4);

    // Cada alvo coletado tem de ser um dos 4 cantos — e todos os 4, uma vez.
    const cantos = comoPares(CANTOS_RAPIDO);
    expect([...coletados].sort()).toEqual([...cantos].sort());

    // E nenhum ponto exclusivo da grade nominal pode ter entrado.
    const nominais = comoPares(GRADE_NOMINAL);
    for (const alvo of coletados) {
      expect(nominais).not.toContainEqual(alvo);
    }
  });

  it('modo completo coleta a grade da sessão, não a nominal do load do módulo', () => {
    render(<BrowserRouter><CalibrationCheck /></BrowserRouter>);
    act(() => { fireEvent.click(screen.getByTestId('start-calibration-full')); });
    percorrer(12);

    const coletados = alvosColetados();
    expect(coletados).toHaveLength(9);
    expect([...coletados].sort()).toEqual([...comoPares(GRADE_SESSAO)].sort());
  });

  it('a lista renderizada na tela é a mesma que foi coletada', () => {
    render(<BrowserRouter><CalibrationCheck /></BrowserRouter>);
    act(() => { fireEvent.click(screen.getByTestId('start-calibration-quick')); });
    // Ainda durante a coleta: o contador de progresso tem de falar de 4 alvos.
    percorrer(2);
    expect(screen.getByTestId('calib-progress-total')).toHaveTextContent('4');
  });
});
