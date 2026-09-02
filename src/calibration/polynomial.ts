/**
 * Expansão polinomial de grau 2 para uso no Ridge.
 *
 * Motivação: baseline mostra 77% do erro é não-linear (affine.explainedFraction=0.226).
 * Ridge linear tem teto matemático. Expandir features permite ao mesmo Ridge
 * capturar curvatura.
 *
 * Layout de saída para d entradas [x₁, ..., x_d]:
 *   [x₁, ..., x_d,           ← d originais
 *    x₁², x₁·x₂, ..., x₁·x_d,  ← linha 1 da triangular superior
 *    x₂², x₂·x₃, ..., x₂·x_d,
 *    ...
 *    x_d²]
 *
 * Dimensão total: d + d·(d+1)/2 = d·(d+3)/2.
 *
 * StandardScaler é aplicado DEPOIS desta expansão. Escalar antes destruiria
 * a relação entre x e x² (a escala da quadrática é diferente da linear).
 */

export function expandPolynomialFeatures(x: readonly number[], degree: 2 = 2): number[] {
  void degree; // grau 2 fixo por ora; parâmetro reservado para futuro
  const d = x.length;
  if (d === 0) return [];
  const out: number[] = new Array(d + (d * (d + 1)) / 2);
  // Originais
  for (let i = 0; i < d; i++) out[i] = x[i];
  // Triangular superior (produtos + quadrados)
  let k = d;
  for (let i = 0; i < d; i++) {
    for (let j = i; j < d; j++) {
      out[k++] = x[i] * x[j];
    }
  }
  return out;
}

export function expandedDimension(d: number, degree: 2 = 2): number {
  void degree;
  if (d <= 0) return 0;
  return d + (d * (d + 1)) / 2;
}
