import { describe, it, expect } from 'vitest';
import {
  RecursiveRidgeRegressor,
  DEFAULT_RECURSIVE_OPTIONS,
} from './recursiveRidge';

// -----------------------------------------------------------------------------
// B2.8 — RLS: `initialLambda` com semântica invertida, e covariance windup.
//
// ## Defeito 1: a semântica de λ estava documentada ao contrário
//
// O comentário dizia "valor pequeno = confia mais no β inicial". É o oposto:
// `P₀ = (1/λ)I` é a COVARIÂNCIA de β₀ — λ pequeno ⇒ P₀ GRANDE ⇒ confiança
// BAIXA no β inicial. Com o default λ=0,01, P₀ = 100·I.
//
// Medido no plano (27 dims, β₀ com bias 0,5, alvo 0,9):
//
//   pred inicial     : { x: 0.5,    y: 0.5   }
//   após 1 amostra   : { x: 0.8998, y: 0.1002 }   ← já colou no alvo
//
// **Uma única amostra online anula o Ridge offline.** A rampa
// `ONLINE_RAMP_SAMPLES = 50` só atrasa o efeito, não o impede. É o que explica
// a degradação de 184 → 521 px registrada em `calibration.ts`.
//
// ## Defeito 2: covariance windup
//
// `this.P[i][j] = (P - k·Pf) / this.mu` divide por μ < 1 a cada update, sem
// bound de traço e sem re-simetrização. Medido, mesmo ponto repetido:
// `trace(P₀) = 2800` → **4,109e+5 após 500 updates (×147)**.
//
// Depois do windup, uma amostra que difere 0,01 numa única dimensão move a
// predição de 0,900 para 0,662 — **24% da tela a partir de um dwell click**.
// Em sessão real os cliques caem em poucas posições de botão, que é exatamente
// o regime patológico.
// -----------------------------------------------------------------------------

/** β com bias `b` e zeros no resto — prediz `b` para qualquer feature. */
function betaBias(b: number, dims: number): number[] {
  return [b, ...new Array<number>(dims).fill(0)];
}

function features(dims: number, valor = 0.1): number[] {
  return new Array<number>(dims).fill(valor);
}

describe('B2.8 — a semântica de initialLambda', () => {
  it('o default confia no β offline: 1 amostra NÃO cola no alvo', () => {
    // O teste central. Antes: pred saltava de 0,5 para 0,8998 num único
    // update — o Ridge offline, treinado com ~240 amostras, era anulado por
    // um clique.
    const dims = 27;
    const r = new RecursiveRidgeRegressor(betaBias(0.5, dims), betaBias(0.5, dims));
    const f = features(dims);

    expect(r.predict(f).x).toBeCloseTo(0.5, 6);
    r.update(f, 0.9, 0.1);

    const depois = r.predict(f);
    // Deve ter se movido POUCO na direção do alvo, não colado nele.
    expect(depois.x).toBeGreaterThan(0.5);
    expect(depois.x).toBeLessThan(0.6);
  });

  it('λ GRANDE = confia no β offline (P₀ pequeno)', () => {
    const dims = 10;
    const f = features(dims);
    const r = new RecursiveRidgeRegressor(
      betaBias(0.5, dims), betaBias(0.5, dims),
      { initialLambda: 1000 },
    );
    r.update(f, 0.9, 0.1);
    expect(r.predict(f).x).toBeCloseTo(0.5, 2);
  });

  it('λ PEQUENO = desconfia do β offline (P₀ grande) — o comportamento antigo', () => {
    // A semântica invertida documentada. Mantida como comportamento
    // ALCANÇÁVEL, para quem quiser adaptação agressiva de propósito; o que
    // muda é o default e a documentação.
    const dims = 10;
    const f = features(dims);
    const r = new RecursiveRidgeRegressor(
      betaBias(0.5, dims), betaBias(0.5, dims),
      { initialLambda: 0.01 },
    );
    r.update(f, 0.9, 0.1);
    expect(r.predict(f).x).toBeGreaterThan(0.85);
  });

  it('o default do módulo é conservador', () => {
    // Se alguém baixar este número sem medir, o modelo offline volta a ser
    // anulado por um clique.
    expect(DEFAULT_RECURSIVE_OPTIONS.initialLambda).toBeGreaterThanOrEqual(100);
  });

  it('N amostras CONSISTENTES com o modelo offline não deslocam a predição', () => {
    // Critério de aceite do plano (via P6.7): amostras que concordam com o
    // modelo não podem movê-lo.
    const dims = 12;
    const f = features(dims);
    const r = new RecursiveRidgeRegressor(betaBias(0.5, dims), betaBias(0.5, dims));
    for (let i = 0; i < 50; i++) r.update(f, 0.5, 0.5);
    expect(r.predict(f).x).toBeCloseTo(0.5, 6);
  });
});

describe('B2.8 — covariance windup', () => {
  it('trace(P) fica preso no teto em 500 updates no mesmo ponto', () => {
    // Medido antes: 2800 → 4,109e+5 (**×147**), sem teto nenhum. O bound é
    // RELATIVO ao traço inicial (`n/λ × maxTraceGrowth`), porque `trace(P₀)`
    // depende de λ e da dimensão — um teto absoluto seria apertado demais
    // numa configuração e frouxo demais em outra.
    const dims = 27;
    const f = features(dims);
    const r = new RecursiveRidgeRegressor(betaBias(0.5, dims), betaBias(0.5, dims));

    const traceInicial = r.traceP();
    for (let i = 0; i < 500; i++) r.update(f, 0.9, 0.1);
    const traceFinal = r.traceP();

    expect(Number.isFinite(traceFinal)).toBe(true);
    // Cresce até o teto de 10× e para lá — não os 147× do bug.
    expect(traceFinal).toBeLessThanOrEqual(traceInicial * DEFAULT_RECURSIVE_OPTIONS.maxTraceGrowth * 1.001);
    expect(traceFinal / traceInicial).toBeLessThan(147);
  });

  it('mais updates não empurram o traço além do teto', () => {
    // O bound tem que segurar indefinidamente, não só nos primeiros 500.
    const dims = 27;
    const f = features(dims);
    const r = new RecursiveRidgeRegressor(betaBias(0.5, dims), betaBias(0.5, dims));
    for (let i = 0; i < 500; i++) r.update(f, 0.9, 0.1);
    const t500 = r.traceP();
    for (let i = 0; i < 5000; i++) r.update(f, 0.9, 0.1);
    expect(r.traceP()).toBeLessThanOrEqual(t500 * 1.001);
  });

  it('após 500 updates, uma amostra levemente diferente não move 24% da tela', () => {
    // O sintoma concreto do windup: com P inflado, o ganho fica enorme e uma
    // amostra que difere 0,01 numa única dimensão movia a predição de 0,900
    // para 0,662.
    const dims = 27;
    const f = features(dims);
    const r = new RecursiveRidgeRegressor(betaBias(0.5, dims), betaBias(0.5, dims));
    for (let i = 0; i < 500; i++) r.update(f, 0.9, 0.1);

    const antes = r.predict(f).x;
    const perturbado = [...f];
    perturbado[3] += 0.01;
    r.update(perturbado, 0.9, 0.1);
    const depois = r.predict(f).x;

    expect(Math.abs(depois - antes)).toBeLessThan(0.05);
  });

  it('P permanece simétrica ao longo dos updates', () => {
    // Sem re-simetrização, o erro de ponto flutuante acumula e P deixa de ser
    // uma covariância válida — o ganho passa a ter componente espúria.
    const dims = 8;
    const r = new RecursiveRidgeRegressor(betaBias(0.5, dims), betaBias(0.5, dims));
    for (let i = 0; i < 200; i++) {
      r.update(features(dims, 0.1 + (i % 7) * 0.01), 0.6, 0.4);
    }
    const P = r.snapshotP();
    for (let i = 0; i < P.length; i++) {
      for (let j = i + 1; j < P.length; j++) {
        expect(Math.abs(P[i][j] - P[j][i])).toBeLessThan(1e-9);
      }
    }
  });

  it('P permanece com diagonal positiva', () => {
    // Diagonal negativa é covariância inválida e produz ganho com sinal
    // trocado — o modelo passa a se afastar do alvo a cada amostra.
    const dims = 8;
    const r = new RecursiveRidgeRegressor(betaBias(0.5, dims), betaBias(0.5, dims));
    for (let i = 0; i < 300; i++) r.update(features(dims), 0.7, 0.3);
    const P = r.snapshotP();
    for (let i = 0; i < P.length; i++) expect(P[i][i]).toBeGreaterThan(0);
  });
});

describe('B2.8 — robustez numérica', () => {
  it('features com dimensão errada são ignoradas sem corromper o estado', () => {
    const dims = 10;
    const r = new RecursiveRidgeRegressor(betaBias(0.5, dims), betaBias(0.5, dims));
    r.update(features(3), 0.9, 0.1);
    expect(r.predict(features(dims)).x).toBeCloseTo(0.5, 9);
    expect(r.n).toBe(0);
  });

  it('alvo não-finito não contamina β', () => {
    const dims = 10;
    const f = features(dims);
    const r = new RecursiveRidgeRegressor(betaBias(0.5, dims), betaBias(0.5, dims));
    r.update(f, NaN, 0.1);
    expect(Number.isFinite(r.predict(f).x)).toBe(true);
    expect(r.predict(f).x).toBeCloseTo(0.5, 9);
  });

  it('1000 updates com ruído mantêm a predição finita e na faixa', () => {
    const dims = 12;
    const r = new RecursiveRidgeRegressor(betaBias(0.5, dims), betaBias(0.5, dims));
    let semente = 7;
    const rnd = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648; };
    for (let i = 0; i < 1000; i++) {
      r.update(features(dims, 0.05 + rnd() * 0.1), 0.4 + rnd() * 0.2, 0.4 + rnd() * 0.2);
    }
    const p = r.predict(features(dims));
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
    expect(Math.abs(p.x)).toBeLessThan(10);
  });
});
