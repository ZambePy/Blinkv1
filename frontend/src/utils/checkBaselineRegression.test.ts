import { describe, it, expect } from 'vitest';
// @ts-expect-error — script .mjs sem tipos; Vitest resolve via esbuild
import { decideRegression } from '../../scripts/checkBaselineDecision.mjs';

// D8.1 (ROADMAP §5) — o gate de regressão de precisão vive num script .mjs
// invocado pelo CI. A lógica de decisão foi isolada em `decideRegression`
// (função pura) para poder ser testada sem depender de I/O de relatório.
//
// O que estes testes protegem:
//   (i)   verdict='ok' quando current está dentro da tolerância;
//   (ii)  verdict='ok' quando current MELHORA (delta negativo);
//   (iii) verdict='regression' quando current > baseline * (1 + tol/100);
//   (iv)  boundary condition — exatamente no limite NÃO regride
//         (regressão exige estritamente maior);
//   (v)   entradas inválidas viram 'invalid' sem crashar (defensivo — se
//         o measure_baseline algum dia mudar o schema, o CI falha com
//         mensagem clara em vez de exception).

describe('decideRegression (D8.1)', () => {
  it('OK quando current == baseline (delta 0%)', () => {
    const r = decideRegression({ baselineMean: 57, currentMean: 57, tolerancePct: 15 });
    expect(r.verdict).toBe('ok');
    expect(r.deltaPct).toBe(0);
  });

  it('OK quando current dentro da tolerância (+10% com tol=15%)', () => {
    const r = decideRegression({ baselineMean: 57, currentMean: 57 * 1.10, tolerancePct: 15 });
    expect(r.verdict).toBe('ok');
    expect(r.deltaPct).toBeCloseTo(10, 5);
  });

  it('OK quando current melhora (delta negativo)', () => {
    const r = decideRegression({ baselineMean: 57, currentMean: 50, tolerancePct: 15 });
    expect(r.verdict).toBe('ok');
    expect(r.deltaPct).toBeLessThan(0);
  });

  it('OK exatamente no limite (current == baseline * (1 + tol/100))', () => {
    const baseline = 57;
    const tolerancePct = 15;
    const current = baseline * (1 + tolerancePct / 100); // exatamente 65.55
    const r = decideRegression({ baselineMean: baseline, currentMean: current, tolerancePct });
    // Boundary: exatamente igual ao threshold NÃO é regressão (comparação estrita >)
    expect(r.verdict).toBe('ok');
  });

  it('REGRESSÃO acima do limite (+16% com tol=15%)', () => {
    const r = decideRegression({ baselineMean: 57, currentMean: 57 * 1.16, tolerancePct: 15 });
    expect(r.verdict).toBe('regression');
    expect(r.deltaPct).toBeCloseTo(16, 1);
  });

  it('REGRESSÃO grande (+50%)', () => {
    const r = decideRegression({ baselineMean: 57, currentMean: 57 * 1.5, tolerancePct: 15 });
    expect(r.verdict).toBe('regression');
  });

  it('tolerância 0% — qualquer aumento vira regressão', () => {
    const r = decideRegression({ baselineMean: 57, currentMean: 57.01, tolerancePct: 0 });
    expect(r.verdict).toBe('regression');
  });

  it('baseline inválido (NaN) → invalid, sem crash', () => {
    const r = decideRegression({ baselineMean: NaN, currentMean: 60, tolerancePct: 15 });
    expect(r.verdict).toBe('invalid');
  });

  it('baseline inválido (0) → invalid (evita divisão por zero silenciosa)', () => {
    const r = decideRegression({ baselineMean: 0, currentMean: 60, tolerancePct: 15 });
    expect(r.verdict).toBe('invalid');
  });

  it('current inválido (NaN) → invalid', () => {
    const r = decideRegression({ baselineMean: 57, currentMean: NaN, tolerancePct: 15 });
    expect(r.verdict).toBe('invalid');
  });

  it('current negativo → invalid (measure_baseline nunca produz erro negativo)', () => {
    const r = decideRegression({ baselineMean: 57, currentMean: -1, tolerancePct: 15 });
    expect(r.verdict).toBe('invalid');
  });
});
