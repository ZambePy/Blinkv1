import { describe, it, expect } from 'vitest';
import { OneEuroFilter } from './oneEuroFilter';

describe('OneEuroFilter — auditoria E8 ponto 1 (te = Δt real)', () => {
  it('output reproduz posição estática independente da frequência', () => {
    // Alimentar o mesmo valor várias vezes deve convergir para esse valor,
    // qualquer que seja o Δt. Sanity check básico.
    const f = new OneEuroFilter(60, 0.1, 1.0);
    let out = 0;
    for (let i = 0; i < 30; i++) out = f.filter(42, i / 30);
    expect(out).toBeCloseTo(42, 1);
  });

  it('output diverge com Δt real — dx e x ambos honram a frequência instantânea (regressão E8 ponto 1)', () => {
    // Pré-fix, o dx era criado uma vez com alpha derivado de freq=60
    // (constructor) e nunca atualizado. A estimativa de velocidade `edvalue`
    // ficava insensível ao Δt real, colapsando parcialmente o mecanismo do
    // One Euro que aumenta cutoff em movimento rápido. Após o fix, dx.alpha
    // é recomputado todo frame, simétrico com x.
    //
    // Alimenta a MESMA sequência (rampa 0..10) em dois filtros idênticos,
    // com timestamps a 30 Hz vs 120 Hz. Os outputs devem DIVERGIR
    // substancialmente entre frames correspondentes — se dx-alpha fosse
    // fixa (bug), essa divergência ficaria bem menor.
    const mkFilter = () => new OneEuroFilter(60, 0.001, 5.0);

    const runAt = (rateHz: number): number[] => {
      const f = mkFilter();
      const outs: number[] = [];
      for (let i = 0; i < 12; i++) {
        outs.push(f.filter(i, i / rateHz));
      }
      return outs;
    };

    const s30 = runAt(30);
    const s120 = runAt(120);

    // Divergência substancial em pelo menos um frame após o warm-up
    let maxAbsDiff = 0;
    for (let i = 2; i < 12; i++) {
      const d = Math.abs(s30[i] - s120[i]);
      if (d > maxAbsDiff) maxAbsDiff = d;
    }
    expect(maxAbsDiff).toBeGreaterThan(0.1);

    // Sanity: outputs finitos, monotonicamente crescentes na rampa
    for (let i = 1; i < 12; i++) {
      expect(Number.isFinite(s30[i])).toBe(true);
      expect(Number.isFinite(s120[i])).toBe(true);
      expect(s30[i]).toBeGreaterThanOrEqual(s30[i - 1] - 1e-9);
      expect(s120[i]).toBeGreaterThanOrEqual(s120[i - 1] - 1e-9);
    }
  });

  it('não gera NaN nem Infinity para inputs numéricos válidos', () => {
    const f = new OneEuroFilter(60, 0.02, 1.5);
    for (let i = 0; i < 50; i++) {
      const v = Math.sin(i * 0.1) * 1000;
      const o = f.filter(v, i / 30);
      expect(Number.isFinite(o)).toBe(true);
    }
  });
});
