import { describe, it, expect } from 'vitest';
import {
  stepDwell,
  createDwellState,
  DEFAULT_DWELL_CONFIG,
  type DwellState,
  type DwellTarget,
  type DwellSample,
} from './dwell';

// A tolerância `graceMs` do dwell vale tanto ao sair para o VAZIO quanto ao
// passar por um alvo VIZINHO: os dois caminhos registram `exitTs`, e a
// reentrada dentro da janela restaura o progresso. Num teclado ocular, com
// teclas vizinhas e jitter no cursor, a assimetria zeraria a barra o tempo todo.

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

function alvo(key: unknown): DwellTarget {
  return { key, customDwellMs: null, isEmergency: false, isRecovery: false, isDisabled: false };
}

/** Acumula progresso no alvo `key` por `ms`. */
function acumular(key: unknown, ms: number, inicio = 0, estado?: DwellState) {
  let state = estado ?? createDwellState();
  const passo = 1000 / 30;
  let t = inicio;
  for (; t <= inicio + ms; t += passo) {
    state = stepDwell(state, amostra({ timestamp: t }), alvo(key), CONFIG).state;
  }
  return { state, t };
}

describe('a tolerância vale também ao passar por um vizinho', () => {
  it('A → B (um frame) → A preserva o progresso de A', () => {
    // O caso do teclado ocular.
    const { state, t } = acumular('A', 1000);
    const progresso = state.elapsedMs;
    expect(progresso).toBeGreaterThan(900);

    const passo = 1000 / 30;
    // Um único frame sobre o vizinho B.
    const emB = stepDwell(state, amostra({ timestamp: t }), alvo('B'), CONFIG);
    // Volta para A dentro da janela de tolerância.
    const voltaA = stepDwell(emB.state, amostra({ timestamp: t + passo }), alvo('A'), CONFIG);

    expect(voltaA.state.elapsedMs).toBeCloseTo(progresso, 5);
  });

  it('sair para o vazio e voltar continua preservando', () => {
    const { state, t } = acumular('A', 1000);
    const progresso = state.elapsedMs;
    const passo = 1000 / 30;

    const vazio = stepDwell(state, amostra({ timestamp: t }), null, CONFIG);
    const volta = stepDwell(vazio.state, amostra({ timestamp: t + passo }), alvo('A'), CONFIG);

    expect(volta.state.elapsedMs).toBeCloseTo(progresso, 5);
  });

  it('os dois caminhos de saída são simétricos', () => {
    // Passar por um vizinho e passar pelo vazio precisam custar a mesma coisa.
    const passo = 1000 / 30;

    const a = acumular('A', 1000);
    const porVizinho = stepDwell(
      stepDwell(a.state, amostra({ timestamp: a.t }), alvo('B'), CONFIG).state,
      amostra({ timestamp: a.t + passo }), alvo('A'), CONFIG,
    );

    const c = acumular('A', 1000);
    const porVazio = stepDwell(
      stepDwell(c.state, amostra({ timestamp: c.t }), null, CONFIG).state,
      amostra({ timestamp: c.t + passo }), alvo('A'), CONFIG,
    );

    expect(porVizinho.state.elapsedMs).toBeCloseTo(porVazio.state.elapsedMs, 5);
  });

  it('além de graceMs, o progresso é perdido — pelos dois caminhos', () => {
    // A tolerância tem que continuar sendo uma tolerância, não um passe livre.
    const passo = 1000 / 30;
    const a = acumular('A', 1000);

    let s = stepDwell(a.state, amostra({ timestamp: a.t }), alvo('B'), CONFIG).state;
    // Fica em B bem além de `graceMs`.
    for (let dt = passo; dt < CONFIG.graceMs + 200; dt += passo) {
      s = stepDwell(s, amostra({ timestamp: a.t + dt }), alvo('B'), CONFIG).state;
    }
    const volta = stepDwell(s, amostra({ timestamp: a.t + CONFIG.graceMs + 300 }), alvo('A'), CONFIG);
    expect(volta.state.elapsedMs).toBe(0);
  });

  it('o progresso do vizinho é acumulado normalmente', () => {
    // Passar por B não pode congelar B: se o paciente decidir olhar para B, o
    // dwell de B tem que contar.
    const passo = 1000 / 30;
    const a = acumular('A', 500);
    const emB = acumular('B', 600, a.t, a.state);
    expect(emB.state.targetKey).toBe('B');
    expect(emB.state.elapsedMs).toBeGreaterThan(500);
  });

  it('A → B → C → A não ressuscita o progresso de A', () => {
    // A tolerância guarda UM alvo anterior. Depois de dois saltos, o progresso
    // de A já não é recuperável — e não deve ser, senão o dwell viraria uma
    // soma de olhares dispersos.
    const passo = 1000 / 30;
    const a = acumular('A', 1000);
    let s = stepDwell(a.state, amostra({ timestamp: a.t }), alvo('B'), CONFIG).state;
    s = stepDwell(s, amostra({ timestamp: a.t + passo }), alvo('C'), CONFIG).state;
    const volta = stepDwell(s, amostra({ timestamp: a.t + 2 * passo }), alvo('A'), CONFIG);
    expect(volta.state.elapsedMs).toBe(0);
  });
});
