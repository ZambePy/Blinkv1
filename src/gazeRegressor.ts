import type { RidgeModel } from './ridge';
import { RidgeRegressor } from './ridge';

export interface GazeRegressor {
  train(features: number[][], targetsX: number[], targetsY: number[]): void;
  predict(features: number[]): { x: number; y: number };
}

export type RegressorMode = 'ridge'; // future: | 'kernel_ridge'

export function createRegressor(mode: RegressorMode): GazeRegressor {
  if (mode === 'ridge') return new RidgeRegressor();
  throw new Error(`Unsupported regressor mode: "${mode as string}". Only 'ridge' is currently implemented.`);
}

// Reconstructs a GazeRegressor from a serialized RidgeModel (localStorage format).
export function ridgeRegressorFromModel(model: RidgeModel): GazeRegressor {
  return new RidgeRegressor(model);
}

// Extracts the underlying RidgeModel for serialization. Returns null for unknown implementations.
export function ridgeModelFromRegressor(r: GazeRegressor): RidgeModel | null {
  if (r instanceof RidgeRegressor) return r.getModel();
  return null;
}
