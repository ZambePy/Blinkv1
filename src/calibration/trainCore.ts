// Núcleo de treino da calibração — a parte que NÃO precisa de Worker.
//
// ── Por que existir separado ────────────────────────────────────────────────
//
// A equivalência entre treinar no worker e treinar na main thread não estava
// sendo verificada. O teste existia (`client.test.ts`), mas começava com:
//
//     const hasWorker = typeof Worker !== 'undefined';
//     if (!hasWorker) { it.skip('sem Worker global disponível — skip', ...); return; }
//
// e **jsdom não implementa Web Workers**, então o `describe` inteiro retornava
// cedo e o teste real nunca rodava. A suíte ficava verde afirmando uma
// cobertura que não existia — o skip educado escondendo a lacuna.
//
// A saída é a mesma que `P4.2` usou para a captura: separar o que é lógica do
// que é transporte. `treinarCalibracao` é pura e determinística; o worker vira
// uma casca de `postMessage` em volta dela. Aí a equivalência deixa de precisar
// de Worker para ser testada — porque passa a ser a MESMA função dos dois
// lados, e o que resta a provar é só isso.
//
// ── O que continua sem cobertura, e é honesto dizer ─────────────────────────
//
// A serialização estruturada do `postMessage` (ela clona os arrays), o
// carregamento do módulo dentro do worker, e o comportamento sob concorrência
// real. Nada disso roda em jsdom. O que este módulo garante é que a MATEMÁTICA
// é a mesma; o transporte é verificado por `client.b3-10.test.ts` (a config
// viaja na mensagem) e, em runtime, pelo Dia 7.

import { StandardScaler } from '../scaler';
import { RidgeRegressor } from '../ridge';
import { expandPolynomialFeatures } from './polynomial';
import { aplicarConfigDoRegressor, type RegressorConfig } from './regressorConfig';
import type { RidgeModel } from '../ridge';

export interface EntradaDeTreino {
  featuresLeft: number[][];
  featuresRight: number[][];
  targetsX: number[];
  targetsY: number[];
  polynomialFeatures: boolean;
  /**
   * Estado estático do `RidgeRegressor` (B3.10).
   *
   * Um Web Worker tem registro de módulos próprio: sem isto,
   * `RidgeRegressor.axisScale` vale o default `{1,1}` lá dentro, e o CV escolhe
   * λ pesando X e Y igualmente. Em 1920×1080 isso reintroduz o bug de
   * aspect-ratio que subponderava o eixo X em 3,16×.
   */
  regressorConfig?: RegressorConfig;
}

export interface ModeloTreinado {
  scalerLeft: { mean: number[]; std: number[] };
  scalerRight: { mean: number[]; std: number[] };
  modelLeft: RidgeModel;
  modelRight: RidgeModel;
}

function snapshotDoScaler(s: StandardScaler): { mean: number[]; std: number[] } {
  const p = s.getParams();
  return { mean: p.means, std: p.stds };
}

/**
 * Treina os dois olhos. Pura em relação a I/O; determinística para a mesma
 * entrada e a mesma configuração estática.
 *
 * ⚠️ NÃO é pura em relação ao estado global: `aplicarConfigDoRegressor` escreve
 * nos estáticos do `RidgeRegressor`. Isso é deliberado — é o que faz o worker
 * treinar com a mesma configuração da main thread —, mas significa que chamar
 * esta função MUDA o ambiente do processo. Quem chamar em teste precisa salvar
 * e restaurar, como o harness `T0.3` já faz.
 */
export function treinarCalibracao(req: EntradaDeTreino): ModeloTreinado {
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
    throw new Error('[calibration] treino retornou modelo nulo');
  }

  return {
    scalerLeft: snapshotDoScaler(sL),
    scalerRight: snapshotDoScaler(sR),
    modelLeft: modelL,
    modelRight: modelR,
  };
}
