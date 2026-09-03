import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createCalibrationClient, type TrainRequest } from './client';
import { aplicarConfigDoRegressor, snapshotConfigDoRegressor } from './regressorConfig';
import { RidgeRegressor } from '../ridge';

// -----------------------------------------------------------------------------
// B3.10 — O worker de calibração instancia `RidgeRegressor` sem tocar em
//         `axisScale`.
//
// `RidgeRegressor.axisScale` é um campo ESTÁTICO. Um Web Worker tem seu
// próprio registro de módulos, então lá dentro ele vale o default `{1, 1}` —
// **independentemente do que a main thread configurou**.
//
// O default reintroduz exatamente o bug de aspect-ratio que `axisScale` existe
// para corrigir: com a tela em 1920×1080, o erro em X e em Y entram no CV com
// o mesmo peso, quando 1 px de X vale menos que 1 px de Y em fração de tela.
// A nota no repositório mede o efeito em **3,16× de subponderação do eixo X**.
//
// Mesmo problema para `independentLambda`, `balanceTargets` e
// `lambdaOverride` — todos estáticos, todos default no worker.
//
// (`targetGroups` chega na request e é ignorado, mas isso é inofensivo:
// `RidgeRegressor.train` recomputa os grupos a partir dos próprios alvos com
// `targetGroupKey`, e a derivação é determinística. Fica registrado para quem
// ler a request e estranhar o campo.)
//
// E o caminho inteiro é MORTO: `createCalibrationClient` só é chamado em
// teste, apesar de `EXPERIMENT.calibrationWorker` valer `true` e o comentário
// da flag prometer "elimina o freeze de UI de 1-3s".
//
// B3.11 — `worker.onerror` não rejeita nada; `stop()` faz `pending.clear()`
//         descartando os `reject` sem chamá-los.
//
// Erro de carregamento do worker, ou `stop()` durante um treino, deixa a
// promise PENDENTE PARA SEMPRE. O `await` de quem chamou nunca retorna, e a
// UI fica travada na tela de "treinando" sem nada para o cuidador fazer.
// -----------------------------------------------------------------------------

class FakeWorker {
  static instances: FakeWorker[] = [];
  listeners = new Map<string, Set<(ev: unknown) => void>>();
  posted: unknown[] = [];
  terminated = false;

  constructor(_url: URL | string, _opts?: WorkerOptions) {
    FakeWorker.instances.push(this);
  }
  addEventListener(t: string, cb: (ev: unknown) => void) {
    if (!this.listeners.has(t)) this.listeners.set(t, new Set());
    this.listeners.get(t)!.add(cb);
  }
  removeEventListener(t: string, cb: (ev: unknown) => void) {
    this.listeners.get(t)?.delete(cb);
  }
  postMessage(m: unknown) { this.posted.push(m); }
  terminate() { this.terminated = true; }
  emitirMensagem(data: unknown) {
    for (const cb of this.listeners.get('message') ?? []) cb({ data });
  }
  emitirErro(message: string) {
    for (const cb of this.listeners.get('error') ?? []) cb({ message });
  }
}

const REQ: TrainRequest = {
  featuresLeft: [[1], [2]],
  featuresRight: [[1], [2]],
  targetsX: [0.1, 0.9],
  targetsY: [0.1, 0.9],
  targetGroups: ['a', 'b'],
  polynomialFeatures: false,
};

let originalWorker: unknown;

beforeEach(() => {
  FakeWorker.instances = [];
  originalWorker = (globalThis as Record<string, unknown>).Worker;
  (globalThis as Record<string, unknown>).Worker = FakeWorker;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  (globalThis as Record<string, unknown>).Worker = originalWorker;
  RidgeRegressor.axisScale = { x: 1, y: 1 };
  RidgeRegressor.independentLambda = true;
  RidgeRegressor.balanceTargets = false;
  RidgeRegressor.lambdaOverride = null;
  vi.restoreAllMocks();
});

describe('B3.10 — a configuração do regressor VIAJA para o worker', () => {
  it('a request carrega axisScale', async () => {
    RidgeRegressor.axisScale = { x: 1920, y: 1080 };
    const c = createCalibrationClient();
    await c.start();
    void c.train(REQ).catch(() => {});

    const msg = FakeWorker.instances.at(-1)!.posted.at(-1) as Record<string, unknown>;
    expect(msg.regressorConfig).toMatchObject({ axisScale: { x: 1920, y: 1080 } });
  });

  it('a request carrega as demais estáticas que mudam o treino', async () => {
    RidgeRegressor.independentLambda = false;
    RidgeRegressor.balanceTargets = true;
    RidgeRegressor.lambdaOverride = 0.5;
    const c = createCalibrationClient();
    await c.start();
    void c.train(REQ).catch(() => {});

    const msg = FakeWorker.instances.at(-1)!.posted.at(-1) as Record<string, unknown>;
    expect(msg.regressorConfig).toMatchObject({
      independentLambda: false,
      balanceTargets: true,
      lambdaOverride: 0.5,
    });
  });

  it('aplicar a config reproduz o estado do regressor', () => {
    // O que o worker faz ao receber a request. Sem isto, lá dentro valia o
    // default `{1,1}` e o CV escolhia λ com o eixo X subponderado 3,16×.
    RidgeRegressor.axisScale = { x: 1, y: 1 };
    aplicarConfigDoRegressor({
      axisScale: { x: 1920, y: 1080 },
      independentLambda: false,
      balanceTargets: true,
      lambdaOverride: 0.25,
    });
    expect(RidgeRegressor.axisScale).toEqual({ x: 1920, y: 1080 });
    expect(RidgeRegressor.independentLambda).toBe(false);
    expect(RidgeRegressor.balanceTargets).toBe(true);
    expect(RidgeRegressor.lambdaOverride).toBe(0.25);
  });

  it('snapshot e aplicação são inversos', () => {
    RidgeRegressor.axisScale = { x: 1280, y: 800 };
    RidgeRegressor.balanceTargets = true;
    const snap = snapshotConfigDoRegressor();

    RidgeRegressor.axisScale = { x: 1, y: 1 };
    RidgeRegressor.balanceTargets = false;
    aplicarConfigDoRegressor(snap);

    expect(RidgeRegressor.axisScale).toEqual({ x: 1280, y: 800 });
    expect(RidgeRegressor.balanceTargets).toBe(true);
  });
});

describe('B3.11 — nenhuma promise fica pendente para sempre', () => {
  it('erro do worker REJEITA os treinos em voo', async () => {
    // Antes: `worker.onerror` só fazia `console.error`. Um erro de
    // carregamento do módulo deixava o `await` do caller pendente
    // indefinidamente, e a UI travava em "treinando".
    const c = createCalibrationClient();
    await c.start();
    const p = c.train(REQ);
    FakeWorker.instances.at(-1)!.emitirErro('falha ao carregar o módulo');
    await expect(p).rejects.toThrow(/falha ao carregar/i);
  });

  it('stop() durante o treino REJEITA em vez de descartar', async () => {
    // Antes: `pending.clear()` jogava fora os `reject` sem chamá-los.
    const c = createCalibrationClient();
    await c.start();
    const p = c.train(REQ);
    c.stop();
    await expect(p).rejects.toThrow(/interrompid|stop/i);
  });

  it('múltiplos treinos em voo são todos rejeitados', async () => {
    const c = createCalibrationClient();
    await c.start();
    const ps = [c.train(REQ), c.train(REQ), c.train(REQ)];
    c.stop();
    const r = await Promise.allSettled(ps);
    expect(r.every((x) => x.status === 'rejected')).toBe(true);
  });

  it('um erro do worker não impede um start() posterior', async () => {
    const c = createCalibrationClient();
    await c.start();
    const p = c.train(REQ);
    FakeWorker.instances.at(-1)!.emitirErro('boom');
    await expect(p).rejects.toThrow();

    await c.start();
    expect(c.isReady()).toBe(true);
  });

  it('o caminho feliz continua resolvendo', async () => {
    // Regressão: rejeitar não pode ter quebrado o sucesso.
    const c = createCalibrationClient();
    await c.start();
    const p = c.train(REQ);
    const w = FakeWorker.instances.at(-1)!;
    const id = (w.posted.at(-1) as { id: number }).id;
    w.emitirMensagem({
      type: 'trained', id,
      scalerLeft: { mean: [0], std: [1] },
      scalerRight: { mean: [0], std: [1] },
      modelLeft: {}, modelRight: {}, trainTimeMs: 12,
    });
    await expect(p).resolves.toMatchObject({ trainTimeMs: 12 });
  });

  it('train() sem start() rejeita, não fica pendente', async () => {
    const c = createCalibrationClient();
    await expect(c.train(REQ)).rejects.toThrow();
  });
});
