import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import type { GazeSample } from '@tracker/tracker/engine';

/**
 * O cursor não pode aparecer durante o teste de precisão.
 *
 * O comentário do dispatcher já dizia isso ("se o usuário vir o cursor ele
 * tenta corrigi-lo, criando feedback loop que corrompe a medida"), mas
 * `isAccuracyTesting` não era lido em lugar nenhum do arquivo: o cursor ficava
 * visível durante os ~17 s da medição, e o erro relatado passava a ser o do
 * loop de perseguição, não o do modelo.
 */

let medindo = false;

vi.mock('@tracker/accuracy', () => ({
  get isAccuracyTesting() { return medindo; },
  startAccuracyTest: vi.fn(),
}));

let emitir: (s: GazeSample) => void = () => {};

const engineMock = {
  start: vi.fn(async () => {}),
  stop: vi.fn(),
  dispose: vi.fn(),
  subscribe: (cb: (s: GazeSample) => void) => { emitir = cb; return () => {}; },
  onStateChange: () => () => {},
  onL2CSStatusChange: () => () => {},
  getState: () => 'tracking',
  getSessionUptimeMs: () => 1000,
  getDiagnostics: () => null,
  setFilterPreset: vi.fn(),
  setScreenGeometry: vi.fn(),
  calibration: {
    isCalibrated: () => true,
    onInvalidated: () => () => {},
    setCameraFovDeg: vi.fn(),
    setEyeDominance: vi.fn(),
    getDistanceRange: () => null,
    getCalibrationDistancesCm: () => ({ cameraCm: null, screenCm: null }),
    abort: vi.fn(),
    clear: vi.fn(),
  },
  recording: { isActive: () => false, start: vi.fn(), stop: vi.fn(), clear: vi.fn() },
};

vi.mock('@tracker/tracker/engine', async (orig) => {
  const real = await orig<typeof import('@tracker/tracker/engine')>();
  return { ...real, createGazeEngine: () => engineMock };
});

vi.mock('./SettingsContext', () => ({
  useSettings: () => ({
    settings: { dwellMs: 1500, filterPreset: 'balanceado-v2', eyeDominance: 'both' },
    updateSettings: vi.fn(),
  }),
}));

import { GazeProvider } from './GazeContext';
import { EXPERIMENT } from '@tracker/config/experiment';

function amostra(): GazeSample {
  return {
    x: 400, y: 300, timestamp: 0,
    hasFace: true, degraded: false, uncalibrated: false, eyeState: 'open',
  } as GazeSample;
}

/** O provider cria o cursor como um `div[aria-hidden]` filho direto do body. */
function cursor(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(':scope > div[aria-hidden="true"]');
}

describe('GazeContext — cursor durante o teste de precisão', () => {
  beforeEach(() => {
    medindo = false;
    emitir = () => {};
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => { throw new Error('sem câmera no teste'); }) },
    });
    document.elementFromPoint = vi.fn(() => document.body);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    EXPERIMENT.cursorNoTesteDePrecisao = false;
  });

  it('aparece no rastreamento normal e some enquanto o teste mede', () => {
    render(<GazeProvider><div /></GazeProvider>);

    act(() => { emitir(amostra()); });
    const c = cursor();
    expect(c).not.toBeNull();
    expect(c!.style.opacity).not.toBe('0');

    medindo = true;
    act(() => { emitir(amostra()); });
    expect(cursor()!.style.opacity).toBe('0');
    expect(cursor()!.style.transform).toContain('-9999px');

    medindo = false;
    act(() => { emitir(amostra()); });
    expect(cursor()!.style.opacity).not.toBe('0');
  });

  /**
   * Escotilha do operador: ver ao vivo se o cursor acompanha o alvo. Um erro
   * de 3° e um mapeamento invertido dão relatórios parecidos e telas
   * completamente diferentes, e só a tela distingue os dois.
   *
   * O preço é conhecido e está no comentário da flag: a rodada deixa de ser
   * comparável. Por isso a flag entra no `pipeline.experiment` do relatório —
   * quem ler depois sabe que aquela medição teve cursor na tela.
   */
  it('fica visível durante a medição quando a flag do operador está ligada', () => {
    EXPERIMENT.cursorNoTesteDePrecisao = true;
    render(<GazeProvider><div /></GazeProvider>);

    medindo = true;
    act(() => { emitir(amostra()); });
    expect(cursor()!.style.opacity).not.toBe('0');
    expect(cursor()!.style.transform).not.toContain('-9999px');
  });

  it('a flag NÃO revela o cursor durante a calibração', () => {
    EXPERIMENT.cursorNoTesteDePrecisao = true;
    engineMock.getState = () => 'calibrating';
    render(<GazeProvider><div /></GazeProvider>);

    act(() => { emitir(amostra()); });
    expect(cursor()!.style.opacity).toBe('0');
    engineMock.getState = () => 'tracking';
  });
});
