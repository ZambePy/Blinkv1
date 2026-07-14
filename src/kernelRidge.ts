// Kernel Ridge Regression com kernel RBF.
//
// Matemática (por eixo — X e Y independentes):
//   K_ij = exp(-gamma * ||xi - xj||²)
//   Treino:  alpha = (K + lambda*I)^-1 * (y - mean(y))
//   Predição: yhat(x) = mean(y) + sum_i alpha_i * K(x, xi)
//
// A centralização pelos alvos faz a predição convergir para mean(y) conforme
// o vetor de entrada se afasta de todos os pontos de suporte.
//
// Hiperparâmetros (gamma, lambda) selecionados por leave-one-POINT-out CV.

import type { GazeRegressor } from './gazeRegressor';
import { solveLinear } from './ridge';

// ─── Tipos públicos ────────────────────────────────────────────────────────────

export interface KernelRidgeModel {
  supportVectors: number[][];
  alphaX:         number[];
  alphaY:         number[];
  biasX:          number;
  biasY:          number;
  gamma:          number;
  lambda:         number;
  numFeatures:    number;
}

// ─── Grid de hiperparâmetros ───────────────────────────────────────────────────

const GAMMA_GRID  = [0.01, 0.05, 0.1, 0.5, 1.0, 5.0] as const;
const LAMBDA_GRID = [0.001, 0.01, 0.1, 0.5] as const;

// ─── Kernel RBF ───────────────────────────────────────────────────────────────

function sqDist(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return s;
}

export function buildKernelMatrix(X: number[][], gamma: number): number[][] {
  const n = X.length;
  const K: number[][] = Array.from({ length: n }, () => new Array<number>(n));
  for (let i = 0; i < n; i++) {
    K[i][i] = 1.0;
    for (let j = i + 1; j < n; j++) {
      const k  = Math.exp(-gamma * sqDist(X[i], X[j]));
      K[i][j]  = k;
      K[j][i]  = k;
    }
  }
  return K;
}

function kernelVec(x: number[], X: number[][], gamma: number): number[] {
  return X.map(xi => Math.exp(-gamma * sqDist(x, xi)));
}

// ─── Treino por eixo ──────────────────────────────────────────────────────────

function arrMean(v: number[]): number {
  return v.reduce((s, x) => s + x, 0) / v.length;
}

function trainAxis(
  K: number[][],
  y: number[],
  lambda: number,
): { alpha: number[]; bias: number } {
  const bias = arrMean(y);
  const yc   = y.map(yi => yi - bias);
  // (K + lambda*I) alpha = yc
  const A = K.map((row, i) => row.map((v, j) => v + (i === j ? lambda : 0)));
  return { alpha: solveLinear(A, yc), bias };
}

function dotBias(alpha: number[], bias: number, kv: number[]): number {
  let s = bias;
  for (let i = 0; i < alpha.length; i++) s += alpha[i] * kv[i];
  return s;
}

// ─── LOO-CV (Leave-One-Point-Out) ─────────────────────────────────────────────

interface KRGroup {
  indices: number[];
}

function getPointGroups(tgtsX: number[], tgtsY: number[]): KRGroup[] {
  const map = new Map<string, KRGroup>();
  for (let i = 0; i < tgtsX.length; i++) {
    const key = `${tgtsX[i].toFixed(4)},${tgtsY[i].toFixed(4)}`;
    if (!map.has(key)) map.set(key, { indices: [] });
    map.get(key)!.indices.push(i);
  }
  return Array.from(map.values());
}

export function looError(
  K:        number[][],
  tgtsX:    number[],
  tgtsY:    number[],
  lambda:   number,
): number {
  const groups = getPointGroups(tgtsX, tgtsY);
  if (groups.length < 2) return Infinity;

  let total = 0;

  for (let lo = 0; lo < groups.length; lo++) {
    const testIdx = groups[lo].indices;
    const trIdx: number[] = [];
    for (let i = 0; i < groups.length; i++) {
      if (i !== lo) trIdx.push(...groups[i].indices);
    }

    const Ktr = trIdx.map(i => trIdx.map(j => K[i][j]));
    const trTgtsX = trIdx.map(i => tgtsX[i]);
    const trTgtsY = trIdx.map(i => tgtsY[i]);

    const { alpha: aX, bias: bX } = trainAxis(Ktr, trTgtsX, lambda);
    const { alpha: aY, bias: bY } = trainAxis(Ktr, trTgtsY, lambda);

    for (const testI of testIdx) {
      const kv = trIdx.map(i => K[testI][i]);
      total += (dotBias(aX, bX, kv) - tgtsX[testI]) ** 2
             + (dotBias(aY, bY, kv) - tgtsY[testI]) ** 2;
    }
  }
  return total;
}

// ─── Classe ───────────────────────────────────────────────────────────────────

export class KernelRidgeRegressor implements GazeRegressor {
  private model: KernelRidgeModel | null;

  constructor(model?: KernelRidgeModel) {
    this.model = model ?? null;
  }

  train(features: number[][], targetsX: number[], targetsY: number[]): void {
    const n = features.length;
    if (n < 2) throw new Error('KernelRidgeRegressor requer pelo menos 2 pontos de calibração');

    const t0 = performance.now();

    let bestGamma: number  = GAMMA_GRID[0];
    let bestLambda: number = LAMBDA_GRID[0];
    let bestErr            = Infinity;

    for (const gamma of GAMMA_GRID) {
      const K = buildKernelMatrix(features, gamma);
      for (const lambda of LAMBDA_GRID) {
        const err = looError(K, targetsX, targetsY, lambda);
        if (err < bestErr) {
          bestErr    = err;
          bestGamma  = gamma;
          bestLambda = lambda;
        }
      }
    }

    // Treino final em todos os dados com os melhores hiperparâmetros
    const K = buildKernelMatrix(features, bestGamma);
    const { alpha: alphaX, bias: biasX } = trainAxis(K, targetsX, bestLambda);
    const { alpha: alphaY, bias: biasY } = trainAxis(K, targetsY, bestLambda);

    const elapsed = performance.now() - t0;
    console.log(
      `[kernelRidge] treino concluído em ${elapsed.toFixed(1)} ms — ` +
      `n=${n} gamma=${bestGamma} lambda=${bestLambda} looErr=${bestErr.toFixed(4)}`,
    );

    this.model = {
      supportVectors: features.map(f => [...f]),
      alphaX,
      alphaY,
      biasX,
      biasY,
      gamma:       bestGamma,
      lambda:      bestLambda,
      numFeatures: features[0].length,
    };
  }

  predict(features: number[]): { x: number; y: number } {
    if (!this.model) return { x: 0, y: 0 };
    const m = this.model;
    if (features.length !== m.numFeatures) return { x: 0, y: 0 };

    const kv   = kernelVec(features, m.supportVectors, m.gamma);
    const clmp = (v: number) => Math.min(Math.max(v, 0), 1);

    return {
      x: clmp(dotBias(m.alphaX, m.biasX, kv)) * document.documentElement.clientWidth,
      y: clmp(dotBias(m.alphaY, m.biasY, kv)) * document.documentElement.clientHeight,
    };
  }

  getModel(): KernelRidgeModel | null {
    return this.model;
  }
}
