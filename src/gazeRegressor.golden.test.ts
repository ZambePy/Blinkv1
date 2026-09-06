import { describe, it, expect, beforeAll } from 'vitest';
import { createRegressor, ridgeRegressorFromModel, REGRESSOR_MODE } from './gazeRegressor';
import { RidgeRegressor } from './ridge';
import { trainRidgeModel, predictRidge } from './ridge';
import { StandardScaler } from './scaler';

// Golden snapshot: verifies that RidgeRegressor.predict() produces bit-identical
// output to predictRidge() when given the SAME pre-trained model.
// (Training via the wrapper uses CV λ-selection, so wrapper-trained vs
// raw-trained models diverge — but the prediction path itself must remain a
// thin, lossless wrapper. That's the contract tested here.)
// Uses the same 3×3 synthetic fixture as ridge.convexhull.test.ts.

const SCREEN_WIDTH  = 1920;
const SCREEN_HEIGHT = 1080;

beforeAll(() => {
  Object.defineProperty(document.documentElement, 'clientWidth', {
    value: SCREEN_WIDTH,
    configurable: true,
  });
  Object.defineProperty(document.documentElement, 'clientHeight', {
    value: SCREEN_HEIGHT,
    configurable: true,
  });
});

function buildSyntheticProfile() {
  const grid = [0.05, 0.5, 0.95];
  const features: number[][] = [];
  const targets: { screenX: number; screenY: number }[] = [];

  for (const gy of grid) {
    for (const gx of grid) {
      features.push([(gx - 0.5) * 2, (gy - 0.5) * 2, 0.1 * (gx + gy), 0.05]);
      targets.push({ screenX: gx, screenY: gy });
    }
  }
  return { features, targets };
}

describe('GazeRegressor golden snapshot', () => {
  it('predict() is byte-identical to predictRidge() for an in-hull vector', () => {
    const { features, targets } = buildSyntheticProfile();

    const scaler = new StandardScaler();
    scaler.fit(features);
    const scaled = scaler.transform(features);

    // Train once via the raw function, then wrap the SAME model in the interface.
    // This isolates the wrapper from CV λ-selection to test only the predict path.
    // λ é adimensional (penalidade `λ·m·P`, não `λ·I` absoluto).
    // Com m=9 amostras o antigo default λ=1.0 equivale a λ=1/9 na escala
    // adimensional; passamos o valor explícito para este teste continuar
    // descrevendo o MESMO regime de regularização.
    const LAMBDA_LEGACY_EQUIV = 1 / 9;
    const model = trainRidgeModel(scaled, targets, LAMBDA_LEGACY_EQUIV);
    const probe = scaler.transformSingle([0, 0, 0.1, 0.05]);
    const golden = predictRidge(model, probe);

    const reg = ridgeRegressorFromModel(model);
    const got = reg.predict(probe);

    expect(got.x).toBe(golden.x);
    expect(got.y).toBe(golden.y);
  });

  it('predict() is byte-identical to predictRidge() for an out-of-hull vector', () => {
    const { features, targets } = buildSyntheticProfile();

    const scaler = new StandardScaler();
    scaler.fit(features);
    const scaled = scaler.transform(features);

    // λ é adimensional (penalidade `λ·m·P`, não `λ·I` absoluto).
    // Com m=9 amostras o antigo default λ=1.0 equivale a λ=1/9 na escala
    // adimensional; passamos o valor explícito para este teste continuar
    // descrevendo o MESMO regime de regularização.
    const LAMBDA_LEGACY_EQUIV = 1 / 9;
    const model = trainRidgeModel(scaled, targets, LAMBDA_LEGACY_EQUIV);
    const maxF0 = Math.max(...features.map(f => f[0]));
    const probe = scaler.transformSingle([maxF0 * 2, 0, 0.1, 0.05]);
    const golden = predictRidge(model, probe);

    const reg = ridgeRegressorFromModel(model);
    const got = reg.predict(probe);

    expect(got.x).toBe(golden.x);
    expect(got.y).toBe(golden.y);
  });

  it('createRegressor() builds the one regressor the pipeline has, and names it', () => {
    expect(createRegressor()).toBeInstanceOf(RidgeRegressor);
    expect(REGRESSOR_MODE).toBe('ridge');
  });
});
