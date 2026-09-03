import { describe, it, expect, vi } from 'vitest';
import {
  detectCaptureEnvironment,
  planCaptureStrategy,
  createCaptureLoop,
  type CaptureEnvironment,
} from './captureWorker';
import { FrameRing } from './frameRing';

// P4.2 — captura fora do thread principal.
//
// ⚠️ LIMITE DO QUE ESTE ARQUIVO PROVA. `MediaStreamTrackProcessor` não existe em
// jsdom, e um Worker de verdade com transferables também não. O que é testável
// aqui — e é o que decide o comportamento em campo — são duas coisas:
//
//   1. a ESCOLHA de estratégia a partir do que o ambiente expõe, incluindo a
//      degradação para o thread principal quando o navegador não colabora;
//   2. o LAÇO de captura em si, com a fonte injetada: que ele nunca espera o
//      consumidor, que ele libera os frames evictados, e que ele para.
//
// O aceite do plano ("T0.5 mostra o estágio de captura caindo para ~0 no thread
// principal") é medição de runtime real e NÃO é afirmado aqui. Ver o log de
// execução do Sprint 4.

const ambienteCompleto: CaptureEnvironment = {
  hasWorker: true,
  hasMediaStreamTrackProcessor: true,
  hasRequestVideoFrameCallback: true,
  hasOffscreenCanvas: true,
};

describe('detectCaptureEnvironment', () => {
  it('lê o escopo injetado em vez de tocar no global', () => {
    const env = detectCaptureEnvironment({
      Worker: class {},
      MediaStreamTrackProcessor: class {},
      OffscreenCanvas: class {},
      HTMLVideoElement: { prototype: { requestVideoFrameCallback: () => 0 } },
    });
    expect(env).toEqual(ambienteCompleto);
  });

  it('escopo vazio devolve tudo false — nada de assumir suporte', () => {
    expect(detectCaptureEnvironment({})).toEqual({
      hasWorker: false,
      hasMediaStreamTrackProcessor: false,
      hasRequestVideoFrameCallback: false,
      hasOffscreenCanvas: false,
    });
  });

  it('escopo nulo não lança — o módulo é importado em Node no harness', () => {
    expect(() => detectCaptureEnvironment(null)).not.toThrow();
    expect(detectCaptureEnvironment(undefined).hasWorker).toBe(false);
  });
});

describe('planCaptureStrategy', () => {
  it('ambiente completo: captura no worker, fora do thread principal', () => {
    const p = planCaptureStrategy(ambienteCompleto);
    expect(p.strategy).toBe('worker-track-processor');
    expect(p.offMainThread).toBe(true);
    expect(p.reasons.join(' ')).toContain('MediaStreamTrackProcessor');
  });

  it('sem MediaStreamTrackProcessor cai para rVFC no thread principal', () => {
    const p = planCaptureStrategy({ ...ambienteCompleto, hasMediaStreamTrackProcessor: false });
    expect(p.strategy).toBe('main-rvfc');
    expect(p.offMainThread).toBe(false);
  });

  it('sem Worker não adianta ter MediaStreamTrackProcessor', () => {
    const p = planCaptureStrategy({ ...ambienteCompleto, hasWorker: false });
    expect(p.strategy).toBe('main-rvfc');
    expect(p.offMainThread).toBe(false);
  });

  it('sem rVFC sobra o rAF — o comportamento de hoje', () => {
    const p = planCaptureStrategy({
      hasWorker: false,
      hasMediaStreamTrackProcessor: false,
      hasRequestVideoFrameCallback: false,
      hasOffscreenCanvas: false,
    });
    expect(p.strategy).toBe('main-raf');
    expect(p.offMainThread).toBe(false);
    // O rAF acorda na cadência de COMPOSIÇÃO, não na de captura: a 30 fps de
    // câmera com tela a 60 Hz, metade dos despertares não tem frame novo, e um
    // frame novo pode esperar até 16 ms para ser notado. É a estratégia pior, e
    // o plano tem que dizer isso em vez de tratar as três como equivalentes.
    expect(p.reasons.join(' ')).toContain('jitter');
  });
});

// -----------------------------------------------------------------------------
// createCaptureLoop — fonte injetada, sem browser.
// -----------------------------------------------------------------------------

interface FrameFalso {
  id: number;
  closed: boolean;
  close(): void;
}

function frameFalso(id: number): FrameFalso {
  const f: FrameFalso = { id, closed: false, close() { f.closed = true; } };
  return f;
}

/** Fonte que entrega `n` frames imediatamente, sem esperar consumo. */
async function* fonte(n: number, criados: FrameFalso[]): AsyncGenerator<{ frame: FrameFalso; tCaptureMs: number }> {
  for (let i = 0; i < n; i++) {
    const f = frameFalso(i);
    criados.push(f);
    yield { frame: f, tCaptureMs: i * (1000 / 30) };
  }
}

describe('createCaptureLoop', () => {
  it('empurra os frames para o ring sem esperar o consumidor', async () => {
    const criados: FrameFalso[] = [];
    const ring = new FrameRing<FrameFalso>(3);
    const loop = createCaptureLoop({ source: fonte(10, criados), ring });
    await loop.run();
    const s = ring.stats();
    expect(s.pushed).toBe(10);
    expect(s.droppedOverflow).toBe(7); // ninguém consumiu: 7 transbordaram
    expect(loop.stats().framesCaptured).toBe(10);
    // O laço DRENA na saída — ver o teste seguinte.
    expect(s.occupancy).toBe(0);
  });

  it('fecha o frame evictado NA HORA — sem isso o WebCodecs trava depois de alguns', async () => {
    const criados: FrameFalso[] = [];
    const ring = new FrameRing<FrameFalso>(3);
    // A verificação tem que acontecer DURANTE o laço: no fim, a drenagem fecha
    // todo mundo e a asserção não distinguiria mais eviction de drenagem.
    const fechadosNoMomento: number[] = [];
    await createCaptureLoop({
      source: fonte(10, criados),
      ring,
      onFrame: () => { fechadosNoMomento.push(criados.filter((f) => f.closed).length); },
    }).run();
    // Do 4º frame em diante, cada chegada evicta um: 0,0,0,1,2,3,4,5,6,7.
    expect(fechadosNoMomento).toEqual([0, 0, 0, 1, 2, 3, 4, 5, 6, 7]);
    // E o que estava dentro do ring quando a fonte acabou também é fechado: a
    // captura terminou, ninguém vai processar aqueles frames, e mantê-los vivos
    // estanca a pipeline de decode do navegador.
    expect(criados.every((f) => f.closed)).toBe(true);
    expect(ring.stats().occupancy).toBe(0);
  });

  it('stop() interrompe antes de drenar a fonte e fecha o que sobrou', async () => {
    const criados: FrameFalso[] = [];
    const ring = new FrameRing<FrameFalso>(3);
    const loop = createCaptureLoop({
      source: fonte(100, criados),
      ring,
      onFrame: () => { if (criados.length >= 5) loop.stop(); },
    });
    await loop.run();
    expect(loop.stats().framesCaptured).toBeLessThan(100);
    expect(loop.stats().stopped).toBe(true);
    // Depois do stop nenhum frame pode ficar preso e vivo no ring.
    expect(ring.stats().occupancy).toBe(0);
    expect(criados.every((f) => f.closed)).toBe(true);
  });

  it('erro na fonte não derruba o chamador: é registrado e o laço encerra', async () => {
    const ring = new FrameRing<FrameFalso>(3);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    async function* fonteQueFalha(): AsyncGenerator<{ frame: FrameFalso; tCaptureMs: number }> {
      yield { frame: frameFalso(0), tCaptureMs: 0 };
      throw new Error('track ended');
    }
    const loop = createCaptureLoop({ source: fonteQueFalha(), ring });
    await expect(loop.run()).resolves.toBeUndefined();
    expect(loop.stats().errors).toBe(1);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('o consumidor recebe sempre o frame mais recente enquanto o laço roda', async () => {
    const criados: FrameFalso[] = [];
    const ring = new FrameRing<FrameFalso>(3);
    const recebidos: number[] = [];
    let n = 0;
    const loop = createCaptureLoop({
      source: fonte(9, criados),
      ring,
      // Consome 1 a cada 3 capturados, imitando o L2CS a 10 Hz.
      onFrame: () => {
        if (++n % 3 === 0) {
          const f = ring.takeLatest();
          if (f) recebidos.push(f.payload.id);
        }
      },
    });
    await loop.run();
    expect(recebidos).toEqual([2, 5, 8]);
  });
});
