import { describe, it, expect } from 'vitest';
import { createCalibrationClient } from './client';
import { StandardScaler } from '../scaler';
import { RidgeRegressor } from '../ridge';
import { expandPolynomialFeatures } from './polynomial';

// Roda em jsdom+worker mock (Vitest suporta workers via `pool: 'threads'`).
// Se o ambiente não tiver Worker global, o teste é skippado com aviso.

describe('CalibrationClient — equivalência com treino síncrono', () => {
  const hasWorker = typeof Worker !== 'undefined';
  if (!hasWorker) {
    it.skip('sem Worker global disponível — skip', () => {});
    return;
  }

  it('produz mesmos pesos que treino síncrono (tolerância 1e-9)', async () => {
    // Dataset sintético: 5 alvos × 6 amostras = 30 samples, 4 features por olho.
    const rng = mulberry32(42);
    const nAlvos = 5, porAlvo = 6, dims = 4;
    const featuresLeft: number[][] = [];
    const featuresRight: number[][] = [];
    const tx: number[] = [], ty: number[] = [], groups: string[] = [];
    for (let a = 0; a < nAlvos; a++) {
      const cx = (a % 3) / 2, cy = Math.floor(a / 3) / 2;
      for (let s = 0; s < porAlvo; s++) {
        featuresLeft.push(Array.from({ length: dims }, () => rng() - 0.5));
        featuresRight.push(Array.from({ length: dims }, () => rng() - 0.5));
        tx.push(cx); ty.push(cy);
        groups.push(`${cx},${cy}`);
      }
    }

    // Treino síncrono (referência)
    const flExp = featuresLeft.map((f) => expandPolynomialFeatures(f));
    const frExp = featuresRight.map((f) => expandPolynomialFeatures(f));
    const sL = new StandardScaler(); sL.fit(flExp);
    const sR = new StandardScaler(); sR.fit(frExp);
    const rL = new RidgeRegressor(); rL.train(sL.transform(flExp), tx, ty);
    const rR = new RidgeRegressor(); rR.train(sR.transform(frExp), tx, ty);
    const expL = rL.getModel();
    const expR = rR.getModel();

    // Treino via worker
    const client = createCalibrationClient();
    await client.start();
    try {
      const trained = await client.train({
        featuresLeft, featuresRight,
        targetsX: tx, targetsY: ty,
        targetGroups: groups,
        polynomialFeatures: true,
      });

      // Compara pesos coeficiente a coeficiente
      expect(trained.modelLeft.betaX.length).toBe(expL!.betaX.length);
      for (let i = 0; i < expL!.betaX.length; i++) {
        expect(trained.modelLeft.betaX[i]).toBeCloseTo(expL!.betaX[i], 9);
        expect(trained.modelLeft.betaY[i]).toBeCloseTo(expL!.betaY[i], 9);
      }
      for (let i = 0; i < expR!.betaX.length; i++) {
        expect(trained.modelRight.betaX[i]).toBeCloseTo(expR!.betaX[i], 9);
        expect(trained.modelRight.betaY[i]).toBeCloseTo(expR!.betaY[i], 9);
      }
    } finally {
      client.stop();
    }
  }, 15000);
});

// PRNG determinístico
function mulberry32(seed: number) {
  let t = seed;
  return function() {
    t += 0x6D2B79F5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
