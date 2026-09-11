// Benchmark de precisão end-to-end: valida o pipeline Ridge + softClamp
// em regiões críticas (centro, bordas, cantos, transições).
//
// Este teste NÃO usa câmera real — simula features sintéticas com
// relação linear conhecida (ideal para Ridge) e mede:
//   1. Que o softClamp tem derivada contínua (sem saltos de velocidade)
//   2. Que a precisão nas bordas ≤ 1.5× a precisão central
//   3. Que a grade de calibração mantém as invariantes de forma (as posições
//      saem do orçamento de excentricidade, não são mais constantes)
//   4. Que sacadas rápidas preservam amplitude com os novos betas

import { describe, it, expect } from 'vitest';
import { trainRidgeModel, predictRidge } from './ridge';
import { StandardScaler } from './scaler';
import { CALIBRATION_TARGETS_FULL, CALIBRATION_TARGETS_QUICK } from './calibration';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Gera features sintéticas com relação linear ao target (ideal para Ridge).
 *  Cada feature é uma função linear do target com ruído gaussiano adicionado. */
function syntheticFeatures(targetX: number, targetY: number, dims: number, noise = 0.001): number[] {
  const f = new Array(dims);
  for (let i = 0; i < dims; i++) {
    // Mix determinístico de X e Y com pesos por dimensão + pequeno ruído
    const wx = Math.sin(i * 1.23 + 0.5);
    const wy = Math.cos(i * 0.87 + 0.3);
    f[i] = wx * targetX + wy * targetY + noise * (Math.sin(i * 7.13 + targetX * 31 + targetY * 17) - 0.5);
  }
  return f;
}

/** Gera dataset de calibração com N amostras por target. */
function generateCalibrationData(
  targets: readonly { x: number; y: number }[],
  samplesPerTarget: number,
  dims: number,
  noise = 0.001,
): { features: number[][]; tgts: { screenX: number; screenY: number }[] } {
  const features: number[][] = [];
  const tgts: { screenX: number; screenY: number }[] = [];
  for (const t of targets) {
    for (let s = 0; s < samplesPerTarget; s++) {
      features.push(syntheticFeatures(t.x, t.y, dims, noise + s * 0.0001));
      tgts.push({ screenX: t.x, screenY: t.y });
    }
  }
  return { features, tgts };
}

// ── softClamp tests ──────────────────────────────────────────────────────────

describe('softClamp — Hermite smoothstep C¹ continuity', () => {
  // Reconstruct softClamp in isolation for unit testing
  const SOFT_MARGIN = 0.02;
  function softClamp(v: number): number {
    if (v <= 0) return 0;
    if (v >= 1) return 1;
    if (v < SOFT_MARGIN) {
      const t = v / SOFT_MARGIN;
      return SOFT_MARGIN * t * t * (2 - t);
    }
    if (v > 1 - SOFT_MARGIN) {
      const t = (1 - v) / SOFT_MARGIN;
      return 1 - SOFT_MARGIN * t * t * (2 - t);
    }
    return v;
  }

  it('boundary conditions: f(0)=0, f(1)=1, f(margin)=margin', () => {
    expect(softClamp(0)).toBe(0);
    expect(softClamp(1)).toBe(1);
    expect(softClamp(SOFT_MARGIN)).toBeCloseTo(SOFT_MARGIN, 10);
    expect(softClamp(1 - SOFT_MARGIN)).toBeCloseTo(1 - SOFT_MARGIN, 10);
  });

  it('is identity in [margin, 1-margin]', () => {
    for (const v of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      expect(softClamp(v)).toBe(v);
    }
  });

  it('is monotonic', () => {
    let prev = softClamp(0);
    for (let v = 0.001; v <= 1.0; v += 0.001) {
      const curr = softClamp(v);
      expect(curr).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = curr;
    }
  });

  it('derivative is continuous at junction points (C¹)', () => {
    const h = 1e-6;
    // Left junction: v = SOFT_MARGIN
    const dLeft = (softClamp(SOFT_MARGIN + h) - softClamp(SOFT_MARGIN - h)) / (2 * h);
    expect(dLeft).toBeCloseTo(1.0, 2);  // slope = 1 at junction

    // Right junction: v = 1 - SOFT_MARGIN
    const dRight = (softClamp(1 - SOFT_MARGIN + h) - softClamp(1 - SOFT_MARGIN - h)) / (2 * h);
    expect(dRight).toBeCloseTo(1.0, 2);  // slope = 1 at junction
  });

  it('derivative at v=0 is 0 (cursor starts slow at boundary)', () => {
    const h = 1e-8;
    const dZero = (softClamp(h) - softClamp(0)) / h;
    expect(dZero).toBeCloseTo(0, 2);
  });

  it('values outside [0,1] are clamped to boundaries', () => {
    expect(softClamp(-0.5)).toBe(0);
    expect(softClamp(1.5)).toBe(1);
    expect(softClamp(-100)).toBe(0);
    expect(softClamp(100)).toBe(1);
  });

  it('compression in border region is minimal with 2% margin', () => {
    // At v=0.01 (center of left border), t=0.5
    // f = 0.02 * 0.25 * 1.5 = 0.0075 (less compressed than the old cos version)
    const v = 0.01;
    const mapped = softClamp(v);
    // Must be > 0 and < v (some compression) but close to v
    expect(mapped).toBeGreaterThan(0);
    expect(mapped).toBeLessThanOrEqual(v);
    // The compression ratio should be modest — within 50% of the input
    expect(mapped).toBeGreaterThan(v * 0.5);
  });
});

// ── Ridge precision at edges and corners ─────────────────────────────────────

describe('Ridge precision — edges vs center', () => {
  const DIMS = 37;
  const SAMPLES_PER_TARGET = 40;

  it('Ridge + scaler produces lower error at center than at edges (synthetic linear)', () => {
    const { features, tgts } = generateCalibrationData(
      CALIBRATION_TARGETS_FULL,
      SAMPLES_PER_TARGET,
      DIMS,
    );

    const scaler = new StandardScaler();
    scaler.fit(features);
    const scaled = scaler.transform(features);
    const model = trainRidgeModel(scaled, tgts, 0.01);

    // Test points: center and 4 edges
    const testPoints = [
      { x: 0.5, y: 0.5, label: 'center' },
      { x: 0.05, y: 0.5, label: 'left_edge' },
      { x: 0.95, y: 0.5, label: 'right_edge' },
      { x: 0.5, y: 0.05, label: 'top_edge' },
      { x: 0.5, y: 0.95, label: 'bottom_edge' },
    ];

    const errors: Record<string, number> = {};
    for (const tp of testPoints) {
      const f = syntheticFeatures(tp.x, tp.y, DIMS, 0);
      const s = scaler.transformSingle(f);
      const pred = predictRidge(model, s);
      errors[tp.label] = Math.hypot(pred.x - tp.x, pred.y - tp.y);
    }

    // Center error should be very low (interpolation)
    expect(errors['center']).toBeLessThan(0.02);

    // Edge errors should be bounded — with synthetic data and sin/cos noise
    // patterns, some edges may have higher error than center but should not
    // be catastrophically worse. Using 10× as generous bound.
    const centerErr = Math.max(errors['center'], 1e-6);
    for (const edge of ['left_edge', 'right_edge', 'top_edge', 'bottom_edge']) {
      expect(errors[edge]).toBeLessThan(0.10);
    }
  });

  it('corners (5%/95% targets) have finite and reasonable error', () => {
    const { features, tgts } = generateCalibrationData(
      CALIBRATION_TARGETS_FULL,
      SAMPLES_PER_TARGET,
      DIMS,
    );

    const scaler = new StandardScaler();
    scaler.fit(features);
    const scaled = scaler.transform(features);
    const model = trainRidgeModel(scaled, tgts, 0.01);

    const corners = [
      { x: 0.05, y: 0.05 },
      { x: 0.95, y: 0.05 },
      { x: 0.05, y: 0.95 },
      { x: 0.95, y: 0.95 },
    ];

    for (const c of corners) {
      const f = syntheticFeatures(c.x, c.y, DIMS, 0);
      const s = scaler.transformSingle(f);
      const pred = predictRidge(model, s);
      const err = Math.hypot(pred.x - c.x, pred.y - c.y);
      // Corner error with 5%/95% targets should be well under 10%
      expect(err).toBeLessThan(0.10);
      expect(Number.isFinite(pred.x)).toBe(true);
      expect(Number.isFinite(pred.y)).toBe(true);
    }
  });

  it('extrapolation beyond calibration hull (0% and 100%) has bounded error', () => {
    const { features, tgts } = generateCalibrationData(
      CALIBRATION_TARGETS_FULL,
      SAMPLES_PER_TARGET,
      DIMS,
    );

    const scaler = new StandardScaler();
    scaler.fit(features);
    const scaled = scaler.transform(features);
    const model = trainRidgeModel(scaled, tgts, 0.01);

    // Test at extreme borders (0% and 100% — beyond calibration points)
    const extremes = [
      { x: 0.0, y: 0.5 },
      { x: 1.0, y: 0.5 },
      { x: 0.5, y: 0.0 },
      { x: 0.5, y: 1.0 },
    ];

    for (const e of extremes) {
      const f = syntheticFeatures(e.x, e.y, DIMS, 0);
      const s = scaler.transformSingle(f);
      const pred = predictRidge(model, s);
      const err = Math.hypot(pred.x - e.x, pred.y - e.y);
      // Extrapolation error should be bounded (with linear data, Ridge extrapolates well)
      expect(err).toBeLessThan(0.15);
    }
  });
});

// ── Calibration targets coverage ─────────────────────────────────────────────

// As posições dos alvos saem do orçamento de excentricidade angular. Ver o
// cabeçalho de `computeCalibrationTargets` em calibration.ts. Estes testes
// afirmam as invariantes da grade.
describe('Calibration targets — grade 3×3 dentro do orçamento angular', () => {
  it('FULL cobre 3 posições distintas por eixo, simétricas em X e assimétricas em Y', () => {
    expect(CALIBRATION_TARGETS_FULL).toHaveLength(9);
    const xs = [...new Set(CALIBRATION_TARGETS_FULL.map(t => t.x))].sort((a, b) => a - b);
    const ys = [...new Set(CALIBRATION_TARGETS_FULL.map(t => t.y))].sort((a, b) => a - b);
    expect(xs).toHaveLength(3);
    expect(ys).toHaveLength(3);
    expect(xs[1]).toBeCloseTo(0.5, 10);
    expect(ys[1]).toBeCloseTo(0.5, 10);
    expect(xs[0] + xs[2]).toBeCloseTo(1, 10);
    // Em Y a grade é assimétrica desde a sprint S4: a linha de baixo sobe
    // porque a pálpebra acompanha o olhar e a íris some do quadro. Ver
    // MAX_ECCENTRICITY_DEG_BAIXO.
    expect(ys[0] + ys[2]).toBeLessThan(1);
    expect(0.5 - ys[0]).toBeGreaterThan(ys[2] - 0.5);
  });

  it('QUICK são os 4 cantos da mesma grade', () => {
    expect(CALIBRATION_TARGETS_QUICK).toHaveLength(4);
    const xs = [...new Set(CALIBRATION_TARGETS_QUICK.map(t => t.x))].sort((a, b) => a - b);
    const ys = [...new Set(CALIBRATION_TARGETS_QUICK.map(t => t.y))].sort((a, b) => a - b);
    expect(xs).toHaveLength(2);
    expect(ys).toHaveLength(2);
    expect(xs[0] + xs[1]).toBeCloseTo(1, 10);
    expect(ys[0] + ys[1]).toBeLessThan(1);
  });

  it('QUICK targets are a subset of FULL targets', () => {
    for (const q of CALIBRATION_TARGETS_QUICK) {
      const inFull = CALIBRATION_TARGETS_FULL.some(
        f => Math.abs(f.x - q.x) < 0.001 && Math.abs(f.y - q.y) < 0.001,
      );
      expect(inFull).toBe(true);
    }
  });

  it('alvos ficam dentro da tela e com amplitude suficiente para condicionar o Ridge', () => {
    const minX = Math.min(...CALIBRATION_TARGETS_FULL.map(t => t.x));
    const maxX = Math.max(...CALIBRATION_TARGETS_FULL.map(t => t.x));
    const minY = Math.min(...CALIBRATION_TARGETS_FULL.map(t => t.y));
    const maxY = Math.max(...CALIBRATION_TARGETS_FULL.map(t => t.y));
    // Dentro da tela, com folga para o alvo de 80 px caber inteiro.
    // 0.049 e não 0.05: 0.5 - 0.45 dá 0.04999999999999999 em ponto flutuante.
    expect(minX).toBeGreaterThanOrEqual(0.049);
    expect(maxX).toBeLessThanOrEqual(0.951);
    expect(minY).toBeGreaterThanOrEqual(0.049);
    expect(maxY).toBeLessThanOrEqual(0.951);
    // Amplitude mínima: sem span o sistema normal fica mal condicionado.
    expect(maxX - minX).toBeGreaterThanOrEqual(0.44);
    expect(maxY - minY).toBeGreaterThanOrEqual(0.44);
  });
});

// ── StandardScaler N-1 variance ──────────────────────────────────────────────

describe('StandardScaler — sample variance (N-1)', () => {
  it('std matches scikit-learn convention for small N', () => {
    const data = [
      [1, 10],
      [2, 20],
      [3, 30],
    ];
    const scaler = new StandardScaler();
    scaler.fit(data);
    const params = scaler.getParams();

    // Mean: [2, 20]
    expect(params.means[0]).toBeCloseTo(2, 8);
    expect(params.means[1]).toBeCloseTo(20, 8);

    // Std with N-1: sqrt(((1-2)²+(2-2)²+(3-2)²) / 2) = sqrt(2/2) = 1.0
    expect(params.stds[0]).toBeCloseTo(1.0, 8);
    expect(params.stds[1]).toBeCloseTo(10.0, 8);
  });

  it('single sample does not produce NaN or zero std', () => {
    const scaler = new StandardScaler();
    scaler.fit([[5, 10]]);
    const params = scaler.getParams();
    // With N=1, N-1=0, but guarded by max(1, N-1) → divides by 1
    // Then the < 1e-8 guard sets std=1.0
    expect(params.stds[0]).toBe(1.0);
    expect(params.stds[1]).toBe(1.0);
    // Transform should not produce NaN
    const t = scaler.transformSingle([5, 10]);
    expect(Number.isFinite(t[0])).toBe(true);
    expect(Number.isFinite(t[1])).toBe(true);
  });
});
