import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  runLoopBody,
  resetLoopErrorState,
  getLoopErrorCount,
  getConsecutiveLoopErrors,
  LOOP_ERROR_FATAL_THRESHOLD,
} from './loopGuard';

// `loopGuard` não pode engolir exceções por frame para sempre (contexto WebGL
// perdido faz `detectForVideo` lançar em todo frame; o cursor congela e o
// paciente não tem como reiniciar). Após N erros CONSECUTIVOS a falha é
// sinalizada ao chamador, que troca de estado e reinicializa o MediaPipe.

beforeEach(() => {
  resetLoopErrorState();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('erros consecutivos são contados separadamente do total', () => {
  it('um frame bem-sucedido zera a contagem CONSECUTIVA', () => {
    // A distinção que faltava: 100 erros espalhados ao longo de uma hora não
    // são a mesma coisa que 100 erros seguidos. O primeiro é ruído tolerável;
    // o segundo é o WebGL morto.
    const schedule = vi.fn();
    runLoopBody(() => { throw new Error('a'); }, schedule);
    runLoopBody(() => { throw new Error('b'); }, schedule);
    expect(getConsecutiveLoopErrors()).toBe(2);

    runLoopBody(() => { /* ok */ }, schedule);
    expect(getConsecutiveLoopErrors()).toBe(0);
    // Mas o total continua contando, para o diagnóstico.
    expect(getLoopErrorCount()).toBe(2);
  });

  it('o total nunca é zerado por um frame bem-sucedido', () => {
    const schedule = vi.fn();
    for (let i = 0; i < 5; i++) runLoopBody(() => { throw new Error('x'); }, schedule);
    runLoopBody(() => {}, schedule);
    expect(getLoopErrorCount()).toBe(5);
  });
});

describe('a falha persistente é sinalizada ao chamador', () => {
  it('runLoopBody devolve `fatal: true` ao cruzar o limiar', () => {
    const schedule = vi.fn();
    let ultimo: ReturnType<typeof runLoopBody> | undefined;
    for (let i = 0; i < LOOP_ERROR_FATAL_THRESHOLD; i++) {
      ultimo = runLoopBody(() => { throw new Error('webgl perdido'); }, schedule);
    }
    expect(ultimo?.fatal).toBe(true);
  });

  it('antes do limiar, `fatal` é false', () => {
    const schedule = vi.fn();
    let ultimo: ReturnType<typeof runLoopBody> | undefined;
    for (let i = 0; i < LOOP_ERROR_FATAL_THRESHOLD - 1; i++) {
      ultimo = runLoopBody(() => { throw new Error('x'); }, schedule);
    }
    expect(ultimo?.fatal).toBe(false);
  });

  it('`fatal` é sinalizado UMA vez, não em todo frame subsequente', () => {
    // Senão o engine tentaria reinicializar o FaceLandmarker 60×/s, o que é
    // pior que o problema original.
    const schedule = vi.fn();
    let vezes = 0;
    for (let i = 0; i < LOOP_ERROR_FATAL_THRESHOLD * 5; i++) {
      if (runLoopBody(() => { throw new Error('x'); }, schedule).fatal) vezes++;
    }
    expect(vezes).toBe(1);
  });

  it('após recuperar, um novo surto pode voltar a sinalizar', () => {
    const schedule = vi.fn();
    for (let i = 0; i < LOOP_ERROR_FATAL_THRESHOLD; i++) {
      runLoopBody(() => { throw new Error('x'); }, schedule);
    }
    runLoopBody(() => {}, schedule);   // recuperou

    let sinalizou = false;
    for (let i = 0; i < LOOP_ERROR_FATAL_THRESHOLD; i++) {
      if (runLoopBody(() => { throw new Error('y'); }, schedule).fatal) sinalizou = true;
    }
    expect(sinalizou).toBe(true);
  });

  it('o limiar é alto o bastante para não disparar em ruído isolado', () => {
    // Uma exceção esporádica (um subscriber React que lançou uma vez) não
    // pode derrubar o rastreamento inteiro.
    expect(LOOP_ERROR_FATAL_THRESHOLD).toBeGreaterThanOrEqual(10);
  });
});

describe('o invariante de resiliência continua valendo', () => {
  it('o reagendamento acontece mesmo no frame fatal', () => {
    // Regressão do comportamento que loopGuard existe para garantir: o loop
    // NUNCA pode morrer por conta de uma exceção. Quem decide parar é o
    // engine, com estado visível — não um `return` esquecido aqui.
    const schedule = vi.fn();
    for (let i = 0; i < LOOP_ERROR_FATAL_THRESHOLD; i++) {
      runLoopBody(() => { throw new Error('x'); }, schedule);
    }
    expect(schedule).toHaveBeenCalledTimes(LOOP_ERROR_FATAL_THRESHOLD);
  });

  it('resetLoopErrorState zera os dois contadores', () => {
    const schedule = vi.fn();
    for (let i = 0; i < 5; i++) runLoopBody(() => { throw new Error('x'); }, schedule);
    resetLoopErrorState();
    expect(getLoopErrorCount()).toBe(0);
    expect(getConsecutiveLoopErrors()).toBe(0);
  });
});
