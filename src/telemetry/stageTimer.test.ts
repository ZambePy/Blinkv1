import { describe, it, expect } from 'vitest';
import { StageTimer, STAGE } from './stageTimer';

// Clock virtual: cada chamada a `advance(ms)` empurra o "relógio" adiante e
// devolve o novo valor. Substitui `performance.now()` no StageTimer para o
// teste ficar determinístico.
function makeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) { t += ms; return t; },
    set(ms: number) { t = ms; return t; },
  };
}

describe('StageTimer — semântica básica', () => {
  it('mede um par begin→end como duração exata do clock', () => {
    const clock = makeClock();
    const timer = new StageTimer({ now: clock.now });

    timer.begin('mediapipe');
    clock.advance(12.5);
    timer.end('mediapipe');

    const snap = timer.snapshot();
    expect(snap.mediapipe.count).toBe(1);
    expect(snap.mediapipe.lastMs).toBeCloseTo(12.5, 5);
    expect(snap.mediapipe.p50Ms).toBeCloseTo(12.5, 5);
    expect(snap.mediapipe.orphanEnds).toBe(0);
  });

  it('helper `time()` propaga exceções mas ainda registra a amostra', () => {
    const clock = makeClock();
    const timer = new StageTimer({ now: clock.now });

    expect(() => {
      timer.time('boom', () => { clock.advance(3); throw new Error('x'); });
    }).toThrow('x');

    const snap = timer.snapshot();
    expect(snap.boom.count).toBe(1);
    expect(snap.boom.lastMs).toBeCloseTo(3, 5);
  });

  it('record() aceita duração pré-medida', () => {
    const timer = new StageTimer();
    timer.record('external', 42);
    timer.record('external', 8);
    const snap = timer.snapshot();
    expect(snap.external.count).toBe(2);
    expect(snap.external.p50Ms).toBeCloseTo(25, 5);
  });

  it('record() rejeita valores negativos e não-finitos em silêncio', () => {
    const timer = new StageTimer();
    timer.record('bad', -1);
    timer.record('bad', Infinity);
    timer.record('bad', NaN);
    timer.record('bad', 5);
    const snap = timer.snapshot();
    expect(snap.bad.count).toBe(1);
    expect(snap.bad.lastMs).toBe(5);
  });
});

describe('StageTimer — comportamento de bordas', () => {
  it('end() sem begin() correspondente conta como órfão e não grava amostra', () => {
    const clock = makeClock();
    const timer = new StageTimer({ now: clock.now });
    timer.end('mediapipe');
    timer.end('mediapipe');

    const snap = timer.snapshot();
    expect(snap.mediapipe.count).toBe(0);
    expect(snap.mediapipe.orphanEnds).toBe(2);
  });

  it('begin() duplicado usa apenas o mais recente', () => {
    const clock = makeClock();
    const timer = new StageTimer({ now: clock.now });

    timer.begin('mediapipe');
    clock.advance(100);        // este begin será descartado
    timer.begin('mediapipe');  // reinicia o cronômetro
    clock.advance(5);
    timer.end('mediapipe');

    const snap = timer.snapshot();
    expect(snap.mediapipe.count).toBe(1);
    expect(snap.mediapipe.lastMs).toBeCloseTo(5, 5);
  });

  it('estágios independentes não se afetam', () => {
    const clock = makeClock();
    const timer = new StageTimer({ now: clock.now });

    timer.begin('a');
    clock.advance(10);
    timer.begin('b');
    clock.advance(20);
    timer.end('a');            // dt=30
    clock.advance(5);
    timer.end('b');            // dt=25

    const snap = timer.snapshot();
    expect(snap.a.lastMs).toBeCloseTo(30, 5);
    expect(snap.b.lastMs).toBeCloseTo(25, 5);
  });
});

describe('StageTimer — percentis', () => {
  it('p50 e p95 sobre 100 amostras conhecidas batem com o valor analítico', () => {
    const timer = new StageTimer({ windowSize: 100 });
    // Amostras 1..100 → p50 = 50.5, p95 = 95.05 (interp linear).
    for (let i = 1; i <= 100; i++) timer.record('s', i);
    const snap = timer.snapshot();
    expect(snap.s.count).toBe(100);
    expect(snap.s.p50Ms).toBeCloseTo(50.5, 3);
    expect(snap.s.p95Ms).toBeCloseTo(95.05, 3);
    expect(snap.s.totalSamples).toBe(100);
  });

  it('janela deslizante descarta amostras antigas quando cheia', () => {
    const timer = new StageTimer({ windowSize: 10 });
    // Enche com 10 zeros, depois grava 10 valores 100. A janela vira 100
    // inteiro, mesmo com 20 amostras totalizadas.
    for (let i = 0; i < 10; i++) timer.record('s', 0);
    for (let i = 0; i < 10; i++) timer.record('s', 100);
    const snap = timer.snapshot();
    expect(snap.s.count).toBe(10);
    expect(snap.s.totalSamples).toBe(20);
    expect(snap.s.p50Ms).toBe(100);
    expect(snap.s.p95Ms).toBe(100);
  });

  it('snapshot com janela vazia devolve zeros sem lançar', () => {
    const timer = new StageTimer();
    const snap = timer.snapshot();
    expect(snap).toEqual({});
  });
});

describe('StageTimer — invariantes de vida', () => {
  it('reset() zera contadores e a janela de todos os estágios', () => {
    const timer = new StageTimer({ windowSize: 10 });
    timer.record('a', 5);
    timer.record('b', 7);
    timer.reset();
    const snap = timer.snapshot();
    expect(snap).toEqual({});
  });

  it('nomes canônicos do STAGE são strings estáveis', () => {
    // Se algum dia renomearmos um estágio, este teste falha e força a
    // atualização dos consumidores externos ao mesmo tempo.
    expect(STAGE.mediapipe).toBe('mediapipe');
    expect(STAGE.l2csCrop).toBe('l2cs.crop');
    expect(STAGE.l2csRead).toBe('l2cs.read');
    expect(STAGE.features).toBe('features');
    expect(STAGE.quality).toBe('quality');
    expect(STAGE.predict).toBe('predict');
    expect(STAGE.filter).toBe('filter');
    expect(STAGE.loopTotal).toBe('loop.total');
  });
});
