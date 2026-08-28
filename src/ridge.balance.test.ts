import { describe, it, expect, afterEach, vi } from 'vitest';
import { RidgeRegressor, trainRidgeModel, predictRidge } from './ridge';

// 3.4 — o ajuste pesava por AMOSTRA; o CV de lambda já pesava por ALVO desde D9.
//
// Quantos quadros um alvo reteve é acidente de coleta, não decisão: depende de
// o rosto ter ficado estável naqueles 1,4 s. Na gravação de referência a razão
// entre o alvo mais e o menos amostrado é 1,76x (65 contra 37), e o efeito de
// equilibrar mede -0,2% — ruído. Estes testes mostram que o MECANISMO funciona,
// para separar "não faz efeito" de "o desequilíbrio real é pequeno demais".

/** Nove alvos numa grade, com contagem de amostras por alvo controlada. */
function grade(contagens: number[]) {
  let semente = 3;
  const rnd = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648 - 0.5; };
  const feats: number[][] = []; const alvos: { screenX: number; screenY: number }[] = [];
  const grupos: string[] = [];
  let i = 0;
  for (const x of [0.2, 0.5, 0.8]) {
    for (const y of [0.2, 0.5, 0.8]) {
      for (let n = 0; n < contagens[i]; n++) {
        feats.push([x + rnd() * 0.01, y + rnd() * 0.01, x * 0.5, y * 0.5]);
        alvos.push({ screenX: x, screenY: y });
        grupos.push(`${x},${y}`);
      }
      i++;
    }
  }
  return { feats, alvos, grupos };
}

/** Erro médio do modelo em cada alvo, na ordem da grade. */
function erroPorAlvo(model: ReturnType<typeof trainRidgeModel>, d: ReturnType<typeof grade>) {
  const soma = new Map<string, { s: number; n: number }>();
  for (let i = 0; i < d.feats.length; i++) {
    const p = predictRidge(model, d.feats[i]);
    const e = Math.hypot(p.x - d.alvos[i].screenX, p.y - d.alvos[i].screenY);
    const a = soma.get(d.grupos[i]) ?? { s: 0, n: 0 };
    a.s += e; a.n++; soma.set(d.grupos[i], a);
  }
  return [...soma.entries()].map(([g, a]) => ({ grupo: g, erro: a.s / a.n }));
}

describe('trainRidgeModel — pesos por amostra', () => {
  it('sem pesos, reproduz o comportamento histórico', () => {
    const d = grade(Array(9).fill(40));
    const a = trainRidgeModel(d.feats, d.alvos, 0.01, { groups: d.grupos });
    const b = trainRidgeModel(d.feats, d.alvos, 0.01, { groups: d.grupos, sampleWeights: null });
    expect(b.betaX).toEqual(a.betaX);
  });

  it('pesos uniformes são no-op — só a razão entre eles conta', () => {
    const d = grade(Array(9).fill(40));
    const semPeso = trainRidgeModel(d.feats, d.alvos, 0.01, { groups: d.grupos });
    const uniforme = trainRidgeModel(d.feats, d.alvos, 0.01, {
      groups: d.grupos, sampleWeights: Array(d.feats.length).fill(7),
    });
    for (let i = 0; i < semPeso.betaX.length; i++) {
      expect(uniforme.betaX[i]).toBeCloseTo(semPeso.betaX[i], 6);
    }
  });

  it('com contagens iguais, equilibrar não muda nada', () => {
    // É o que garante que a mudança não pode piorar uma coleta saudável.
    const d = grade(Array(9).fill(40));
    const semPeso = trainRidgeModel(d.feats, d.alvos, 0.01, { groups: d.grupos });
    const pesos = d.grupos.map(() => 1 / 40);
    const comPeso = trainRidgeModel(d.feats, d.alvos, 0.01, { groups: d.grupos, sampleWeights: pesos });
    for (let i = 0; i < semPeso.betaX.length; i++) {
      expect(comPeso.betaX[i]).toBeCloseTo(semPeso.betaX[i], 6);
    }
  });

  it('com um alvo faminto, equilibrar melhora o erro NAQUELE alvo', () => {
    // O caso que o mecanismo existe para cobrir: MIN_ACCEPTED_SAMPLES é 15, e
    // um alvo saudável retém ~65. São 4,3x de desequilíbrio, mais que o dobro
    // do que a gravação de referência mostra.
    const contagens = [80, 80, 80, 80, 80, 80, 80, 80, 8];
    const d = grade(contagens);
    const conta = new Map<string, number>();
    for (const g of d.grupos) conta.set(g, (conta.get(g) ?? 0) + 1);
    const pesos = d.grupos.map((g) => 1 / conta.get(g)!);

    const semPeso = trainRidgeModel(d.feats, d.alvos, 0.05, { groups: d.grupos });
    const comPeso = trainRidgeModel(d.feats, d.alvos, 0.05, { groups: d.grupos, sampleWeights: pesos });

    const faminto = erroPorAlvo(semPeso, d).at(-1)!.erro;
    const famintoEq = erroPorAlvo(comPeso, d).at(-1)!.erro;
    expect(famintoEq).toBeLessThan(faminto);
  });
});

describe('RidgeRegressor.balanceTargets', () => {
  afterEach(() => { RidgeRegressor.balanceTargets = false; vi.restoreAllMocks(); });

  it('o default é desligado', () => {
    expect(RidgeRegressor.balanceTargets).toBe(false);
  });

  it('ligado, muda o ajuste quando as contagens diferem', () => {
    const d = grade([80, 80, 80, 80, 80, 80, 80, 80, 8]);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const tx = d.alvos.map((a) => a.screenX), ty = d.alvos.map((a) => a.screenY);
    RidgeRegressor.balanceTargets = false;
    const a = new RidgeRegressor(); a.train(d.feats, tx, ty);
    RidgeRegressor.balanceTargets = true;
    const b = new RidgeRegressor(); b.train(d.feats, tx, ty);
    expect(b.getModel()!.betaX).not.toEqual(a.getModel()!.betaX);
  });
});
