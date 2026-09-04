import { describe, it, expect } from 'vitest';
import { createCalibrationClient } from './client';
import { StandardScaler } from '../scaler';
import { RidgeRegressor } from '../ridge';
import { expandPolynomialFeatures } from './polynomial';

// ⚠️ ESTE ARQUIVO NUNCA RODOU, e o skip escondia isso.
//
// O guard era `if (typeof Worker === 'undefined') { it.skip(...); return; }`, e
// **jsdom não implementa Web Workers** — confirmado no ambiente do projeto.
// O `describe` retornava cedo, o teste de equivalência nunca era registrado, e
// a suíte ficava verde afirmando uma cobertura que não existia.
//
// A equivalência migrou para `trainCore.test.ts`, que a verifica SEM Worker: o
// núcleo de treino foi extraído de `calibration.worker.ts` para `trainCore.ts`,
// e os dois lados passaram a chamar a mesma função. Mesmo padrão de `P4.2`.
//
// O que sobra aqui — e roda de verdade — é o transporte: que a config viaja na
// mensagem (`B3.10`) e que nenhuma promise fica pendente (`B3.11`).

describe.skipIf(typeof Worker === 'undefined')(
  'CalibrationClient — equivalência com treino síncrono (exige Worker real)',
  () => {

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
  },
);

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
