import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { trainRidgeModel, solveLinear, RidgeRegressor } from './ridge';

// A1-3 — testa: (a) modelo carrega λ efetivo, (b) escalonamento defensivo
// quando trainRidgeModel lança, (c) detecção de pivô quase-singular.

describe('A1-3: RidgeModel expõe λ efetivamente usado', () => {
  it('trainRidgeModel salva o λ recebido em model.lambda', () => {
    const features = [[1, 0], [0, 1], [1, 1], [0, 0]];
    const targets = [
      { screenX: 0.1, screenY: 0.1 },
      { screenX: 0.9, screenY: 0.1 },
      { screenX: 0.5, screenY: 0.5 },
      { screenX: 0.1, screenY: 0.9 },
    ];
    const model = trainRidgeModel(features, targets, 0.42);
    expect(model.lambda).toBe(0.42);
  });

  it('default lambda vai para o modelo (compat com chamadas antigas)', () => {
    const features = [[1, 0], [0, 1]];
    const targets = [{ screenX: 0.1, screenY: 0.1 }, { screenX: 0.9, screenY: 0.9 }];
    const model = trainRidgeModel(features, targets);
    // default é 1.0 conforme assinatura
    expect(model.lambda).toBe(1.0);
  });

  it('modelo vazio (m=0) ainda tem lambda e nearSingularCols', () => {
    const model = trainRidgeModel([], [], 5);
    expect(model.lambda).toBe(5);
    expect(model.nearSingularCols).toEqual([]);
    expect(model.numFeatures).toBe(0);
  });
});

describe('A1-3: solveLinear reporta pivôs quase-singulares', () => {
  it('coluna com pivô entre 1e-12 e 1e-6 vira nearSingular', () => {
    // Matriz cujo segundo pivô é ~1e-8 mas resolve
    const A: number[][] = [
      [1, 0, 0],
      [0, 1e-8, 0],
      [0, 0, 1],
    ];
    const b = [1, 1e-8, 1];
    const nearSingular: number[] = [];
    const x = solveLinear(A, b, nearSingular);
    expect(nearSingular).toContain(1);
    // Sanity: a solução ainda existe
    expect(x[0]).toBeCloseTo(1, 6);
    expect(x[2]).toBeCloseTo(1, 6);
  });

  it('matriz bem-condicionada não popula nearSingular', () => {
    const A: number[][] = [[2, 0], [0, 3]];
    const b = [4, 9];
    const nearSingular: number[] = [];
    const x = solveLinear(A, b, nearSingular);
    expect(nearSingular).toEqual([]);
    expect(x[0]).toBeCloseTo(2, 10);
    expect(x[1]).toBeCloseTo(3, 10);
  });

  it('matriz singular (pivô < 1e-12) ainda lança', () => {
    const A: number[][] = [[1, 1], [1, 1]];
    const b = [1, 2];
    expect(() => solveLinear(A, b)).toThrow(/Matriz singular/);
  });
});

describe('A1-3: RidgeRegressor escalona λ quando o treino final lança', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('cenário feliz — CV escolhe λ e não há escalonamento', () => {
    const grid = [0.1, 0.5, 0.9];
    const features: number[][] = [];
    const targetsX: number[] = [];
    const targetsY: number[] = [];
    for (const gy of grid) {
      for (const gx of grid) {
        features.push([(gx - 0.5) * 2, (gy - 0.5) * 2]);
        targetsX.push(gx);
        targetsY.push(gy);
      }
    }
    const reg = new RidgeRegressor();
    reg.train(features, targetsX, targetsY);
    const model = reg.getModel();
    expect(model).not.toBeNull();
    // Nenhum warn de escalonamento
    const escalationWarns = warnSpy.mock.calls.filter(c => String(c[0]).includes('λ escalonado'));
    expect(escalationWarns).toHaveLength(0);
    // λ salvo no modelo é o que o CV escolheu
    expect(model!.lambda).toBeGreaterThan(0);
  });

  it('cenário degenerado — coluna constante causa singularidade só com λ pequeno; escalona sem lançar', () => {
    // Duas features: a primeira é útil, a segunda é constante (variância zero).
    // Com λ = 1e-4 do CV, ΦᵀΦ pode ficar mal-condicionado; escalando λ para
    // 1e-3 → 1e-2 → 0.1 a regularização diagonal salva.
    const features: number[][] = [
      [0, 1], [0.25, 1], [0.5, 1], [0.75, 1], [1.0, 1],
      [0, 1], [0.25, 1], [0.5, 1], [0.75, 1], [1.0, 1],
    ];
    const targetsX = [0, 0.25, 0.5, 0.75, 1.0, 0, 0.25, 0.5, 0.75, 1.0];
    const targetsY = targetsX.map(x => 1 - x);
    const reg = new RidgeRegressor();
    // Não deve lançar — mesmo se solveLinear reclamar num λ pequeno, o
    // escalonamento salva. E se tudo der certo direto, também não lança.
    expect(() => reg.train(features, targetsX, targetsY)).not.toThrow();
    const model = reg.getModel();
    expect(model).not.toBeNull();
    // O modelo tem λ registrado (o efetivamente usado, seja o do CV ou o escalonado)
    expect(model!.lambda).toBeGreaterThan(0);
  });
});
