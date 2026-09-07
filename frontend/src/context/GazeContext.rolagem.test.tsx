import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';
import type { GazeSample } from '@tracker/tracker/engine';
import { FAIXA_PX, ATRASO_MS } from '@tracker/interaction/edgeScroll';

// -----------------------------------------------------------------------------
// A regra que protege o botão de emergência.
//
// Ele fica EXATAMENTE numa borda — `top: 2rem` no uso normal, `bottom: 1.5rem`
// durante a medição. Uma faixa de rolagem ingênua roubaria o olhar dele: o
// paciente olharia para chamar ajuda e a tela rolaria.
//
// A regra não é uma exceção por posição, que envelheceria no primeiro botão
// novo perto de uma borda. É: **só rola quando não há nada clicável sob o
// olhar**. Este arquivo prende isso.
// -----------------------------------------------------------------------------

let emitir: (s: GazeSample) => void = () => {};
let estadoEngine = 'tracking';
let calibrado = true;

const engineMock = {
  start: vi.fn(async () => {}),
  stop: vi.fn(),
  dispose: vi.fn(),
  subscribe: (cb: (s: GazeSample) => void) => {
    emitir = cb;
    return () => {};
  },
  onStateChange: () => () => {},
  onL2CSStatusChange: () => () => {},
  getState: () => estadoEngine,
  getSessionUptimeMs: () => 1000,
  getDiagnostics: () => null,
  setFilterPreset: vi.fn(),
  calibration: {
    isCalibrated: () => calibrado,
    onInvalidated: () => () => {},
    setCameraFovDeg: vi.fn(),
    setEyeDominance: vi.fn(),
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

const rolou = vi.fn();
vi.mock('../rolarSobOOlhar', () => ({
  rolarSobOOlhar: (...args: unknown[]) => rolou(...args),
}));

import { GazeProvider } from './GazeContext';

const ALTURA = 1000;

function amostra(over: Partial<GazeSample> = {}): GazeSample {
  return {
    x: 500,
    y: 500,
    timestamp: 0,
    hasFace: true,
    degraded: false,
    uncalibrated: false,
    eyeState: 'open',
    ...over,
  } as GazeSample;
}

/** Emite frames a 30 fps por `ms`. */
function olhar(ms: number, over: Partial<GazeSample> = {}) {
  const passo = 1000 / 30;
  act(() => {
    for (let t = 0; t <= ms; t += passo) {
      emitir(amostra({ timestamp: t, ...over }));
    }
  });
}

/** Monta com ou sem um alvo clicável sob o olhar. */
function montar(comAlvo: boolean) {
  render(
    <GazeProvider>
      <button data-testid="alvo" data-emergency="true">
        SOS
      </button>
    </GazeProvider>
  );
  const el = document.querySelector('[data-testid="alvo"]') as HTMLElement;
  // jsdom não faz layout: `elementFromPoint` é decidido aqui.
  document.elementFromPoint = vi.fn(() => (comAlvo ? el : document.body));
}

beforeEach(() => {
  estadoEngine = 'tracking';
  calibrado = true;
  emitir = () => {};
  rolou.mockClear();
  vi.clearAllMocks();
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: ALTURA });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => {
        throw new Error('sem câmera no teste');
      }),
    },
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a regra que protege a emergência', () => {
  it('NÃO rola quando há um botão sob o olhar, mesmo na borda', () => {
    // O caso literal: o botão de emergência fica em `top: 2rem`, dentro da
    // faixa de cima. Olhar nele é para acionar socorro, não para rolar.
    montar(true);
    olhar(ATRASO_MS + 500, { y: 20 });
    expect(rolou).not.toHaveBeenCalled();
  });

  it('NÃO rola com botão sob o olhar na borda de baixo', () => {
    // Onde o botão fica durante a medição.
    montar(true);
    olhar(ATRASO_MS + 500, { y: ALTURA - 20 });
    expect(rolou).not.toHaveBeenCalled();
  });

  it('rola em área vazia na mesma borda', () => {
    // A contraprova: a faixa funciona, e só o alvo clicável a desliga.
    montar(false);
    olhar(ATRASO_MS + 500, { y: 20 });
    expect(rolou).toHaveBeenCalled();
  });
});

describe('as guardas de estado', () => {
  it('não rola sem calibração', () => {
    // Sem calibração o ponto é o fallback do nariz. Mover a tela a partir dele
    // seria rolagem por acaso.
    montar(false);
    olhar(ATRASO_MS + 500, { y: 20, uncalibrated: true });
    expect(rolou).not.toHaveBeenCalled();
  });

  it('não rola em modo degradado', () => {
    montar(false);
    olhar(ATRASO_MS + 500, { y: 20, degraded: true });
    expect(rolou).not.toHaveBeenCalled();
  });

  it('não rola durante a calibração', () => {
    // A coleta seria corrompida por uma tela se mexendo.
    estadoEngine = 'calibrating';
    montar(false);
    olhar(ATRASO_MS + 500, { y: 20 });
    expect(rolou).not.toHaveBeenCalled();
  });
});

describe('a faixa', () => {
  it('não rola no meio da tela', () => {
    montar(false);
    olhar(ATRASO_MS + 500, { y: ALTURA / 2 });
    expect(rolou).not.toHaveBeenCalled();
  });

  it('não rola logo abaixo da faixa', () => {
    montar(false);
    olhar(ATRASO_MS + 500, { y: FAIXA_PX + 20 });
    expect(rolou).not.toHaveBeenCalled();
  });

  it('a borda de cima rola para cima', () => {
    montar(false);
    olhar(ATRASO_MS + 500, { y: 20 });
    const velocidades = rolou.mock.calls.map((c) => c[2] as number);
    expect(velocidades.every((v) => v < 0)).toBe(true);
  });

  it('a borda de baixo rola para baixo', () => {
    montar(false);
    olhar(ATRASO_MS + 500, { y: ALTURA - 20 });
    const velocidades = rolou.mock.calls.map((c) => c[2] as number);
    expect(velocidades.every((v) => v > 0)).toBe(true);
  });
});
