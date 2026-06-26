// Ridge Regression polinomial de 3ª ordem para mapeamento do olhar
// Upgrade: 2ª ordem (6 features) → 3ª ordem (10 features)
// Feature vector: φ(x, y) = [1, x, y, x², y², xy, x³, y³, x²y, xy²] → 10 coeficientes por eixo
// O grau cúbico captura melhor a distorção não-linear nos cantos e bordas da tela.
// Sistema normal regularizado: (ΦᵀΦ + λI) β = Φᵀy   (λ = 0.3)

export interface RidgeModel {
  betaX: number[];  // 10 coeficientes para predizer screenX
  betaY: number[];  // 10 coeficientes para predizer screenY
}

function phi(x: number, y: number): number[] {
  const x2 = x * x;
  const y2 = y * y;
  return [1, x, y, x2, y2, x * y, x2 * x, y2 * y, x2 * y, x * y2];
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
    if (Math.abs(d) < 1e-12) continue;
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
  profile: { rawX: number; rawY: number; screenX: number; screenY: number }[],
  lambda = 0.3
): RidgeModel {
  const nf  = 10;
  const Phi = profile.map(p => phi(p.rawX, p.rawY));
  const m   = profile.length;

  // A = ΦᵀΦ + λI
  const A: number[][] = Array.from({ length: nf }, (_, i) =>
    Array.from({ length: nf }, (_, j) => {
      let s = 0;
      for (let k = 0; k < m; k++) s += Phi[k][i] * Phi[k][j];
      return s + (i === j ? lambda : 0);
    })
  );

  // b = Φᵀy  (para screenX e screenY separadamente)
  const bX = Array.from({ length: nf }, (_, i) => {
    let s = 0;
    for (let k = 0; k < m; k++) s += Phi[k][i] * profile[k].screenX;
    return s;
  });
  const bY = Array.from({ length: nf }, (_, i) => {
    let s = 0;
    for (let k = 0; k < m; k++) s += Phi[k][i] * profile[k].screenY;
    return s;
  });

  return { betaX: solveLinear(A, bX), betaY: solveLinear(A, bY) };
}

export function predictRidge(
  model: RidgeModel,
  rawX: number,
  dy: number
): { x: number; y: number } {
  const f    = phi(rawX, dy);
  const clmp = (v: number) => Math.min(Math.max(v, 0), 1);
  const normX = f.reduce((s, v, i) => s + model.betaX[i] * v, 0);
  const normY = f.reduce((s, v, i) => s + model.betaY[i] * v, 0);
  // Usa clientWidth/Height para considerar a viewport real do CSS (sem scrollbars)
  return {
    x: clmp(normX) * document.documentElement.clientWidth,
    y: clmp(normY) * document.documentElement.clientHeight,
  };
}
