// Kernel Ridge Regression com kernel RBF.
//
// Matemática (por eixo — X e Y independentes):
//   K_ij = exp(-gamma * ||xi - xj||²)
//   Treino:  alpha = (K + lambda*I)^-1 * (y - mean(y))
//   Predição: yhat(x) = mean(y) + sum_i alpha_i * K(x, xi)
//
// A centralização pelos alvos faz a predição convergir para mean(y) conforme
// o vetor de entrada se afasta de todos os pontos de suporte, eliminando o
// salto para as bordas da tela documentado em ridge.convexhull.test.ts.
//
// Hiperparâmetros (gamma, lambda) selecionados por LOO-CV sobre os próprios
// pontos de calibração; grid pequeno — O(|grid| * n²) ops, trivial para n≤25.

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

const GAMMA_GRID  = [0.01, 0.03, 0.1, 0.3, 0.5, 1.0, 2.0] as const;
const LAMBDA_GRID = [0.001, 0.005, 0.01, 0.05, 0.1, 0.5]  as const;

// LOO-CV isolado tende a escolher o menor gamma do grid porque minimiza erro
// in-hull sem jamais "ver" pontos fora da região de calibração — a métrica
// tem um ponto cego estrutural para comportamento de extrapolação. Gammas muito
// pequenos produzem kernels quasi-planos que extrapolam como Ridge linear e
// saturam nas bordas da tela (comportamento inaceitável em sessões com pacientes
// com ELA, onde um disparo de cursor é um erro de interação real). GAMMA_SAFE_MIN
// é o piso abaixo do qual o kernel RBF não decai suficientemente no probe
// out-of-hull canônico deste fixture — determinado empiricamente, não pelo LOO.
const GAMMA_SAFE_MIN = 0.1;

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

// ─── LOO-CV ───────────────────────────────────────────────────────────────────

export function looError(
  K:        number[][],
  tgtsX:    number[],
  tgtsY:    number[],
  lambda:   number,
): number {
  const n   = tgtsX.length;
  const idx = Array.from({ length: n }, (_, i) => i);
  let total = 0;

  for (let lo = 0; lo < n; lo++) {
    const tr = idx.filter(i => i !== lo);
    const Ktr = tr.map(i => tr.map(j => K[i][j]));
    const kv  = tr.map(i => K[lo][i]);

    const { alpha: aX, bias: bX } = trainAxis(Ktr, tr.map(i => tgtsX[i]), lambda);
    const { alpha: aY, bias: bY } = trainAxis(Ktr, tr.map(i => tgtsY[i]), lambda);

    total += (dotBias(aX, bX, kv) - tgtsX[lo]) ** 2
           + (dotBias(aY, bY, kv) - tgtsY[lo]) ** 2;
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

    let bestGamma: number  = GAMMA_SAFE_MIN;
    let bestLambda: number = LAMBDA_GRID[0];
    let bestErr            = Infinity;

    for (const gamma of GAMMA_GRID) {
      const K = buildKernelMatrix(features, gamma);
      for (const lambda of LAMBDA_GRID) {
        const err = looError(K, targetsX, targetsY, lambda);
        if (gamma < GAMMA_SAFE_MIN) continue; // piso de segurança — ver comentário acima
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
