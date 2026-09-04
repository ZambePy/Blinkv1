/// <reference lib="webworker" />

import { treinarCalibracao } from './trainCore';
import type { RegressorConfig } from './regressorConfig';
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

/**
 * Casca de transporte. A MATEMÁTICA vive em `trainCore.ts`.
 *
 * A separação existe porque a equivalência entre treinar aqui e treinar na main
 * thread não estava sendo verificada: o teste que a cobriria começava com um
 * guard `typeof Worker !== 'undefined'`, e **jsdom não implementa Web Workers**
 * — o `describe` retornava cedo e o teste real nunca rodava. A suíte ficava
 * verde afirmando uma cobertura inexistente.
 *
 * Com o núcleo extraído, os dois lados chamam a MESMA função, e a equivalência
 * deixa de ser algo a testar através de um Worker que o ambiente de teste não
 * tem. Mesmo padrão de `P4.2` para a captura.
 */
function train(req: TrainRequest): TrainResponse {
  const t0 = performance.now();
  const treinado = treinarCalibracao({
    featuresLeft: req.featuresLeft,
    featuresRight: req.featuresRight,
    targetsX: req.targetsX,
    targetsY: req.targetsY,
    polynomialFeatures: req.polynomialFeatures,
    regressorConfig: req.regressorConfig,
  });
  return {
    type: 'trained',
    id: req.id,
    ...treinado,
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
