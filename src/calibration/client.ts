import type { RidgeModel } from '../ridge';

export interface TrainRequest {
  featuresLeft: number[][];
  featuresRight: number[][];
  targetsX: number[];
  targetsY: number[];
  targetGroups: string[];
  polynomialFeatures: boolean;
}

export interface TrainedModel {
  scalerLeft: { mean: number[]; std: number[] };
  scalerRight: { mean: number[]; std: number[] };
  modelLeft: RidgeModel;
  modelRight: RidgeModel;
  trainTimeMs: number;
}

export interface CalibrationClient {
  start(): Promise<void>;
  train(req: TrainRequest): Promise<TrainedModel>;
  stop(): void;
  isReady(): boolean;
}

interface Pending {
  resolve: (t: TrainedModel) => void;
  reject: (e: Error) => void;
}

export function createCalibrationClient(): CalibrationClient {
  let worker: Worker | null = null;
  let ready = false;
  let nextId = 0;
  const pending = new Map<number, Pending>();

  function handle(ev: MessageEvent<{ type: string; id: number; error?: string } & Partial<TrainedModel>>) {
    const msg = ev.data;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.type === 'trained') {
      p.resolve(msg as unknown as TrainedModel);
    } else if (msg.type === 'error') {
      p.reject(new Error(msg.error ?? 'unknown error'));
    }
  }

  return {
    async start() {
      if (worker) return;
      worker = new Worker(new URL('./calibration.worker.ts', import.meta.url), { type: 'module' });
      worker.addEventListener('message', handle);
      worker.addEventListener('error', (e) => {
        console.error('[calibration.worker] error:', e.message);
      });
      ready = true;
    },
    train(req: TrainRequest): Promise<TrainedModel> {
      if (!worker || !ready) return Promise.reject(new Error('client not started'));
      const id = ++nextId;
      return new Promise<TrainedModel>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker!.postMessage({ type: 'train', id, ...req });
      });
    },
    stop() {
      worker?.terminate();
      worker = null;
      ready = false;
      pending.clear();
    },
    isReady() {
      return ready;
    },
  };
}
