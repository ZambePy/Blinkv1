import { describe, it, expect, afterEach, vi } from 'vitest';
import { RidgeRegressor } from './ridge';

// 3.1 — o λ era escolhido por um erro medido em FRAÇÃO DE TELA.
//
// `screenX/screenY` são frações, e fração de tela não é uma grandeza única:
// numa tela 16:9 uma unidade de x vale 1920 px e uma de y vale 1080. Somar
// `dx² + dy²` cru pondera o erro em X por (1080/1920)² = 0,32 do que ele vale
// para o usuário. `axisScale` corrige isso.
//
// ⚠️ O QUE ESTE TESTE NÃO AFIRMA: que ponderar sempre baixa o λ. Na gravação de
// referência baixa (0,01 → 0,00464, com ganho nos dois critérios), mas uma
// varredura sobre dados sintéticos com ruído assimétrico mostrou o λ subindo.
// A direção depende de qual eixo é mais difícil naquele conjunto. O que é
// invariante — e o que se testa aqui — é que a unidade da medida passou a ser
// pixel, e que a mudança tem efeito.

/** Grade 3×3 com ruído por eixo e duas dimensões colineares, para o λ ter algo
 *  que regularizar. A colinearidade não é enfeite: o `iris12` real tem posto
 *  efetivo 2,2 sobre 12 dims.
 *
 *  ⚠️ O default era 1e-2 e foi baixado para 1e-3 quando a assimetria de Σ_W foi
 *  corrigida em `withinTargetPenalty`. Com a penalidade certa (mais branda), a
 *  1e-2 este conjunto fica bem-condicionado DEMAIS: a curva do CV vira
 *  monotônica crescente — o erro em λ=1e-8 e em λ=1e-5 difere na 7ª casa — e o
 *  λ escolhido passa a ser sempre o primeiro item da grade, seja qual for a
 *  ponderação de eixos. Estender a grade para baixo não resolve, só muda o piso.
 *  A 1e-3 o ótimo volta a ser interior (1e-3 vs 4.64e-4) e o CV volta a ter o
 *  que decidir — que é a premissa destes testes. */
function amostras(ruidoX: number, ruidoY: number, colinearidade = 1e-3) {
  let semente = 7;
  const rnd = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648 - 0.5; };
  const feats: number[][] = []; const tx: number[] = []; const ty: number[] = [];
  for (const x of [0.25, 0.5, 0.75]) {
    for (const y of [0.25, 0.5, 0.75]) {
      for (let i = 0; i < 30; i++) {
        const sx = x + rnd() * ruidoX;
        const sy = y + rnd() * ruidoY;
        feats.push([
          sx, sy,
          sx * 0.5 + rnd() * colinearidade,
          sy * 0.5 + rnd() * colinearidade,
          rnd() * 0.02, rnd() * 0.02,
        ]);
        tx.push(x); ty.push(y);
      }
    }
  }
  return { feats, tx, ty };
}

function lambdaCom(escala: { x: number; y: number }, d: ReturnType<typeof amostras>): number {
  RidgeRegressor.axisScale = escala;
  RidgeRegressor.independentLambda = false;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const m = new RidgeRegressor();
  m.train(d.feats, d.tx, d.ty);
  vi.restoreAllMocks();
  return m.getModel()!.lambda;
}

describe('RidgeRegressor.axisScale', () => {
  afterEach(() => {
    RidgeRegressor.axisScale = { x: 1, y: 1 };
    RidgeRegressor.independentLambda = true;
    vi.restoreAllMocks();
  });

  it('o default reproduz o comportamento histórico', () => {
    expect(RidgeRegressor.axisScale).toEqual({ x: 1, y: 1 });
  });

  it('só a RAZÃO entre eixos importa — escala uniforme é no-op', () => {
    const d = amostras(0.3, 0.9);
    expect(lambdaCom({ x: 1000, y: 1000 }, d)).toBe(lambdaCom({ x: 1, y: 1 }, d));
  });

  it('ponderar 16:9 muda o λ escolhido quando os eixos diferem em dificuldade', () => {
    const d = amostras(0.3, 0.9);
    expect(lambdaCom({ x: 1920, y: 1080 }, d)).not.toBe(lambdaCom({ x: 1, y: 1 }, d));
  });

  // NÃO existe aqui um controle do tipo "com eixos igualmente difíceis, nada
  // muda". Ele foi escrito, falhou, e estava errado: os alvos vivem em fração
  // de tela, então ponderar 1920/1080 muda o objetivo mesmo com ruído simétrico
  // nas features. Só a igualdade de PESOS é no-op, e isso o teste acima cobre.


  it('escala degenerada não quebra o treino', () => {
    const d = amostras(0.3, 0.9);
    expect(() => lambdaCom({ x: 0, y: 0 }, d)).not.toThrow();
  });
});
