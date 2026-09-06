import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createL2CSClient, DEFAULT_STALE_MS } from './client';
import type { L2CSWorkerRequest, L2CSWorkerResponse } from './types';

// Staleness do L2CS: o timestamp de um resultado é a hora da CAPTURA (da
// submissão), não a da chegada da resposta. Carimbar a chegada faria
// `getLatestGaze` nunca invalidar um gaze atrasado — o intervalo entre
// chegadas continua regular mesmo com dezenas de segundos de atraso acumulado.

class FakeWorker {
  static instances: FakeWorker[] = [];
  listeners = new Map<string, Set<(ev: unknown) => void>>();
  posted: L2CSWorkerRequest[] = [];

  constructor(_url: URL | string, _opts?: WorkerOptions) {
    FakeWorker.instances.push(this);
  }
  addEventListener(type: string, cb: (ev: unknown) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(cb);
  }
  removeEventListener(type: string, cb: (ev: unknown) => void): void {
    this.listeners.get(type)?.delete(cb);
  }
  postMessage(msg: L2CSWorkerRequest): void {
    this.posted.push(msg);
    if (msg.type === 'init') {
      queueMicrotask(() => this.deliver({
        type: 'ready',
        meta: {
          dataset: 'gaze360', outputBins: 90, binWidth: 4, binOffset: -180,
          inputSize: 448, inputTensorName: 'input',
          outputTensorNames: { yaw: 'yaw', pitch: 'pitch' },
        },
      }));
    }
  }
  terminate(): void {}
  deliver(data: L2CSWorkerResponse): void {
    for (const cb of this.listeners.get('message') ?? []) cb({ data });
  }
  ultimoInferId(): number {
    const infers = this.posted.filter((m) => m.type === 'infer');
    const ultimo = infers.at(-1);
    return ultimo && ultimo.type === 'infer' ? ultimo.id : -1;
  }
}

function tensor(): Float32Array {
  return new Float32Array(3 * 448 * 448);
}

let originalWorker: unknown;
let agora = 0;

beforeEach(() => {
  FakeWorker.instances = [];
  agora = 0;
  originalWorker = (globalThis as Record<string, unknown>).Worker;
  (globalThis as Record<string, unknown>).Worker = FakeWorker;
  vi.spyOn(performance, 'now').mockImplementation(() => agora);
});

afterEach(() => {
  (globalThis as Record<string, unknown>).Worker = originalWorker;
  vi.restoreAllMocks();
});

async function clientePronto(opts: Parameters<typeof createL2CSClient>[0] = {}) {
  const client = createL2CSClient({ cadenceMs: 0, ...opts });
  await client.start();
  return { client, worker: FakeWorker.instances.at(-1)! };
}

describe('o carimbo é a hora da captura', () => {
  it('o timestamp do resultado é o instante da submissão, não o da chegada', async () => {
    const { client, worker } = await clientePronto();

    agora = 1000;
    client.submitTensor(tensor());   // captura em t=1000
    const id = worker.ultimoInferId();

    agora = 1500;                    // inferência levou 500 ms
    worker.deliver({ type: 'result', id, yaw: 0.2, pitch: -0.1, confidence: 0.8, inferenceMs: 500 });

    // Com carimbo de chegada seria 1500 e o gaze pareceria recém-medido.
    const g = client.getLatestGaze(1500);
    expect(g.timestamp).toBe(1000);
  });

  it('a idade do gaze é medida a partir da captura', async () => {
    const { client, worker } = await clientePronto({ staleMs: 400 });

    agora = 0;
    client.submitTensor(tensor());
    const id = worker.ultimoInferId();

    agora = 500;
    worker.deliver({ type: 'result', id, yaw: 0.2, pitch: -0.1, confidence: 0.8, inferenceMs: 500 });

    // O resultado descreve um frame de t=0. Com staleMs=400, ele JÁ nasce
    // velho: consultado em t=500, tem 500 ms de idade.
    const g = client.getLatestGaze(500);
    expect(g.valid).toBe(false);
  });

  it('uma inferência rápida continua valendo normalmente', async () => {
    const { client, worker } = await clientePronto({ staleMs: 400 });

    agora = 0;
    client.submitTensor(tensor());
    const id = worker.ultimoInferId();

    agora = 80;
    worker.deliver({ type: 'result', id, yaw: 0.2, pitch: -0.1, confidence: 0.8, inferenceMs: 80 });

    const g = client.getLatestGaze(100);
    expect(g.valid).toBe(true);
    expect(g.timestamp).toBe(0);
    expect(g.yaw).toBeCloseTo(0.2, 6);
  });
});

describe('dessincronização com chegadas regulares', () => {
  it('resultados chegando em cadência regular não mascaram atraso acumulado', () => {
    // Com resultados chegando a cada 400 ms, o intervalo entre CHEGADAS é
    // sempre 400 ms — um staleness medido por hora de chegada nunca
    // dispararia, por mais velho que fosse o frame descrito.
    //
    // Aqui o worker responde com atraso crescente: a captura fica cada vez
    // mais para trás, mas as chegadas seguem regulares.
    return (async () => {
      const { client, worker } = await clientePronto({ staleMs: 600 });
      const capturas: number[] = [];

      let atraso = 400;
      for (let ciclo = 0; ciclo < 5; ciclo++) {
        const tCaptura = ciclo * 400;
        agora = tCaptura;
        if (client.canSubmit(agora) && client.submitTensor(tensor())) {
          capturas.push(tCaptura);
          const id = worker.ultimoInferId();
          agora = tCaptura + atraso;
          worker.deliver({ type: 'result', id, yaw: 0.1, pitch: 0, confidence: 0.7, inferenceMs: atraso });
        }
        atraso += 300; // a inferência vai degradando
      }

      // O último resultado descreve uma captura antiga o bastante para ser
      // considerada stale, mesmo tendo "acabado de chegar".
      const ultimaCaptura = capturas.at(-1)!;
      const g = client.getLatestGaze(agora);
      expect(agora - ultimaCaptura).toBeGreaterThan(600);
      expect(g.valid).toBe(false);
    })();
  });

  it('o gaze invalidado não carrega yaw/pitch antigos', async () => {
    // Degradação graciosa: zerado e marcado inválido, para o extractor anexar
    // o bloco zerado em vez de propagar um ângulo obsoleto.
    const { client, worker } = await clientePronto({ staleMs: 100 });

    agora = 0;
    client.submitTensor(tensor());
    worker.deliver({
      type: 'result', id: worker.ultimoInferId(),
      yaw: 0.9, pitch: 0.9, confidence: 0.9, inferenceMs: 10,
    });

    const g = client.getLatestGaze(5000);
    expect(g.valid).toBe(false);
    expect(g.yaw).toBe(0);
    expect(g.pitch).toBe(0);
  });
});

describe('o limiar de staleness é dimensionado pela cadência', () => {
  it('DEFAULT_STALE_MS é bem menor que 1500 ms', () => {
    // ~3× a cadência real. Com `l2csCadenceMs = 100`, 1500 ms seriam 15
    // cadências de tolerância — tempo demais para um sinal que alimenta 33%
    // do vetor de features.
    expect(DEFAULT_STALE_MS).toBeLessThan(1500);
    expect(DEFAULT_STALE_MS).toBeGreaterThanOrEqual(300);
  });

  it('um resultado sem submissão correspondente não é aceito', async () => {
    // Defesa: um `result` com id desconhecido (worker respondendo lixo, ou
    // resposta de uma sessão anterior) não tem hora de captura conhecida.
    // Aceitá-lo carimbando `performance.now()` seria carimbar a chegada.
    const { client, worker } = await clientePronto();

    agora = 1000;
    worker.deliver({ type: 'result', id: 999, yaw: 0.5, pitch: 0.5, confidence: 0.9, inferenceMs: 10 });

    const g = client.getLatestGaze(1000);
    expect(g.valid).toBe(false);
  });
});
