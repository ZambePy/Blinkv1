import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Recuperação de falha fatal do loop.
 *
 * Depois de N exceções consecutivas (contexto WebGL perdido é a causa
 * dominante), o engine fecha o `FaceLandmarker`, o recria e rearma o rAF. O
 * ponto frágil é o retorno do `await`: `initMediaPipe()` pode RESOLVER sem ter
 * publicado o detector. Nesse caso o código seguia para `setState('tracking')`
 * e `requestAnimationFrame(loop)`, e `loop()` cai na guarda `!faceLandmarker` —
 * que sai SEM se reagendar.
 *
 * O resultado era o pior estado possível: a UI dizendo `tracking`, o cursor
 * congelado, e nenhuma mensagem. Para o público-alvo isso é indistinguível de
 * "o programa travou", e ele não tem como reiniciar sozinho. O contrato é: ou a
 * recuperação funciona de verdade, ou o estado fica em `'error'`.
 */

let detectorValido = true;
const closeSpy = vi.fn();
let detectDeveLancar = false;

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: async () => ({}) },
  FaceLandmarker: {
    createFromOptions: async () => {
      if (!detectorValido) return null;
      return {
        detectForVideo: () => {
          if (detectDeveLancar) throw new Error('contexto WebGL perdido');
          return { faceLandmarks: [], facialTransformationMatrixes: [] };
        },
        close: closeSpy,
      };
    },
  },
}));

import { createGazeEngine } from './engine';
import { LOOP_ERROR_FATAL_THRESHOLD } from './loopGuard';

/** <video> falso cujo `currentTime` anda: sem isso o loop pula o quadro. */
function videoFalso(): HTMLVideoElement {
  let t = 0;
  return {
    get currentTime() { return (t += 0.033); },
    videoWidth: 1280,
    videoHeight: 720,
    paused: false,
  } as unknown as HTMLVideoElement;
}

let rafCallbacks: FrameRequestCallback[] = [];
let rafIdSeq = 0;

beforeEach(() => {
  detectorValido = true;
  detectDeveLancar = false;
  closeSpy.mockClear();
  rafCallbacks = [];
  rafIdSeq = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafCallbacks.push(cb);
    return ++rafIdSeq;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Roda `n` frames do loop, drenando a fila de rAF. */
function rodarFrames(n: number) {
  for (let i = 0; i < n; i++) {
    const cb = rafCallbacks.shift();
    if (!cb) return;
    cb(performance.now());
  }
}

describe('engine — recuperação de falha fatal do loop', { timeout: 20_000 }, () => {
  it('vai para "error" quando a reinicialização não publica o detector', async () => {
    const engine = createGazeEngine('http://test/mediapipe');
    await engine.start(videoFalso());
    expect(engine.getState()).toBe('tracking');

    // A reinicialização vai devolver um detector inválido.
    detectorValido = false;
    detectDeveLancar = true;
    rodarFrames(LOOP_ERROR_FATAL_THRESHOLD + 2);

    // Drena as microtasks da recuperação (initMediaPipe é async).
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));

    // O loop está morto (a guarda `!faceLandmarker` sai sem reagendar). O
    // estado TEM de dizer isso — antes ficava em 'tracking'.
    expect(engine.getState()).toBe('error');
  });

  it('volta a rastrear quando a reinicialização dá certo', async () => {
    const engine = createGazeEngine('http://test/mediapipe');
    await engine.start(videoFalso());

    detectDeveLancar = true;
    rodarFrames(LOOP_ERROR_FATAL_THRESHOLD + 2);
    // O detector recriado funciona de novo.
    detectDeveLancar = false;

    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));

    expect(engine.getState()).toBe('tracking');
    // E o rAF foi rearmado: sem isto o estado seria uma mentira.
    expect(rafCallbacks.length).toBeGreaterThan(0);
  });
});
