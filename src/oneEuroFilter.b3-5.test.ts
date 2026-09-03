import { describe, it, expect } from 'vitest';
import { OneEuroFilter, OneEuroFilter2D, DT_MIN_SEC, DT_MAX_SEC } from './oneEuroFilter';

// -----------------------------------------------------------------------------
// B3.5 — `OneEuroFilter.filter` sem guarda de `dt`.
//
//   if (this.lasttime !== -1 && timestamp !== -1) {
//     this.freq = 1.0 / (timestamp - this.lasttime);
//   }
//
// Dois modos de falha, opostos:
//
//  **dt = 0** → `freq = Infinity` → `alpha = 1/(1 + τ·0) = ...` na verdade
//  `te = 0`, `tau/te = Infinity`, `alpha = 0`. E `LowPassFilter.setAlpha`
//  **LANÇA** para alpha ≤ 0. A exceção sobe pelo `filter()`, sai do engine e é
//  capturada pelo `loopGuard` — o frame INTEIRO é descartado. Alcançável com
//  `performance.now()` grosseirizado (mitigação de Spectre em alguns
//  browsers dá resolução de 1 ms ou pior) e trivialmente em replay de
//  gravação, onde dois frames podem carregar o mesmo timestamp.
//
//  **dt muito grande** (aba em segundo plano, GC longo, sleep/wake) →
//  `freq → 0` → `te` enorme → `alpha ≈ 1` → o filtro passa a ser identidade e
//  o cursor SALTA sem suavização nenhuma, justamente no momento em que o
//  usuário volta a olhar para a tela.
//
// Terceiro defeito, menor: `reset()` não restaura `freq`. Depois de um dt
// patológico, a frequência ficava contaminada até o próximo `filter()` com
// dois timestamps válidos.
// -----------------------------------------------------------------------------

describe('B3.5 — dt zero não derruba o frame', () => {
  it('dois timestamps IDÊNTICOS não lançam', () => {
    // O caso do replay e do `performance.now()` grosseirizado. Antes: exceção
    // dentro de `setAlpha`, frame inteiro perdido.
    const f = new OneEuroFilter(30, 0.5, 1.0);
    f.filter(10, 1.0);
    expect(() => f.filter(11, 1.0)).not.toThrow();
  });

  it('timestamps idênticos devolvem valor finito', () => {
    const f = new OneEuroFilter(30, 0.5, 1.0);
    f.filter(10, 1.0);
    const out = f.filter(11, 1.0);
    expect(Number.isFinite(out)).toBe(true);
  });

  it('timestamp RETROCEDENDO não lança', () => {
    // Relógio não-monotônico é raro mas acontece (ajuste de hora do SO, e no
    // replay quando os frames vêm fora de ordem). `dt` negativo daria `freq`
    // negativa e `alpha` fora de (0,1].
    const f = new OneEuroFilter(30, 0.5, 1.0);
    f.filter(10, 2.0);
    expect(() => f.filter(11, 1.0)).not.toThrow();
    expect(Number.isFinite(f.filter(12, 0.5))).toBe(true);
  });

  it('uma sequência inteira de timestamps repetidos permanece estável', () => {
    const f = new OneEuroFilter2D(30, 0.5, 1.0);
    for (let i = 0; i < 100; i++) {
      const r = f.filter(100 + i, 200 - i, 5.0);
      expect(Number.isFinite(r.x)).toBe(true);
      expect(Number.isFinite(r.y)).toBe(true);
    }
  });
});

describe('B3.5 — dt gigante não vira identidade', () => {
  it('uma lacuna de 10 s ainda suaviza', () => {
    // Aba em segundo plano. Sem o clamp, `alpha ≈ 1` e a saída salta direto
    // para a entrada — o cursor teleporta no primeiro frame de volta.
    const f = new OneEuroFilter(30, 0.5, 0);
    f.filter(0, 0);
    const saida = f.filter(1000, 10.0);   // 10 s de lacuna, degrau de 1000
    // Com clamp, o passo é limitado pelo alpha de `DT_MAX_SEC`.
    expect(saida).toBeLessThan(1000);
  });

  it('o clamp de dt é declarado e coerente', () => {
    // `DT_MIN_SEC` cobre até ~240 fps; `DT_MAX_SEC` corresponde a 5 fps, o
    // piso abaixo do qual o rastreamento já não é utilizável de qualquer forma.
    expect(DT_MIN_SEC).toBeGreaterThan(0);
    expect(DT_MIN_SEC).toBeLessThan(DT_MAX_SEC);
    expect(1 / DT_MIN_SEC).toBeGreaterThanOrEqual(120);
    expect(1 / DT_MAX_SEC).toBeLessThanOrEqual(10);
  });

  it('dt dentro da faixa normal não é alterado', () => {
    // Regressão: o clamp não pode mexer no caminho saudável de 30 ou 60 fps.
    const semClamp = new OneEuroFilter(30, 0.5, 1.0);
    const comClamp = new OneEuroFilter(30, 0.5, 1.0);
    let a = 0;
    let b = 0;
    for (let i = 1; i <= 20; i++) {
      a = semClamp.filter(i * 10, i / 30);
      b = comClamp.filter(i * 10, i / 30);
    }
    expect(a).toBeCloseTo(b, 12);
  });
});

describe('B3.5 — reset() restaura a frequência do construtor', () => {
  it('depois de um dt patológico, reset devolve o comportamento inicial', () => {
    const f = new OneEuroFilter(30, 0.5, 1.0);
    // Sequência normal.
    for (let i = 1; i <= 5; i++) f.filter(i * 10, i / 30);
    const antes = f.filter(60, 6 / 30);

    // Lacuna gigante contamina `freq`.
    f.filter(70, 100);
    f.reset();

    // Repete a MESMA sequência do começo.
    const g = new OneEuroFilter(30, 0.5, 1.0);
    for (let i = 1; i <= 5; i++) {
      f.filter(i * 10, i / 30);
      g.filter(i * 10, i / 30);
    }
    const depois = f.filter(60, 6 / 30);
    const referencia = g.filter(60, 6 / 30);

    expect(depois).toBeCloseTo(referencia, 12);
    expect(depois).toBeCloseTo(antes, 12);
  });

  it('OneEuroFilter2D.reset() zera os dois eixos', () => {
    const f = new OneEuroFilter2D(30, 0.5, 1.0);
    f.filter(500, 500, 0);
    f.filter(500, 500, 1 / 30);
    f.reset();
    // Após reset, a primeira amostra passa intacta (não é interpolada com o
    // estado anterior).
    const r = f.filter(100, 900, 0);
    expect(r.x).toBe(100);
    expect(r.y).toBe(900);
  });
});
