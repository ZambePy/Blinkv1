// Regressão Ridge Múltipla Linear (sem expansão polinomial)
// Recebe o vetor denso de features (53 dimensões) + Bias
// Sistema normal regularizado: (ΦᵀΦ + λI) β = Φᵀy

export interface RidgeModel {
  betaX: number[];  // coeficientes para predizer screenX
  betaY: number[];  // coeficientes para predizer screenY
  numFeatures: number;
}

// Eliminação gaussiana com pivotação parcial para resolver Aβ = b
function solveLinear(A: number[][], b: number[]): number[] {
  const n = A.length;
  const M: number[][] = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    [M[col], M[pivot]] = [M[pivot], M[col]];

    const d = M[col][col];
    if (Math.abs(d) < 1e-12) continue; // Singularity
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
    return { x: 0, y: 0 };
  }
  const f = [1.0, ...features];
  const clmp = (v: number) => Math.min(Math.max(v, 0), 1);
  
  let normX = 0;
  let normY = 0;
  for (let i = 0; i < f.length; i++) {
    normX += model.betaX[i] * f[i];
    normY += model.betaY[i] * f[i];
  }

  // Usa clientWidth/Height para considerar a viewport real do CSS
  return {
    x: clmp(normX) * document.documentElement.clientWidth,
    y: clmp(normY) * document.documentElement.clientHeight,
  };
}
