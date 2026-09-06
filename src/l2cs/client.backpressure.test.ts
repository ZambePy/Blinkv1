import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createL2CSClient, IN_FLIGHT_TIMEOUT_MS } from './client';
import type { L2CSWorkerRequest, L2CSWorkerResponse } from './types';

// Backpressure do cliente L2CS: no máximo uma inferência em voo. Só olhar a
// cadência (10 submissões/s) contra um worker WASM que leva 300–600 ms por
// inferência acumularia ~7 tensores de 2,3 MiB por segundo na fila (~16 MiB/s
// até OOM). O slot é liberado em `result` E em `infer_error`.

/** Worker falso: registra o que foi postado e deixa o teste entregar respostas
 *  no momento que quiser. É o que permite simular latência sem esperar de fato. */
class FakeWorker {
  static instances: FakeWorker[] = [];
  listeners = new Map<string, Set<(ev: unknown) => void>>();
  posted: L2CSWorkerRequest[] = [];
  terminated = false;

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

  postMessage(msg: L2CSWorkerRequest, _transfer?: Transferable[]): void {
    this.posted.push(msg);
    // O `init` é respondido de imediato para o teste não precisar orquestrar
    // o handshake — o que está sob teste é a fila de inferência, não o boot.
    if (msg.type === 'init') {
      queueMicrotask(() => this.deliver({
        type: 'ready',
        meta: {
          dataset: 'gaze360', outputBins: 90, binWidth: 4, binOffset: -180,
          inputSize: 448, inputTensorName: 'input',
          outputTensorNames: { yaw: 'yaw', pitch: 'pitch' },
        },
        executionProvider: 'wasm',
        requested: msg.provider,
        fallback: false,
      }));
    }
  }

  terminate(): void { this.terminated = true; }

  /** Entrega uma resposta ao cliente, como se o worker tivesse respondido. */
  deliver(data: L2CSWorkerResponse): void {
    for (const cb of this.listeners.get('message') ?? []) cb({ data });
  }

  /** Quantas mensagens `infer` foram postadas até agora. */
  inferCount(): number {
    return this.posted.filter((m) => m.type === 'infer').length;
  }

  /** Os ids das inferências postadas, na ordem. */
  inferIds(): number[] {
    return this.posted.flatMap((m) => (m.type === 'infer' ? [m.id] : []));
  }
}

/** Tensor do tamanho real que o pipeline envia: 3·448·448 floats ≈ 2,3 MiB.
 *  Usar o tamanho real importa porque é o que torna o vazamento caro. */
function tensor(): Float32Array {
  return new Float32Array(3 * 448 * 448);
}

let originalWorker: unknown;

beforeEach(() => {
  FakeWorker.instances = [];
  originalWorker = (globalThis as Record<string, unknown>).Worker;
  (globalThis as Record<string, unknown>).Worker = FakeWorker;
});

afterEach(() => {
  (globalThis as Record<string, unknown>).Worker = originalWorker;
  vi.restoreAllMocks();
});

/** Cria um cliente já em estado `ready`, com cadência 0 para isolar o teste do
 *  throttle temporal — o que está sob teste aqui é o backpressure, não a
 *  cadência (que já funcionava). */
async function clienteProntoSemCadencia() {
  const client = createL2CSClient({ cadenceMs: 0 });
  const p = client.start();
  await p;
  const worker = FakeWorker.instances.at(-1)!;
  return { client, worker };
}

describe('backpressure: nunca mais de uma inferência em voo', () => {
  it('a segunda submissão é recusada enquanto a primeira não voltou', async () => {
    const { client, worker } = await clienteProntoSemCadencia();

    expect(client.submitTensor(tensor())).toBe(true);
    // Sem resposta do worker, toda submissão seguinte tem que ser recusada.
    expect(client.submitTensor(tensor())).toBe(false);
    expect(client.submitTensor(tensor())).toBe(false);
    expect(worker.inferCount()).toBe(1);
  });

  it('canSubmit() é false enquanto há inferência em voo', async () => {
    // Relógio controlado: o slot em voo é liberado sozinho depois de
    // `IN_FLIGHT_TIMEOUT_MS` (worker morto sem `error`), então o instante
    // consultado precisa ficar aquém disso para o que se mede ser o
    // backpressure, e não o timeout.
    let agora = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => agora);
    const { client, worker } = await clienteProntoSemCadencia();

    expect(client.canSubmit(0)).toBe(true);
    client.submitTensor(tensor());
    // Este é o gate que importa: o engine consulta `canSubmit()` ANTES de
    // gastar ~5 ms em getImageData + crop 448². Sem ele o custo é pago para
    // depois jogar o resultado fora.
    agora = IN_FLIGHT_TIMEOUT_MS / 2;
    expect(client.canSubmit(agora)).toBe(false);

    worker.deliver({ type: 'result', id: 1, yaw: 0.1, pitch: -0.1, confidence: 0.8, inferenceMs: 400 });
    expect(client.canSubmit(agora)).toBe(true);
  });

  it('100 tentativas contra um worker mudo produzem exatamente 1 submissão', async () => {
    const { client, worker } = await clienteProntoSemCadencia();

    for (let i = 0; i < 100; i++) client.submitTensor(tensor());

    // Sem backpressure: 100 mensagens na fila = ~230 MiB retidos.
    expect(worker.inferCount()).toBe(1);
  });

  it('após o resultado, a próxima submissão é aceita', async () => {
    const { client, worker } = await clienteProntoSemCadencia();

    client.submitTensor(tensor());
    worker.deliver({ type: 'result', id: 1, yaw: 0, pitch: 0, confidence: 0.9, inferenceMs: 400 });
    expect(client.submitTensor(tensor())).toBe(true);
    expect(worker.inferCount()).toBe(2);
  });
});

describe('o slot é liberado também em erro', () => {
  it('infer_error libera o slot — senão um erro trava o L2CS para sempre', async () => {
    const { client, worker } = await clienteProntoSemCadencia();

    client.submitTensor(tensor());
    expect(client.submitTensor(tensor())).toBe(false);

    worker.deliver({ type: 'infer_error', id: 1, error: 'ORT session failed' });

    // Sem esta liberação, um único erro de inferência (tensor corrompido,
    // sessão ORT caída) deixaria `pending` preso em 1 e o L2CS mudo pelo resto
    // da sessão — um modo de falha silencioso pior que o vazamento.
    expect(client.submitTensor(tensor())).toBe(true);
    expect(worker.inferCount()).toBe(2);
  });

  it('stop() zera o contador em voo', async () => {
    const { client } = await clienteProntoSemCadencia();
    client.submitTensor(tensor());
    client.stop();

    // Após stop() o cliente recusa por não ter worker; o que este teste trava
    // é que um start() posterior não herda `pending` da sessão anterior.
    expect(client.submitTensor(tensor())).toBe(false);
    expect(client.getPendingCount()).toBe(0);
  });
});

describe('a taxa de submissão converge para a taxa de consumo', () => {
  it('com latência 500 ms e cadência 100 ms, submete ~1 a cada 500 ms, não 10', async () => {
    // Relógio controlado: o worker leva 500 ms, a cadência permitiria 10
    // submissões/s. Sem backpressure seriam ~20 submissões em 2 s (≈46 MiB
    // retidos); com backpressure, ~4.
    let agora = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => agora);

    const client = createL2CSClient({ cadenceMs: 100 });
    await client.start();
    const worker = FakeWorker.instances.at(-1)!;

    const LATENCIA_MS = 500;
    const PASSO_MS = 1000 / 30;      // rAF a 30 fps
    const DURACAO_MS = 2000;
    let proximaConclusao: number | null = null;
    let idEmVoo = 0;

    for (agora = 0; agora < DURACAO_MS; agora += PASSO_MS) {
      // Worker conclui a inferência quando o tempo simulado chega.
      if (proximaConclusao !== null && agora >= proximaConclusao) {
        worker.deliver({
          type: 'result', id: idEmVoo, yaw: 0.05, pitch: 0.02,
          confidence: 0.7, inferenceMs: LATENCIA_MS,
        });
        proximaConclusao = null;
      }
      if (client.canSubmit(agora) && client.submitTensor(tensor())) {
        idEmVoo = worker.inferIds().at(-1)!;
        proximaConclusao = agora + LATENCIA_MS;
      }
    }

    const submissoes = worker.inferCount();
    // Teto teórico: 2000/500 = 4 concluídas + 1 ainda em voo.
    expect(submissoes).toBeLessThanOrEqual(5);
    // E não pode ter parado de submeter — isso seria o deadlock do slot preso.
    expect(submissoes).toBeGreaterThanOrEqual(3);
  });
});

describe('observabilidade', () => {
  it('getPendingCount() reflete o estado em voo', async () => {
    const { client, worker } = await clienteProntoSemCadencia();

    expect(client.getPendingCount()).toBe(0);
    client.submitTensor(tensor());
    expect(client.getPendingCount()).toBe(1);
    worker.deliver({ type: 'result', id: 1, yaw: 0, pitch: 0, confidence: 0.9, inferenceMs: 300 });
    expect(client.getPendingCount()).toBe(0);
  });

  it('resultado com id desconhecido não torna o contador negativo', async () => {
    // Defesa contra o worker responder duas vezes o mesmo id, ou responder um
    // id de uma sessão anterior. Contador negativo faria `canSubmit` liberar
    // submissões para sempre — o vazamento voltaria pela porta dos fundos.
    const { client, worker } = await clienteProntoSemCadencia();

    worker.deliver({ type: 'result', id: 999, yaw: 0, pitch: 0, confidence: 0.5, inferenceMs: 10 });
    expect(client.getPendingCount()).toBe(0);

    client.submitTensor(tensor());
    worker.deliver({ type: 'result', id: 1, yaw: 0, pitch: 0, confidence: 0.5, inferenceMs: 10 });
    worker.deliver({ type: 'result', id: 1, yaw: 0, pitch: 0, confidence: 0.5, inferenceMs: 10 });
    expect(client.getPendingCount()).toBe(0);
  });
});
