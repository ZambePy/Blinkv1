/**
 * Expansão polinomial de grau 2 para uso no Ridge.
 *
 * O Ridge linear tem teto matemático; a maior parte do erro residual do
 * baseline era não-linear, e expandir as features deixa o mesmo Ridge capturar
 * curvatura.
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
 * O StandardScaler é aplicado DEPOIS desta expansão. Escalar antes destruiria
 * a relação entre x e x² (a escala da quadrática é diferente da linear).
 */
export function expandPolynomialFeatures(x: readonly number[]): number[] {
  const d = x.length;
  if (d === 0) return [];
  const out: number[] = new Array(d + (d * (d + 1)) / 2);
  for (let i = 0; i < d; i++) out[i] = x[i];
  let k = d;
  for (let i = 0; i < d; i++) {
    for (let j = i; j < d; j++) {
      out[k++] = x[i] * x[j];
    }
  }
  return out;
}
