// Regressão Ridge Múltipla Linear (sem expansão polinomial)
// Recebe o vetor de features por olho (~31 dims com USE_COMPACT_FEATURES=true,
// ou 260 dims com o extractor completo) + Bias implícito no índice 0.
// Sistema normal regularizado: (ΦᵀΦ + λI) β = Φᵀy
// A regularização não penaliza o termo de bias (linha/coluna 0 excluída da
// diagonal), e λ é escolhido por CV leave-one-target-out em RidgeRegressor.train.
// predictRidge retorna coordenadas normalizadas [0,1]; a conversão para pixels
// é responsabilidade da camada de UI.

export interface RidgeModel {
  betaX: number[];  // coeficientes para predizer screenX
  betaY: number[];  // coeficientes para predizer screenY
  numFeatures: number;
}

// Eliminação gaussiana com pivotação parcial para resolver Aβ = b
export function solveLinear(A: number[][], b: number[]): number[] {
  const n = A.length;
  const M: number[][] = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    [M[col], M[pivot]] = [M[pivot], M[col]];

    const d = M[col][col];
    if (Math.abs(d) < 1e-12) {
      throw new Error(`Matriz singular na coluna ${col}. O sistema não pode ser resolvido.`);
    }
    for (let j = col; j <= n; j++) M[col][j] /= d;

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let j = col; j <= n; j++) M[r][j] -= f * M[col][j];
    }
  }

  return M.map(row => row[n]);
}

export function trainRidgeModel(
  features: number[][],
  targets: { screenX: number; screenY: number }[],
  lambda = 1.0
): RidgeModel {
  const m = features.length;
  if (m === 0) return { betaX: [], betaY: [], numFeatures: 0 };
  
  const rawFeatures = features[0].length;
  const nf = rawFeatures + 1; // +1 para o Bias term

  // Prepara matriz Phi com Bias
  const Phi = features.map(f => [1.0, ...f]);

  // A = ΦᵀΦ + λI
  const A: number[][] = Array.from({ length: nf }, (_, i) =>
    Array.from({ length: nf }, (_, j) => {
      let s = 0;
      for (let k = 0; k < m; k++) s += Phi[k][i] * Phi[k][j];
      // Regulariza a diagonal (exceto o Bias term no índice 0)
      return s + (i === j && i > 0 ? lambda : 0);
    })
  );

  // b = Φᵀy  (para screenX e screenY separadamente)
  const bX = Array.from({ length: nf }, (_, i) => {
    let s = 0;
    for (let k = 0; k < m; k++) s += Phi[k][i] * targets[k].screenX;
    return s;
  });
  
  const bY = Array.from({ length: nf }, (_, i) => {
    let s = 0;
    for (let k = 0; k < m; k++) s += Phi[k][i] * targets[k].screenY;
    return s;
  });

  return { 
    betaX: solveLinear(A, bX), 
    betaY: solveLinear(A, bY),
    numFeatures: rawFeatures 
  };
}

export function predictRidge(
  model: RidgeModel,
  features: number[]
): { x: number; y: number } {
  if (features.length !== model.numFeatures) {
    throw new RangeError(
      `[ridge] dimensão incompatível: modelo treinado com ${model.numFeatures} features, ` +
      `recebeu ${features.length}. Causa provável: calibração feita com o bloco L2CS ` +
      `ativo (44 dims/olho) e inferência sem ele (37 dims), ou vice-versa. ` +
      `Recalibre com o worker L2CS em estado 'ready'.`
    );
  }
  const f = [1.0, ...features];

  let normX = 0;
  let normY = 0;
  for (let i = 0; i < f.length; i++) {
    normX += model.betaX[i] * f[i];
    normY += model.betaY[i] * f[i];
  }

  // Retorna coordenadas normalizadas SEM clamp.
  // O clamp é aplicado APÓS a média binocular em `mapGaze` (Sprint 1.2). Fazer
  // clamp aqui, por olho, distorce a média binocular quando um olho satura na
  // borda: se o olho direito prevê x=1.05 e o esquerdo prevê x=0.9, a média
  // correta seria ~0.975; com clamp por olho vira (1.0+0.9)/2 = 0.95, puxando
  // o cursor para dentro da tela.
  return {
    x: normX,
    y: normY,
  };
}

export class RidgeRegressor {
  private model: RidgeModel | null;

  constructor(model?: RidgeModel) {
    this.model = model ?? null;
  }

  train(features: number[][], targetsX: number[], targetsY: number[]): void {
    const targets = targetsX.map((x, i) => ({ screenX: x, screenY: targetsY[i] }));
    const lambdas = [1e-4, 1e-3, 1e-2, 0.1, 1, 10, 100, 1000];
    const bestLambda = this.selectLambdaCV(features, targets, lambdas);
    this.model = trainRidgeModel(features, targets, bestLambda);
  }

  private selectLambdaCV(
    features: number[][],
    targets: { screenX: number; screenY: number }[],
    lambdas: number[]
  ): number {
    const targetsUnique: string[] = [];
    const groups: { [key: string]: number[] } = {};
    
    for (let i = 0; i < targets.length; i++) {
      const key = `${targets[i].screenX.toFixed(4)},${targets[i].screenY.toFixed(4)}`;
      if (!groups[key]) {
        groups[key] = [];
        targetsUnique.push(key);
      }
      groups[key].push(i);
    }

    if (targetsUnique.length < 2) return 1.0;

    let bestLambda = lambdas[0];
    let minError = Infinity;

    for (const lambda of lambdas) {
      let totalError = 0;
      for (const key of targetsUnique) {
        const trainFeatures: number[][] = [];
        const trainTargets: { screenX: number; screenY: number }[] = [];
        const testFeatures: number[][] = [];
        const testTargets: { screenX: number; screenY: number }[] = [];

        for (let i = 0; i < features.length; i++) {
          const k = `${targets[i].screenX.toFixed(4)},${targets[i].screenY.toFixed(4)}`;
          if (k === key) {
            testFeatures.push(features[i]);
            testTargets.push(targets[i]);
          } else {
            trainFeatures.push(features[i]);
            trainTargets.push(targets[i]);
          }
        }

        try {
          const model = trainRidgeModel(trainFeatures, trainTargets, lambda);
          for (let i = 0; i < testFeatures.length; i++) {
            const pred = predictRidge(model, testFeatures[i]);
            const dx = pred.x - testTargets[i].screenX;
            const dy = pred.y - testTargets[i].screenY;
            totalError += dx * dx + dy * dy;
          }
        } catch (e) {
          totalError += Infinity;
        }
      }

      if (totalError < minError) {
        minError = totalError;
        bestLambda = lambda;
      }
    }

    console.log(`[ridge] CV Lambda selecionado: ${bestLambda} (erro: ${minError.toFixed(4)})`);
    return bestLambda;
  }

  predict(features: number[]): { x: number; y: number } {
    if (!this.model) return { x: 0, y: 0 };
    return predictRidge(this.model, features);
  }

  getModel(): RidgeModel | null {
    return this.model;
  }
}

