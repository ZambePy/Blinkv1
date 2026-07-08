import { describe, it, expect, beforeAll } from 'vitest';
import { createRegressor } from './gazeRegressor';
import { trainRidgeModel, predictRidge } from './ridge';
import { StandardScaler } from './scaler';

// Golden snapshot: verifies that GazeRegressor.predict() produces bit-identical
// output to predictRidge() for the same inputs after the interface refactor.
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

    // Golden value via the original functions
    const model = trainRidgeModel(scaled, targets);
    const probe = scaler.transformSingle([0, 0, 0.1, 0.05]);
    const golden = predictRidge(model, probe);

    // Same computation via GazeRegressor interface
    const reg = createRegressor('ridge');
    reg.train(scaled, targets.map(t => t.screenX), targets.map(t => t.screenY));
    const got = reg.predict(probe);

    expect(got.x).toBe(golden.x);
    expect(got.y).toBe(golden.y);
  });

  it('predict() is byte-identical to predictRidge() for an out-of-hull vector', () => {
    const { features, targets } = buildSyntheticProfile();

    const scaler = new StandardScaler();
    scaler.fit(features);
    const scaled = scaler.transform(features);

    const model = trainRidgeModel(scaled, targets);
    const maxF0 = Math.max(...features.map(f => f[0]));
    const probe = scaler.transformSingle([maxF0 * 2, 0, 0.1, 0.05]);
    const golden = predictRidge(model, probe);

    const reg = createRegressor('ridge');
    reg.train(scaled, targets.map(t => t.screenX), targets.map(t => t.screenY));
    const got = reg.predict(probe);

    expect(got.x).toBe(golden.x);
    expect(got.y).toBe(golden.y);
  });

  it('createRegressor throws for unsupported mode', () => {
    expect(() => createRegressor('kernel_ridge' as never)).toThrow(
      /Only 'ridge' is currently implemented/
    );
  });
});
