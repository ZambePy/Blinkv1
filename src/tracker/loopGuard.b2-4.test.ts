import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  runLoopBody,
  resetLoopErrorState,
  getLoopErrorCount,
  getConsecutiveLoopErrors,
  LOOP_ERROR_FATAL_THRESHOLD,
} from './loopGuard';

// -----------------------------------------------------------------------------
// B2.4 — `loopGuard` engole exceção por frame indefinidamente.
//
// O `catch` incrementa `loopErrorCount`, loga 1× a cada 2 s e reagenda. Não há
// limiar, não há transição de estado, e `getLoopErrorCount()` **não é consumido
// em produção** — só em teste.
//
// Cenário concreto: contexto WebGL perdido (troca de GPU, sleep/wake do
// notebook) faz `detectForVideo` lançar em TODO frame. O loop gira a 60 fps
// queimando CPU indefinidamente, o estado continua `'tracking'`, o cursor fica
// congelado, e a única evidência é uma linha de console a cada 2 s — que
// ninguém está olhando, porque o app roda em Electron em tela cheia.
//
// Para o público-alvo (ELA, uso possivelmente desacompanhado) isso é
// indistinguível de "o programa travou", e o paciente não tem como reiniciar.
//
// Além disso `loopErrorCount` é estado de módulo compartilhado entre
// instâncias e nunca era resetado em produção — B1.7 já ligou o reset no
// `resetSessionState()` do engine.
//
// Correção: após N erros CONSECUTIVOS, sinalizar ao chamador que a falha é
// persistente, para o engine transicionar para estado de erro visível e tentar
// reinicializar o `FaceLandmarker`.
// -----------------------------------------------------------------------------

beforeEach(() => {
  resetLoopErrorState();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('B2.4 — erros consecutivos são contados separadamente do total', () => {
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

describe('B2.4 — a falha persistente é sinalizada ao chamador', () => {
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

describe('B2.4 — o invariante de resiliência continua valendo', () => {
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
