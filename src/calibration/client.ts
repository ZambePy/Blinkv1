import type { RidgeModel } from '../ridge';
import { snapshotConfigDoRegressor, type RegressorConfig } from './regressorConfig';

export interface TrainRequest {
  featuresLeft: number[][];
  featuresRight: number[][];
  targetsX: number[];
  targetsY: number[];
  /**
   * Chaves de agrupamento por alvo.
   *
   * ⚠️ O worker NÃO consome este campo, e isso é inofensivo:
   * `RidgeRegressor.train` recomputa os grupos a partir dos próprios alvos via
   * `targetGroupKey`, e a derivação é determinística. O campo permanece na
   * request por compatibilidade e porque documenta a intenção — fica esta nota
   * para quem o ler e estranhar (B3.10).
   */
  targetGroups: string[];
  polynomialFeatures: boolean;
  /**
   * Estado estático do `RidgeRegressor` (B3.10).
   *
   * Preenchido automaticamente por `train()`. Um Web Worker tem registro de
   * módulos próprio, então sem isto os estáticos valem os defaults lá dentro —
   * e o default de `axisScale` (`{1,1}`) reintroduz o bug de aspect-ratio que
   * subponderava o eixo X em 3,16×.
   */
  regressorConfig?: RegressorConfig;
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

  /**
   * Rejeita TODOS os treinos em voo (B3.11).
   *
   * O código anterior fazia `pending.clear()` — descartando os `reject` sem
   * chamá-los — e o handler de `error` só logava. Nos dois casos a promise
   * ficava **pendente para sempre**: o `await` de quem pediu o treino nunca
   * retornava, e a UI travava na tela de "treinando" sem nada acionável para o
   * cuidador. Uma promise que nunca resolve é pior que uma que rejeita, porque
   * não há como escrever tratamento para ela.
   */
  function rejeitarPendentes(motivo: string): void {
    if (pending.size === 0) return;
    const erro = new Error(motivo);
    // Copia antes de limpar: um `reject` pode disparar código que chame
    // `stop()` de novo, e iterar o mapa sendo mutado é como se perde entrada.
    const emVoo = [...pending.values()];
    pending.clear();
    for (const p of emVoo) {
      try {
        p.reject(erro);
      } catch (e) {
        console.error('[calibration.worker] handler de rejeição lançou:', e);
      }
    }
  }

  return {
    async start() {
      if (worker) return;
      worker = new Worker(new URL('./calibration.worker.ts', import.meta.url), { type: 'module' });
      worker.addEventListener('message', handle);
      worker.addEventListener('error', (e) => {
        console.error('[calibration.worker] error:', e.message);
        // B3.11 — erro de carregamento do módulo mata todo treino em voo.
        rejeitarPendentes(`[calibration.worker] erro no worker: ${e.message}`);
        // O worker está inutilizável; um `start()` posterior precisa criar um
        // novo em vez de reaproveitar este.
        worker = null;
        ready = false;
      });
      ready = true;
    },
    train(req: TrainRequest): Promise<TrainedModel> {
      if (!worker || !ready) return Promise.reject(new Error('client not started'));
      const id = ++nextId;
      return new Promise<TrainedModel>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker!.postMessage({
          type: 'train',
          id,
          ...req,
          // B3.10 — a configuração estática do regressor viaja com a request.
          // Sem isto o worker treina com `axisScale = {1,1}`.
          regressorConfig: req.regressorConfig ?? snapshotConfigDoRegressor(),
        });
      });
    },
    stop() {
      worker?.terminate();
      worker = null;
      ready = false;
      // B3.11 — rejeita antes de limpar.
      rejeitarPendentes('[calibration.worker] treino interrompido por stop()');
    },
    isReady() {
      return ready;
    },
  };
}
