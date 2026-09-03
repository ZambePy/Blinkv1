/// <reference lib="webworker" />

import { StandardScaler } from '../scaler';
import { RidgeRegressor } from '../ridge';
import { expandPolynomialFeatures } from './polynomial';
import { aplicarConfigDoRegressor, type RegressorConfig } from './regressorConfig';
import type { RidgeModel } from '../ridge';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

interface TrainRequest {
  type: 'train';
  id: number;
  featuresLeft: number[][];
  featuresRight: number[][];
  targetsX: number[];
  targetsY: number[];
  /** Recomputado internamente por `RidgeRegressor.train` — ver a nota em
   *  `client.ts`. Mantido na mensagem por compatibilidade. */
  targetGroups: string[];
  polynomialFeatures: boolean;
  /** B3.10 — estado estático do regressor, vindo da main thread. */
  regressorConfig?: RegressorConfig;
}

interface TrainResponse {
  type: 'trained';
  id: number;
  scalerLeft: { mean: number[]; std: number[] };
  scalerRight: { mean: number[]; std: number[] };
  modelLeft: RidgeModel;
  modelRight: RidgeModel;
  trainTimeMs: number;
}

interface ErrorResponse {
  type: 'error';
  id: number;
  error: string;
}

function scalerSnapshot(s: StandardScaler): { mean: number[]; std: number[] } {
  const params = s.getParams();
  return { mean: params.means, std: params.stds };
}

function train(req: TrainRequest): TrainResponse {
  const t0 = performance.now();
  // B3.10 — instala a configuração da main thread ANTES de instanciar
  // qualquer regressor.
  //
  // Um Web Worker tem registro de módulos próprio: sem esta linha,
  // `RidgeRegressor.axisScale` vale o default `{1,1}` aqui dentro, e o CV
  // escolhe λ pesando erro em X e em Y igualmente. Em 1920×1080 isso
  // reintroduz o bug de aspect-ratio que subponderava o eixo X em 3,16× —
  // exatamente o que `axisScale` existe para corrigir.
  aplicarConfigDoRegressor(req.regressorConfig);

  const flExp = req.polynomialFeatures
    ? req.featuresLeft.map((f) => expandPolynomialFeatures(f))
    : req.featuresLeft;
  const frExp = req.polynomialFeatures
    ? req.featuresRight.map((f) => expandPolynomialFeatures(f))
    : req.featuresRight;

  const sL = new StandardScaler();
  sL.fit(flExp);
  const sR = new StandardScaler();
  sR.fit(frExp);

  const rL = new RidgeRegressor();
  rL.train(sL.transform(flExp), req.targetsX, req.targetsY);
  const rR = new RidgeRegressor();
  rR.train(sR.transform(frExp), req.targetsX, req.targetsY);

  const modelL = rL.getModel();
  const modelR = rR.getModel();

  if (!modelL || !modelR) {
    throw new Error('[calibration.worker] treino retornou modelo nulo');
  }

  return {
    type: 'trained',
    id: req.id,
    scalerLeft: scalerSnapshot(sL),
    scalerRight: scalerSnapshot(sR),
    modelLeft: modelL,
    modelRight: modelR,
    trainTimeMs: performance.now() - t0,
  };
}

ctx.addEventListener('message', (ev: MessageEvent<TrainRequest>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'train') {
      ctx.postMessage(train(msg));
    }
  } catch (e) {
    const err: ErrorResponse = {
      type: 'error',
      id: msg.id,
      error: e instanceof Error ? e.message : String(e),
    };
    ctx.postMessage(err);
  }
});
