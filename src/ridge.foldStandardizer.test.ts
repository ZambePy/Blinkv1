import { describe, it, expect } from 'vitest';
import { __testingFoldStandardizer } from './ridge';

// `foldStandardizer` precisa produzir o desvio amostral exato: a soma de
// quadrados começa em zero (um `fill(1)` inflava σ de features pequenas em
// +60% e desativava a guarda de feature constante), e o Ridge só é
// invariante à escala com o padronizador correto.

/** σ amostral (n−1), a referência analítica. */
function desvioAmostral(valores: number[]): number {
  const n = valores.length;
  const media = valores.reduce((s, v) => s + v, 0) / n;
  const soma = valores.reduce((s, v) => s + (v - media) ** 2, 0);
  return Math.sqrt(soma / (n - 1));
}

/** Coluna com média `mu` e desvio `sigma` exatos, determinística. */
function coluna(n: number, mu: number, sigma: number): number[] {
  // Duas metades simétricas em torno de mu dão desvio populacional = sigma.
  // Reescalado para o desvio AMOSTRAL bater exatamente.
  const base: number[] = [];
  for (let i = 0; i < n; i++) base.push(i % 2 === 0 ? mu - 1 : mu + 1);
  const atual = desvioAmostral(base);
  return base.map((v) => mu + ((v - mu) * sigma) / atual);
}

describe('foldStandardizer produz o desvio amostral correto', () => {
  it('σ = 1,0 é recuperado dentro de 1e-9', () => {
    const n = 240;
    const col = coluna(n, 0, 1.0);
    const rows = col.map((v) => [v]);
    const std = __testingFoldStandardizer(rows);
    expect(std.stds[0]).toBeCloseTo(1.0, 9);
  });

  it('σ = 0,05 é recuperado — o caso que errava 63%', () => {
    // Este é o número do relatório. Com o bug: 0,0818 no lugar de 0,0501.
    const n = 240;
    const col = coluna(n, 0, 0.05);
    const rows = col.map((v) => [v]);
    const std = __testingFoldStandardizer(rows);
    expect(std.stds[0]).toBeCloseTo(0.05, 9);
    // E longe do valor bugado, para o teste não passar por acidente.
    expect(Math.abs(std.stds[0] - 0.0818)).toBeGreaterThan(0.02);
  });

  it('bate com o desvio amostral calculado independentemente, em várias escalas', () => {
    for (const sigma of [0.001, 0.01, 0.05, 0.5, 1, 10, 100]) {
      const col = coluna(200, 3, sigma);
      const std = __testingFoldStandardizer(col.map((v) => [v]));
      expect(std.stds[0]).toBeCloseTo(desvioAmostral(col), 8);
    }
  });

  it('a média é preservada', () => {
    const col = coluna(100, 7.5, 2);
    const std = __testingFoldStandardizer(col.map((v) => [v]));
    expect(std.means[0]).toBeCloseTo(7.5, 9);
  });
});

describe('a guarda de feature constante volta a funcionar', () => {
  it('feature constante recebe σ = 1, não 0,065', () => {
    // Efeito (b). Com o bug, `v` mínimo era sqrt(1/(n−1)) ≈ 0,065, então o
    // piso `v > 1e-8 ? v : 1` nunca disparava e a feature constante era
    // dividida por 0,065 — inflando-a ~15×.
    const n = 240;
    const rows = Array.from({ length: n }, () => [7.0]);
    const std = __testingFoldStandardizer(rows);
    expect(std.stds[0]).toBe(1);
  });

  it('feature constante padronizada vira exatamente zero, não um valor grande', () => {
    const rows = Array.from({ length: 240 }, () => [7.0]);
    const std = __testingFoldStandardizer(rows);
    expect(std.apply([7.0])[0]).toBe(0);
  });

  it('feature com variação abaixo do epsilon também cai no piso', () => {
    const rows = Array.from({ length: 100 }, (_, i) => [1 + i * 1e-12]);
    const std = __testingFoldStandardizer(rows);
    expect(std.stds[0]).toBe(1);
  });
});

describe('invariância à escala, que é o ponto do padronizador', () => {
  it('multiplicar uma coluna por k não muda a saída padronizada', () => {
    // A propriedade que o bug destruía. Sem ela, o λ escolhido pelo CV
    // corresponde a um problema com condicionamento diferente do ajuste final.
    const col = coluna(150, 2, 0.05);
    const k = 1000;

    const a = __testingFoldStandardizer(col.map((v) => [v]));
    const b = __testingFoldStandardizer(col.map((v) => [v * k]));

    for (let i = 0; i < col.length; i += 17) {
      expect(b.apply([col[i] * k])[0]).toBeCloseTo(a.apply([col[i]])[0], 8);
    }
  });

  it('colunas de escalas muito diferentes saem com o mesmo desvio', () => {
    // Duas features, σ = 0,05 e σ = 50. Depois de padronizar, ambas têm
    // desvio 1 — é isso que torna a penalidade do Ridge comparável entre elas.
    const n = 200;
    const c1 = coluna(n, 0, 0.05);
    const c2 = coluna(n, 100, 50);
    const rows = c1.map((v, i) => [v, c2[i]]);
    const std = __testingFoldStandardizer(rows);

    const z1 = rows.map((r) => std.apply(r)[0]);
    const z2 = rows.map((r) => std.apply(r)[1]);
    expect(desvioAmostral(z1)).toBeCloseTo(1, 6);
    expect(desvioAmostral(z2)).toBeCloseTo(1, 6);
  });
});
