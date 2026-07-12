import type { RidgeModel } from './ridge';
import { RidgeRegressor } from './ridge';
import type { KernelRidgeModel } from './kernelRidge';
import { KernelRidgeRegressor } from './kernelRidge';
import { SVRRegressor, svrModelFromRegressor, svrRegressorFromModel } from './svr';

export interface GazeRegressor {
  train(features: number[][], targetsX: number[], targetsY: number[]): void;
  predict(features: number[]): { x: number; y: number };
}

export type RegressorMode = 'ridge' | 'kernel_ridge' | 'svr';

// Active production mode set to 'svr' as requested.
export const REGRESSOR_MODE: RegressorMode = 'svr';

export function createRegressor(mode: RegressorMode): GazeRegressor {
  if (mode === 'ridge')        return new RidgeRegressor();
  if (mode === 'kernel_ridge') return new KernelRidgeRegressor();
  if (mode === 'svr')          return new SVRRegressor();
  throw new Error(`Unsupported regressor mode: "${mode as string}".`);
}

// ─── Serialização Ridge ────────────────────────────────────────────────────────

export function ridgeRegressorFromModel(model: RidgeModel): GazeRegressor {
  return new RidgeRegressor(model);
}

export function ridgeModelFromRegressor(r: GazeRegressor): RidgeModel | null {
  if (r instanceof RidgeRegressor) return r.getModel();
  return null;
}

// ─── Serialização KernelRidge ─────────────────────────────────────────────────

export function kernelRidgeRegressorFromModel(model: KernelRidgeModel): GazeRegressor {
  return new KernelRidgeRegressor(model);
}

export function kernelRidgeModelFromRegressor(r: GazeRegressor): KernelRidgeModel | null {
  if (r instanceof KernelRidgeRegressor) return r.getModel();
  return null;
}

// ─── Serialização SVR ─────────────────────────────────────────────────────────

export { svrModelFromRegressor, svrRegressorFromModel };
