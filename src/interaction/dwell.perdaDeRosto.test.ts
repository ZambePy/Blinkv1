import { describe, it, expect } from 'vitest';
import {
  stepDwell,
  createDwellState,
  DEFAULT_DWELL_CONFIG,
  type DwellState,
  type DwellTarget,
  type DwellSample,
} from './dwell';

// Perda de rosto no dwell: o ramo de pausa preserva `lastValidTs`, para que a
// idade da perda seja medida a partir da última amostra VÁLIDA. Assim a
// tolerância é de fato `lostResetMs` (500 ms) — nem 1 frame (se a pausa
// apagasse `lastValidTs`), nem infinita (rosto perdido por 5 min voltando com
// o progresso intacto).

const CONFIG = { ...DEFAULT_DWELL_CONFIG };

function amostra(over: Partial<DwellSample> = {}): DwellSample {
  return {
    timestamp: 0,
    hasFace: true,
    eyeState: 'open',
    degraded: false,
    uncalibrated: false,
    ...over,
  };
}

function alvo(key: unknown = 'botao'): DwellTarget {
  return { key, customDwellMs: null, isEmergency: false, isRecovery: false, isDisabled: false };
}

/** Acumula progresso no alvo por `ms`, a 30 fps. Devolve o estado. */
function acumular(ms: number): { state: DwellState; t: number } {
  let state = createDwellState();
  const passo = 1000 / 30;
  let t = 0;
  for (; t <= ms; t += passo) {
    state = stepDwell(state, amostra({ timestamp: t }), alvo(), CONFIG).state;
  }
  return { state, t };
}

describe('a tolerância de perda de rosto são 500 ms, não 1 frame', () => {
  it('dois frames seguidos sem rosto preservam o progresso', () => {
    // Um único frame de perda não exercita a idade da perda; o segundo sim.
    const { state, t } = acumular(1000);
    const progresso = state.elapsedMs;
    expect(progresso).toBeGreaterThan(900);

    const passo = 1000 / 30;
    let s = stepDwell(state, amostra({ timestamp: t, hasFace: false }), null, CONFIG).state;
    s = stepDwell(s, amostra({ timestamp: t + passo, hasFace: false }), null, CONFIG).state;

    expect(s.elapsedMs).toBeCloseTo(progresso, 5);
    expect(s.targetKey).not.toBeNull();
  });

  it('perda de 400 ms (abaixo de lostResetMs) preserva o progresso', () => {
    const { state, t } = acumular(1000);
    const progresso = state.elapsedMs;

    let s = state;
    const passo = 1000 / 30;
    for (let dt = 0; dt < 400; dt += passo) {
      s = stepDwell(s, amostra({ timestamp: t + dt, hasFace: false }), null, CONFIG).state;
    }

    expect(s.elapsedMs).toBeCloseTo(progresso, 5);
  });

  it('perda de 600 ms (acima de lostResetMs) zera o progresso', () => {
    // A outra direção da invariante: a pausa não pode ser indefinida.
    const { state, t } = acumular(1000);

    let s = state;
    const passo = 1000 / 30;
    for (let dt = 0; dt < 700; dt += passo) {
      s = stepDwell(s, amostra({ timestamp: t + dt, hasFace: false }), null, CONFIG).state;
    }

    expect(s.elapsedMs).toBe(0);
    expect(s.targetKey).toBeNull();
  });

  it('rosto perdido por 5 minutos não permite completar em 2 frames', () => {
    const { state, t } = acumular(1400);
    expect(state.elapsedMs).toBeGreaterThan(1300);

    let s = state;
    const passo = 1000 / 30;
    for (let dt = 0; dt < 5 * 60 * 1000; dt += 500) {
      s = stepDwell(s, amostra({ timestamp: t + dt, hasFace: false }), null, CONFIG).state;
    }

    // Ao reaparecer, o dwell tem que recomeçar do zero — nunca completar.
    // (Entrar num alvo emite `progress` com 0%; o que não pode acontecer é
    // `click`.)
    const volta = stepDwell(
      s,
      amostra({ timestamp: t + 5 * 60 * 1000 + passo }),
      alvo(),
      CONFIG,
    );
    expect(volta.effect.type).not.toBe('click');
    expect(volta.state.elapsedMs).toBe(0);

    // E o frame seguinte também não completa: o progresso de 1400 ms sumiu.
    const seguinte = stepDwell(
      volta.state,
      amostra({ timestamp: t + 5 * 60 * 1000 + 2 * passo }),
      alvo(),
      CONFIG,
    );
    expect(seguinte.effect.type).not.toBe('click');
  });
});

describe('retomada após pausa curta', () => {
  it('o progresso preservado continua de onde parou', () => {
    const { state, t } = acumular(1000);
    const progresso = state.elapsedMs;

    const passo = 1000 / 30;
    let s = state;
    for (let dt = 0; dt < 300; dt += passo) {
      s = stepDwell(s, amostra({ timestamp: t + dt, hasFace: false }), null, CONFIG).state;
    }

    // Volta o rosto. O primeiro frame só restabelece o encadeamento (não
    // acrescenta tempo), os seguintes voltam a acumular.
    let out = stepDwell(s, amostra({ timestamp: t + 300 }), alvo(), CONFIG);
    expect(out.state.elapsedMs).toBeCloseTo(progresso, 5);

    out = stepDwell(out.state, amostra({ timestamp: t + 300 + passo }), alvo(), CONFIG);
    expect(out.state.elapsedMs).toBeGreaterThan(progresso);
  });

  it('a lacuna da pausa não é contada como olhar', () => {
    // A razão de o ramo de pausa existir: o tempo com o rosto ausente não pode
    // avançar o dwell, senão fechar os olhos completaria a seleção.
    const { state, t } = acumular(1000);
    const progresso = state.elapsedMs;

    const passo = 1000 / 30;
    let s = state;
    for (let dt = 0; dt < 400; dt += passo) {
      s = stepDwell(s, amostra({ timestamp: t + dt, hasFace: false }), null, CONFIG).state;
    }
    const out = stepDwell(s, amostra({ timestamp: t + 400 }), alvo(), CONFIG);

    // Passaram 400 ms de relógio, mas o progresso não andou.
    expect(out.state.elapsedMs).toBeCloseTo(progresso, 5);
  });

  it('piscada longa preserva o progresso — decisão de design', () => {
    // Assimetria deliberada em relação à perda de rosto: com o rosto perdido
    // não se sabe para onde o paciente está olhando; com os olhos fechados ele
    // ESTÁ sobre o alvo, apenas piscando. Fadiga é a condição do público-alvo
    // (ELA). Se alguém "uniformizar" os dois ramos, falha aqui.
    const { state, t } = acumular(1000);
    const progresso = state.elapsedMs;

    let s = state;
    const passo = 1000 / 30;
    for (let dt = 0; dt < 3000; dt += passo) {
      s = stepDwell(s, amostra({ timestamp: t + dt, eyeState: 'closed' }), alvo(), CONFIG).state;
    }
    expect(s.elapsedMs).toBeCloseTo(progresso, 5);
  });

  it('piscada curta preserva o progresso', () => {
    const { state, t } = acumular(1000);
    const progresso = state.elapsedMs;

    let s = state;
    const passo = 1000 / 30;
    for (let dt = 0; dt < 200; dt += passo) {
      s = stepDwell(s, amostra({ timestamp: t + dt, eyeState: 'closed' }), alvo(), CONFIG).state;
    }
    expect(s.elapsedMs).toBeCloseTo(progresso, 5);
  });
});
