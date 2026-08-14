// Cliente do worker L2CS (E4 do L2CS-NET.md).
// Responsabilidades:
//   1. Instanciar o Web Worker uma única vez.
//   2. Throttling da cadência (10 Hz por default — o gaze angular muda devagar).
//   3. Cache do último resultado válido + carimbo temporal.
//   4. Degradação graciosa: se o último resultado ficou stale, valid = false.
// O engine.ts NUNCA espera pelo worker; ele consulta getLatestGaze() no rAF
// e segue a vida se valid === false (o bloco de E5 vai a zero nesse caso).

import type { L2CSGaze, L2CSModelMeta, L2CSWorkerRequest, L2CSWorkerResponse } from './types';

export interface L2CSClientOptions {
  modelUrl?: string;
  metaUrl?: string;
  cadenceMs?: number;
  staleMs?: number;
}

export interface L2CSClient {
  start(): Promise<void>;
  stop(): void;
  submitTensor(tensor: Float32Array): boolean;
  // Retorna true se um submitTensor agora seria aceito (throttle satisfeito
  // + worker pronto). Permite ao caller pular o preprocessamento pesado
  // (crop 448 + normalização ImageNet) quando o worker vai descartar mesmo.
  canSubmit(nowMs?: number): boolean;
  getLatestGaze(nowMs?: number): L2CSGaze;
  isReady(): boolean;
  getMeta(): L2CSModelMeta | null;
}

const DEFAULT_MODEL_URL = '/models/l2cs/l2cs_gaze360.onnx';
const DEFAULT_META_URL = '/models/l2cs/l2cs.meta.json';
const DEFAULT_CADENCE_MS = 100;
const DEFAULT_STALE_MS = 500;

export function createL2CSClient(opts: L2CSClientOptions = {}): L2CSClient {
  const modelUrl = opts.modelUrl ?? DEFAULT_MODEL_URL;
  const metaUrl = opts.metaUrl ?? DEFAULT_META_URL;
  const cadenceMs = opts.cadenceMs ?? DEFAULT_CADENCE_MS;
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS;

  let worker: Worker | null = null;
  let ready = false;
  let meta: L2CSModelMeta | null = null;
  let readyResolve: (() => void) | null = null;
  let readyReject: ((e: Error) => void) | null = null;
  let readyPromise: Promise<void> | null = null;

  let lastSubmitMs = 0;
  let pendingId = 0;
  let latest: L2CSGaze = { yaw: 0, pitch: 0, timestamp: 0, valid: false };

  function post(msg: L2CSWorkerRequest, transfer?: Transferable[]): void {
    if (!worker) return;
    if (transfer && transfer.length > 0) worker.postMessage(msg, transfer);
    else worker.postMessage(msg);
  }

  function handleMessage(ev: MessageEvent<L2CSWorkerResponse>): void {
    const msg = ev.data;
    if (msg.type === 'ready') {
      ready = true;
      meta = msg.meta;
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
      latest = {
        yaw: msg.yaw,
        pitch: msg.pitch,
        timestamp: performance.now(),
        valid: true,
      };
    } else if (msg.type === 'infer_error') {
      // Não invalidamos o cache — mantemos o último valor enquanto ele ainda
      // for fresh; se ficar stale, valid cai para false naturalmente.
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
      });

      readyPromise = new Promise<void>((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
      });
      post({ type: 'init', modelUrl, metaUrl });
      return readyPromise;
    },

    stop(): void {
      if (worker) {
        worker.terminate();
        worker = null;
      }
      ready = false;
      meta = null;
      readyPromise = null;
      readyResolve = null;
      readyReject = null;
      latest = { yaw: 0, pitch: 0, timestamp: 0, valid: false };
    },

    canSubmit(nowMs?: number): boolean {
      if (!ready || !worker) return false;
      const now = nowMs ?? performance.now();
      return now - lastSubmitMs >= cadenceMs;
    },

    // Throttled — devolve false se ainda não passou o intervalo de cadência
    // ou se o worker não está pronto. O caller pode ignorar o retorno; é só
    // um hint para telemetria (quantos frames o L2CS aceitou vs ignorou).
    submitTensor(tensor: Float32Array): boolean {
      if (!ready || !worker) return false;
      const now = performance.now();
      if (now - lastSubmitMs < cadenceMs) return false;
      lastSubmitMs = now;
      const id = ++pendingId;
      // Transfere o buffer para o worker para evitar cópia (o caller não
      // pode reusar o tensor depois — deve alocar um novo por submissão).
      post({ type: 'infer', id, tensor, width: 0, height: 0 }, [tensor.buffer]);
      return true;
    },

    getLatestGaze(nowMs?: number): L2CSGaze {
      const now = nowMs ?? performance.now();
      if (!latest.valid) return latest;
      if (now - latest.timestamp > staleMs) {
        return { yaw: 0, pitch: 0, timestamp: latest.timestamp, valid: false };
      }
      return latest;
    },

    isReady(): boolean {
      return ready;
    },

    getMeta(): L2CSModelMeta | null {
      return meta;
    },
  };
}
