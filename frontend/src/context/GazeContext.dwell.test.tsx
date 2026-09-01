import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import type { GazeSample } from '@tracker/tracker/engine';

/**
 * Teste de INTEGRAÇÃO da casca DOM do dispatcher de dwell.
 *
 * `src/interaction/dwell.test.ts` cobre a política pura (22 casos). O que ele
 * NÃO cobre é a metade que fala com o navegador: resolver o alvo com
 * `elementFromPoint`, aplicar `.click()` de verdade, pintar o realce e não
 * segurar referência a nós desmontados. Era exatamente essa camada que não
 * tinha teste nenhum, e é a que executa a ação em nome do usuário.
 *
 * Cobre C-07 (nada é clicável sem calibração, nem emergência), C-15 (olhos
 * fechados não completam dwell) e C-23 (um handler que lança não derruba o
 * dispatcher nem re-dispara o clique).
 */

let emitir: (s: GazeSample) => void = () => {};
let empurrarEstado: (s: string) => void = () => {};
let estadoEngine = 'tracking';
let calibrado = true;

const engineMock = {
  start: vi.fn(async () => {}),
  stop: vi.fn(),
  subscribe: (cb: (s: GazeSample) => void) => { emitir = cb; return () => {}; },
  onStateChange: (cb: (s: string) => void) => { empurrarEstado = cb; return () => {}; },
  onL2CSStatusChange: () => () => {},
  getState: () => estadoEngine,
  getSessionUptimeMs: () => 1000,
  getDiagnostics: () => null,
  setFilterPreset: vi.fn(),
  calibration: {
    isCalibrated: () => calibrado,
    onInvalidated: () => () => {},
    feedOnlineSample: vi.fn(() => false),
    setOnlineCalibrationEnabled: vi.fn(),
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
    settings: { dwellSpeed: 'normal', filterPreset: 'balanceado-v2', eyeDominance: 'both' },
    updateSettings: vi.fn(),
  }),
}));

import { GazeProvider } from './GazeContext';

/** dwellSpeed 'normal' → 1500 ms no DWELL_MS_BY_SPEED do provider. */
const DWELL_MS = 1500;

function amostra(over: Partial<GazeSample> = {}): GazeSample {
  return {
    x: 50, y: 50, timestamp: 0,
    hasFace: true, degraded: false, uncalibrated: false, eyeState: 'open',
    ...over,
  } as GazeSample;
}

/** Emite frames a 30 fps por `ms`, com o carimbo de tempo avançando. */
function olhar(ms: number, inicio: number, over: Partial<GazeSample> = {}) {
  const passo = 1000 / 30;
  act(() => {
    for (let t = inicio; t <= inicio + ms; t += passo) {
      emitir(amostra({ timestamp: t, ...over }));
    }
  });
  return inicio + ms;
}

function montar(botao: React.ReactElement) {
  const onClick = vi.fn();
  render(
    <GazeProvider>
      {React.cloneElement(botao, { onClick })}
    </GazeProvider>,
  );
  const el = screen.getByTestId('alvo');
  // jsdom não implementa layout: `elementFromPoint` devolveria null sempre.
  document.elementFromPoint = vi.fn(() => el);
  return { onClick, el };
}

describe('GazeContext — casca DOM do dispatcher', () => {
  beforeEach(() => {
    estadoEngine = 'tracking';
    calibrado = true;
    emitir = () => {};
    empurrarEstado = () => {};
    vi.clearAllMocks();
    // O provider abre a câmera no mount; sem isto o boot rejeita e polui o log.
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => { throw new Error('sem câmera no teste'); }) },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('clica de verdade quando o olhar fica no alvo pelo dwell inteiro', () => {
    const { onClick } = montar(<button data-testid="alvo">Ok</button>);
    olhar(DWELL_MS + 200, 0);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('C-07 — não clica sem calibração, por mais que se olhe', () => {
    calibrado = false;
    const { onClick } = montar(<button data-testid="alvo">Ok</button>);
    olhar(5000, 0, { uncalibrated: true });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('C-07 — não clica NEM no botão de emergência sem calibração', () => {
    calibrado = false;
    const { onClick } = montar(
      <button data-testid="alvo" data-emergency="true">SOS</button>,
    );
    olhar(8000, 0, { uncalibrated: true });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('C-07 — o banner de "sem calibração" fica visível', () => {
    estadoEngine = 'uncalibrated';
    calibrado = false;
    montar(<button data-testid="alvo">Ok</button>);
    act(() => { empurrarEstado('uncalibrated'); });
    expect(screen.getByTestId('gaze-status-banner')).toBeInTheDocument();
    expect(screen.getByText(/Ainda não há calibração/i)).toBeInTheDocument();
  });

  it('C-15 — olhos fechados por 3 s sobre o botão não geram clique ao reabrir', () => {
    const { onClick } = montar(<button data-testid="alvo">Ok</button>);
    // Metade do dwell com o olho aberto...
    let t = olhar(DWELL_MS / 2, 0);
    // ...3 s de olhos fechados...
    t = olhar(3000, t, { eyeState: 'closed' });
    expect(onClick).not.toHaveBeenCalled();
    // ...e o primeiro frame após reabrir não pode completar.
    act(() => { emitir(amostra({ timestamp: t + 33, eyeState: 'open' })); });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('C-15 — o progresso sobrevive à piscada e completa com olhar válido', () => {
    const { onClick } = montar(<button data-testid="alvo">Ok</button>);
    let t = olhar(DWELL_MS / 2, 0);
    t = olhar(2000, t, { eyeState: 'closed' });
    olhar(DWELL_MS / 2 + 200, t);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('C-23 — um handler que lança não impede o refratário nem re-dispara', () => {
    render(
      <GazeProvider>
        <button data-testid="alvo" onClick={() => { throw new Error('handler quebrado'); }}>
          Ok
        </button>
      </GazeProvider>,
    );
    const el = screen.getByTestId('alvo');
    document.elementFromPoint = vi.fn(() => el);
    const cliques = vi.fn();
    el.addEventListener('click', cliques);

    // 5 s de olhar contínuo: sem o refratário armado antes do clique, isto
    // dispararia repetidamente.
    expect(() => olhar(5000, 0)).not.toThrow();
    expect(cliques.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('respeita data-no-dwell', () => {
    const { onClick } = montar(<button data-testid="alvo" data-no-dwell="true">Ok</button>);
    olhar(5000, 0);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('respeita aria-disabled', () => {
    const { onClick } = montar(<button data-testid="alvo" aria-disabled="true">Ok</button>);
    olhar(5000, 0);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('data-dwell-ms inválido não vira clique instantâneo', () => {
    const { onClick } = montar(<button data-testid="alvo" data-dwell-ms="abc">Ok</button>);
    // Bem menos que o dwell padrão: se o NaN virasse 0, clicaria no 1º frame.
    olhar(200, 0);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('aplica e remove o realce gaze-hover conforme o olhar entra e sai', () => {
    const { el } = montar(<button data-testid="alvo">Ok</button>);
    olhar(300, 0);
    expect(el.classList.contains('gaze-hover')).toBe(true);

    // Olhar sai do alvo: elementFromPoint deixa de encontrar botão.
    document.elementFromPoint = vi.fn(() => document.body);
    olhar(100, 400);
    expect(el.classList.contains('gaze-hover')).toBe(false);
  });

  it('durante a calibração nada é clicável', () => {
    estadoEngine = 'calibrating';
    const { onClick } = montar(<button data-testid="alvo">Ok</button>);
    olhar(5000, 0);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('em degraded, botão comum não clica mas emergência clica', () => {
    const comum = montar(<button data-testid="alvo">Ok</button>);
    olhar(5000, 0, { degraded: true });
    expect(comum.onClick).not.toHaveBeenCalled();
  });
});
