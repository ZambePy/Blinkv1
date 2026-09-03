import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// -----------------------------------------------------------------------------
// B1.6 — `engine.start()` é async: `stop()` durante o `await` cria loop zumbi.
//
//   async start(video) {
//     if (running) return;          // guarda avaliada ANTES do await
//     ...
//     if (!faceLandmarker) await initMediaPipe();   // segundos: WASM + .task
//     running = true;               // só aqui
//     rafHandle = requestAnimationFrame(loop);
//   }
//
// `GazeContext.tsx` faz `await engine.start(video)`; o cleanup do `useEffect`
// chama `engine.stop()` e depois para as tracks e remove o <video>. Em
// desmontagem rápida, StrictMode ou troca de rota durante o download do
// MediaPipe: `stop()` roda com `running === false` (no-op), o `await` resolve,
// `running = true`, e o rAF arranca SOBRE UM <video> REMOVIDO com as tracks
// encerradas. O loop nunca mais para.
//
// Como `calibration`, `accuracy`, `recorder` e `_blinkDetector` são singletons
// de módulo, o engine zumbi segue chamando `calibration.feedRawData` enquanto o
// engine novo alimenta os mesmos singletons → amostras duplicadas e
// intercaladas na coleta, `frameIdx` duplicado na telemetria, CPU/GPU dobrados.
//
// Variante: dois `start()` concorrentes passam os dois pela guarda e criam
// dois loops no mesmo engine.
//
// B1.7 — `stop()` não libera nada e não zera estado de sessão.
//
// Não liberado: `faceLandmarker` nunca recebe `.close()` (heap WASM + contexto
// GPU); `l2csClient.stop()` nunca é chamado em lugar nenhum; `cropCtx` e o
// canvas do EyeQualityAnalyzer ficam retidos.
//
// Não zerado: `lastVideoTime`, `framesSeen/WithFace/Emitted`, `lastStatMs`,
// `lastEmittedX/Y`, `mapGazeNullSinceMs`, `bufferX/bufferY`, `oneEuro`,
// `brightnessHistory`, `l2csFrames*`, `latestFeaturesLeft/Right`…
// -----------------------------------------------------------------------------

// Controle do handshake do MediaPipe: o teste decide QUANDO a inicialização
// termina, que é o que permite exercitar a janela entre `start()` e o `await`.
let resolverVision: (() => void) | null = null;
let visionPromise: Promise<unknown>;
const closeSpy = vi.fn();

function novoHandshake() {
  visionPromise = new Promise((res) => { resolverVision = () => res({}); });
}

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: {
    forVisionTasks: () => visionPromise,
  },
  FaceLandmarker: {
    createFromOptions: async () => ({
      detectForVideo: () => ({ faceLandmarks: [], facialTransformationMatrixes: [] }),
      close: closeSpy,
    }),
  },
}));

import { createGazeEngine } from './engine';

/** <video> falso: o engine só lê `currentTime`, `videoWidth/Height`, `paused`. */
function videoFalso(): HTMLVideoElement {
  return {
    currentTime: 0,
    videoWidth: 1280,
    videoHeight: 720,
    paused: false,
  } as unknown as HTMLVideoElement;
}

let rafCallbacks: FrameRequestCallback[] = [];
let rafIdSeq = 0;
let rafCancelled: number[] = [];

beforeEach(() => {
  novoHandshake();
  closeSpy.mockClear();
  rafCallbacks = [];
  rafIdSeq = 0;
  rafCancelled = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafCallbacks.push(cb);
    return ++rafIdSeq;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { rafCancelled.push(id); });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Timeout folgado — o racional completo está em `vitest.config.ts`.
//
// Estes casos orquestram promessas (o handshake do MediaPipe mockado) e
// dependem de o event loop drenar microtasks. Sob a suíte inteira em workers
// paralelos, a contenção de CPU já estourou o default de 5 s uma vez. O
// comportamento sob teste é síncrono e determinístico; o que varia é o tempo
// de máquina — isolado, o arquivo custa 2,05 s (medido).
describe('B1.6 — stop() durante o await não pode deixar loop zumbi', { timeout: 20_000 }, () => {
  it('stop() antes do MediaPipe resolver ⇒ nenhum rAF é agendado', async () => {
    const engine = createGazeEngine('http://test/mediapipe');

    const p = engine.start(videoFalso());
    // Estamos DENTRO da janela: o await de initMediaPipe ainda não resolveu.
    expect(rafCallbacks).toHaveLength(0);

    engine.stop();

    resolverVision!();
    await p;

    // ANTES da correção: `running = true` executava após o await e o rAF
    // arrancava sobre um <video> já removido, num loop que nunca mais para.
    expect(rafCallbacks).toHaveLength(0);
  });

  it('stop() durante o await deixa o engine em estado parado', async () => {
    const engine = createGazeEngine('http://test/mediapipe');
    const p = engine.start(videoFalso());
    engine.stop();
    resolverVision!();
    await p;
    expect(engine.getState()).toBe('idle');
  });

  it('dois start() concorrentes criam apenas UM loop', async () => {
    const engine = createGazeEngine('http://test/mediapipe');

    const p1 = engine.start(videoFalso());
    const p2 = engine.start(videoFalso());

    resolverVision!();
    await Promise.all([p1, p2]);

    // A guarda `if (running) return` é avaliada antes do await, então as duas
    // chamadas passavam e agendavam dois rAF no mesmo engine — dobrando CPU e
    // duplicando as amostras entregues aos singletons de calibração.
    expect(rafCallbacks).toHaveLength(1);
  });

  it('start() após um stop() cancelado funciona normalmente', async () => {
    // O ciclo abortado não pode envenenar a próxima tentativa: se o token de
    // geração não for renovado, o engine ficaria permanentemente incapaz de
    // iniciar — trocando um bug por outro pior.
    const engine = createGazeEngine('http://test/mediapipe');

    const p1 = engine.start(videoFalso());
    engine.stop();
    resolverVision!();
    await p1;
    expect(rafCallbacks).toHaveLength(0);

    novoHandshake();
    const p2 = engine.start(videoFalso());
    resolverVision!();
    await p2;

    expect(rafCallbacks).toHaveLength(1);
    expect(engine.getState()).toBe('tracking');
  });
});

describe('B1.7 — stop() libera recursos e zera estado de sessão', { timeout: 30_000 }, () => {
  it('dispose() existe e fecha o FaceLandmarker', async () => {
    const engine = createGazeEngine('http://test/mediapipe');
    const p = engine.start(videoFalso());
    resolverVision!();
    await p;

    engine.dispose();

    // O FaceLandmarker segura heap WASM + contexto GPU. Sem `.close()` cada
    // mount vaza; dois mounts = dois contextos vivos.
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('dispose() é idempotente', async () => {
    const engine = createGazeEngine('http://test/mediapipe');
    const p = engine.start(videoFalso());
    resolverVision!();
    await p;

    engine.dispose();
    engine.dispose();

    // Chamar duas vezes não pode lançar nem fechar duas vezes — o cleanup do
    // React pode disparar mais de uma vez em StrictMode.
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('a segunda sessão começa com contadores zerados', async () => {
    const engine = createGazeEngine('http://test/mediapipe');

    const p1 = engine.start(videoFalso());
    resolverVision!();
    await p1;
    // Roda alguns frames para sujar os contadores.
    for (let i = 0; i < 3 && rafCallbacks.length > 0; i++) {
      const cb = rafCallbacks.shift()!;
      cb(performance.now());
    }
    engine.stop();

    novoHandshake();
    const p2 = engine.start(videoFalso());
    resolverVision!();
    await p2;

    const d = engine.getDiagnostics();
    // `framesSeen` alimentava `frameIdx` da telemetria: sem reset, uma
    // gravação iniciada na segunda sessão começava com índices da primeira.
    expect(d.l2cs.pendingCount).toBe(0);
    expect(d.brightnessHistory).toHaveLength(0);
    expect(d.features.dims).toBe(0);
  });

  it('a segunda sessão NÃO nasce degradada', async () => {
    // O modo de falha mais concreto de B1.7: se a sessão 1 terminou com
    // `mapGazeNullSinceMs = T`, o primeiro frame da sessão 2 com mapGaze nulo
    // comparava `now - T >> 500` e entrava em `degraded` IMEDIATAMENTE, sem a
    // janela de 500 ms. A UI bloqueava o dwell não-emergencial sem motivo.
    const engine = createGazeEngine('http://test/mediapipe');

    const p1 = engine.start(videoFalso());
    resolverVision!();
    await p1;
    engine.stop();

    novoHandshake();
    const p2 = engine.start(videoFalso());
    resolverVision!();
    await p2;

    expect(engine.getState()).not.toBe('degraded');
  });

  it('stop() cancela o rAF pendente', async () => {
    const engine = createGazeEngine('http://test/mediapipe');
    const p = engine.start(videoFalso());
    resolverVision!();
    await p;

    expect(rafCallbacks).toHaveLength(1);
    engine.stop();
    expect(rafCancelled).toHaveLength(1);
  });
});
