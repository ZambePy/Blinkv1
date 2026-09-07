import type { RidgeModel } from './ridge';
import { RidgeRegressor } from './ridge';

export interface GazeRegressor {
  /**
   * @param gruposDeAlvo Chave do alvo nominal de cada amostra. Obrigatório
   * quando os alvos passados já vêm compensados por pose — sem ela o
   * agrupamento por coordenada dá um grupo por amostra.
   */
  train(
    features: number[][],
    targetsX: number[],
    targetsY: number[],
    gruposDeAlvo?: readonly string[],
    lambdaFixo?: { x: number; y: number },
  ): void;
  predict(features: number[]): { x: number; y: number };
}

/** O regressor do pipeline. Só existe um; o nome vai para o relatório. */
export const REGRESSOR_MODE = 'ridge' as const;

export function createRegressor(): GazeRegressor {
  return new RidgeRegressor();
}

export function ridgeRegressorFromModel(model: RidgeModel): GazeRegressor {
  return new RidgeRegressor(model);
}

export function ridgeModelFromRegressor(r: GazeRegressor): RidgeModel | null {
  if (r instanceof RidgeRegressor) return r.getModel();
  return null;
}
