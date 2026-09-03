import { describe, it, expect } from 'vitest';
import { __testingFoldStandardizer } from './ridge';

// -----------------------------------------------------------------------------
// B2.7 — `foldStandardizer` acumula soma de quadrados a partir de 1.
//
//   const std = new Array<number>(d).fill(1);   // deveria ser fill(0)
//   for (const r of rows) for (let j = 0; j < d; j++) std[j] += (r[j] - mean[j]) ** 2;
//
// Resulta em `σ̂ = sqrt((1 + Σ(x−μ)²)/(n−1))` em vez de `sqrt(Σ(x−μ)²/(n−1))`.
// Medido com n=240 no relatório do plano:
//
//   | feature        | σ verdadeiro | foldStandardizer |
//   | σ = 1,0        | 1,0021       | 1,0042           |
//   | σ = 0,05       | 0,0501       | 0,0818 (+63%)    |
//   | constante (7,0)| 1,0 (guarda) | 0,0647           |
//
// Dois efeitos:
//
//  (a) O Ridge deixa de ser invariante à escala, então o **λ escolhido pelo CV
//      corresponde a um problema com condicionamento diferente do ajuste
//      final**. O eixo Y — que `calibration.ts` documenta como tendo sinal 6×
//      atenuado — é o mais afetado, porque suas features têm σ menor.
//
//  (b) O piso `v > 1e-8 ? v : 1` **nunca dispara**, porque o mínimo de `v`
//      passa a ser `sqrt(1/(n−1)) ≈ 0,065`. A proteção contra desvio-padrão
//      zero fica desativada nesse caminho: uma feature constante é dividida
//      por 0,065 em vez de por 1, inflando-a ~15×.
//
// Este bug é pré-requisito de `P6.6`: comparar LOOCV com LOTO sobre um λ
// escolhido com condicionamento errado não mediria a diferença entre os dois
// esquemas de validação.
// -----------------------------------------------------------------------------

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

describe('B2.7 — foldStandardizer produz o desvio amostral correto', () => {
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

describe('B2.7 — a guarda de feature constante volta a funcionar', () => {
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

describe('B2.7 — invariância à escala, que é o ponto do padronizador', () => {
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
