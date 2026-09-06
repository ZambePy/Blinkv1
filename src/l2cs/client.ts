// Cliente do worker L2CS.
//
// Instancia o Web Worker uma única vez, limita a cadência de submissão, guarda
// o último resultado com a hora da CAPTURA e degrada de forma explícita: se o
// último resultado envelheceu demais, `valid` cai para false e o extractor
// recebe o bloco angular zerado. O loop rAF nunca espera pelo worker.

import type { L2CSGaze, L2CSModelMeta, L2CSWorkerRequest, L2CSWorkerResponse } from './types';
import { EXPERIMENT } from '../config/experiment';

export type L2CSProviderRequest = 'auto' | 'webgpu' | 'wasm';

export interface L2CSClientOptions {
  modelUrl?: string;
  metaUrl?: string;
  cadenceMs?: number;
  /** Idade máxima de um resultado, em ms. Sem valor, é derivada da latência medida. */
  staleMs?: number;
  provider?: L2CSProviderRequest;
}

export interface L2CSClient {
  start(): Promise<void>;
  stop(): void;
  submitTensor(tensor: Float32Array): boolean;
  /** true se um `submitTensor` agora seria aceito (worker pronto, slot livre e
   *  cadência satisfeita). Permite ao engine pular o crop quando não vai adiantar. */
  canSubmit(nowMs?: number): boolean;
  getLatestGaze(nowMs?: number): L2CSGaze;
  getMeta(): L2CSModelMeta | null;
  getAverageLatencyMs(): number;
  /** Provider efetivamente ativo no worker; `null` antes do `ready`. */
  getExecutionProvider(): string | null;
  /** true quando o provider ativo não é o que foi pedido (fallback do modo `auto`). */
  houveFallback(): boolean;
  /** Tolerância de idade em vigor, em ms. */
  getStaleMs(): number;
  getAverageConfidence(): number;
  /** Inferências submetidas e ainda sem resposta (0 ou 1). */
  getPendingCount(): number;
}

// Resolvidos contra a página, não contra a origem: sob `file://` no Electron
// empacotado, `/models/...` apontaria para a raiz do disco.
function urlRelativa(caminho: string): string {
  if (typeof location === 'undefined') return caminho;
  return new URL(caminho, location.href).href;
}

const DEFAULT_MODEL_PATH = 'models/l2cs/l2cs_gaze360.onnx';
const DEFAULT_META_PATH = 'models/l2cs/l2cs.meta.json';
/** Artefatos do ORT (frontend/public/ort/). Resolvido AQUI, na página: dentro
 *  do worker `location.href` é a URL do script do worker, não a do app. */
const DEFAULT_ORT_PATH = 'ort/';

/**
 * Tolerância de idade mínima. Com WebGPU (~50 ms por inferência) o resultado
 * chega bem dentro dela. Em WASM a inferência leva centenas de ms, então a
 * tolerância cresce com a latência medida (ver `staleMsParaLatencia`) — melhor
 * um ângulo de 1 s atrás que um zero no lugar dele.
 */
export const DEFAULT_STALE_MS = 400;
export const MAX_STALE_MS = 2500;

/** Tolerância de idade derivada da latência média: 3 inferências mais a cadência. */
export function staleMsParaLatencia(latenciaMs: number, cadenceMs: number): number {
  if (!Number.isFinite(latenciaMs) || latenciaMs <= 0) return DEFAULT_STALE_MS;
  return Math.min(MAX_STALE_MS, Math.max(DEFAULT_STALE_MS, 3 * latenciaMs + cadenceMs));
}

/** Tempo máximo que uma submissão pode ficar sem resposta antes de o slot ser
 *  liberado. Um worker morto sem `error` prenderia o L2CS pelo resto da sessão. */
export const IN_FLIGHT_TIMEOUT_MS = 8000;

export function createL2CSClient(opts: L2CSClientOptions = {}): L2CSClient {
  const modelUrl = opts.modelUrl ?? urlRelativa(DEFAULT_MODEL_PATH);
  const metaUrl = opts.metaUrl ?? urlRelativa(DEFAULT_META_PATH);
  const ortBaseUrl = urlRelativa(DEFAULT_ORT_PATH);
  const cadenceMs = opts.cadenceMs ?? EXPERIMENT.l2csCadenceMs;
  const staleFixo = opts.staleMs;
  const provider: L2CSProviderRequest =
    opts.provider ?? (EXPERIMENT.l2cs === 'off' ? 'auto' : EXPERIMENT.l2cs);

  let worker: Worker | null = null;
  let ready = false;
  let meta: L2CSModelMeta | null = null;
  let executionProviderAtivo: string | null = null;
  let fallback = false;
  let readyResolve: (() => void) | null = null;
  let readyReject: ((e: Error) => void) | null = null;
  let readyPromise: Promise<void> | null = null;

  let lastSubmitMs = 0;
  let pendingId = 0;
  // id → hora da captura. O resultado é carimbado com essa hora, e não com a
  // hora em que a resposta chegou: é o que faz o staleness medir a idade real
  // do dado. A presença da chave é o backpressure (uma inferência em voo).
  const inFlight = new Map<number, number>();
  const MAX_IN_FLIGHT = 1;
  let latest: L2CSGaze = { yaw: 0, pitch: 0, timestamp: 0, valid: false };
  let recentLatencies: number[] = [];
  let recentConfidences: number[] = [];

  function staleMsAtual(): number {
    if (staleFixo !== undefined) return staleFixo;
    return staleMsParaLatencia(mediaLatencia(), cadenceMs);
  }

  function mediaLatencia(): number {
    if (recentLatencies.length === 0) return 0;
    let sum = 0;
    for (const t of recentLatencies) sum += t;
    return sum / recentLatencies.length;
  }

  function post(msg: L2CSWorkerRequest, transfer?: Transferable[]): void {
    if (!worker) return;
    if (transfer && transfer.length > 0) worker.postMessage(msg, transfer);
    else worker.postMessage(msg);
  }

  function liberarSlotsPresos(now: number): void {
    for (const [id, capturaMs] of inFlight) {
      if (now - capturaMs > IN_FLIGHT_TIMEOUT_MS) {
        inFlight.delete(id);
        console.warn(`[L2CS] inferência ${id} sem resposta há ${((now - capturaMs) / 1000).toFixed(1)} s — slot liberado.`);
      }
    }
  }

  function handleMessage(ev: MessageEvent<L2CSWorkerResponse>): void {
    const msg = ev.data;
    if (msg.type === 'ready') {
      ready = true;
      meta = msg.meta;
      executionProviderAtivo = msg.executionProvider;
      fallback = msg.fallback;
      if (fallback) {
        console.warn(`[L2CS] WebGPU indisponível — rodando em '${msg.executionProvider}'. Latência e staleness maiores; o relatório registra o provider.`);
      }
      readyResolve?.();
      readyResolve = null;
      readyReject = null;
    } else if (msg.type === 'init_error') {
      const err = new Error(`L2CS init: ${msg.error}`);
      console.error('[L2CS]', err);
      readyReject?.(err);
      readyResolve = null;
      readyReject = null;
    } else if (msg.type === 'result') {
      const capturaMs = inFlight.get(msg.id);
      inFlight.delete(msg.id);
      if (capturaMs === undefined) {
        // id de uma sessão anterior ou resposta duplicada: sem hora de captura
        // não dá para julgar a idade do dado.
        console.warn(`[L2CS] resultado com id desconhecido (${msg.id}) descartado.`);
        return;
      }
      latest = {
        yaw: msg.yaw,
        pitch: msg.pitch,
        timestamp: capturaMs,
        valid: true,
        confidence: msg.confidence,
      };
      recentLatencies.push(msg.inferenceMs);
      if (recentLatencies.length > 20) recentLatencies.shift();
      recentConfidences.push(msg.confidence);
      if (recentConfidences.length > 20) recentConfidences.shift();
    } else if (msg.type === 'infer_error') {
      inFlight.delete(msg.id);
      console.warn('[L2CS] infer error:', msg.error);
    }
  }

  return {
    async start(): Promise<void> {
      if (worker) return readyPromise ?? Promise.resolve();
      worker = new Worker(new URL('./l2cs.worker.ts', import.meta.url), { type: 'module' });
      worker.addEventListener('message', handleMessage);
      worker.addEventListener('error', (e) => {
        console.error('[L2CS] Worker execution error:', e.message, e.filename, e.lineno);
        readyReject?.(new Error('Worker execution error: ' + e.message));
        // Um worker que morreu depois do `ready` nunca vai responder o que
        // está em voo; liberar aqui evita esperar o timeout.
        inFlight.clear();
      });

      readyPromise = new Promise<void>((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
      });
      post({ type: 'init', modelUrl, metaUrl, provider, ortBaseUrl });
      return readyPromise;
    },

    stop(): void {
      if (worker) {
        worker.terminate();
        worker = null;
      }
      ready = false;
      meta = null;
      executionProviderAtivo = null;
      fallback = false;
      readyPromise = null;
      readyResolve = null;
      readyReject = null;
      lastSubmitMs = 0;
      latest = { yaw: 0, pitch: 0, timestamp: 0, valid: false };
      recentLatencies = [];
      recentConfidences = [];
      inFlight.clear();
    },

    canSubmit(nowMs?: number): boolean {
      if (!ready || !worker) return false;
      const now = nowMs ?? performance.now();
      liberarSlotsPresos(now);
      if (inFlight.size >= MAX_IN_FLIGHT) return false;
      return now - lastSubmitMs >= cadenceMs;
    },

    submitTensor(tensor: Float32Array): boolean {
      if (!ready || !worker) return false;
      const now = performance.now();
      liberarSlotsPresos(now);
      if (inFlight.size >= MAX_IN_FLIGHT) return false;
      if (now - lastSubmitMs < cadenceMs) return false;
      const id = ++pendingId;
      try {
        // O buffer é transferido, não copiado: o caller aloca um tensor novo
        // por submissão.
        post({ type: 'infer', id, tensor }, [tensor.buffer]);
      } catch (e) {
        // Buffer já destacado ou worker indisponível: nada foi enviado, então o
        // slot não pode ficar ocupado.
        console.warn('[L2CS] submissão falhou:', e);
        return false;
      }
      lastSubmitMs = now;
      inFlight.set(id, now);
      return true;
    },

    getLatestGaze(nowMs?: number): L2CSGaze {
      const now = nowMs ?? performance.now();
      if (!latest.valid) return latest;
      if (now - latest.timestamp > staleMsAtual()) {
        return { yaw: 0, pitch: 0, timestamp: latest.timestamp, valid: false };
      }
      return latest;
    },

    getMeta(): L2CSModelMeta | null {
      return meta;
    },

    getExecutionProvider(): string | null {
      return executionProviderAtivo;
    },

    houveFallback(): boolean {
      return fallback;
    },

    getStaleMs(): number {
      return staleMsAtual();
    },

    getAverageLatencyMs(): number {
      return mediaLatencia();
    },

    getAverageConfidence(): number {
      if (recentConfidences.length === 0) return 0;
      let sum = 0;
      for (const c of recentConfidences) sum += c;
      return sum / recentConfidences.length;
    },

    getPendingCount(): number {
      return inFlight.size;
    },
  };
}
