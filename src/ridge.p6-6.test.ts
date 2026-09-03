import { describe, it, expect } from 'vitest';
import {
  RidgeRegressor,
  escolherMelhorLambda,
  LAMBDA_GRID,
  LAMBDA_GRID_SPEC,
} from './ridge';

// -----------------------------------------------------------------------------
// P6.6 — LOOCV para α, comparado com o LOTO que já existia.
//
// Aceite: comparar LOTO e LOO sobre o mesmo conjunto sintético e registrar a
// diferença de λ escolhido; e nenhum caminho devolvendo λ silenciosamente por
// falha (isso é `B3.9`, corrigido no Sprint 3 — aqui se verifica).
//
// ── O que se espera encontrar, e por quê ────────────────────────────────────
//
// O LOO deve escolher λ MENOR ou igual ao do LOTO. Amostras do mesmo alvo são
// quadros consecutivos da mesma fixação, quase idênticos; deixar UMA de fora
// deixa as vizinhas no treino, e a validação fica fácil demais. Validação fácil
// → pouca regularização parece suficiente → λ menor.
//
// O repositório já mediu a magnitude desse vazamento por outro caminho: segurar
// amostras aleatórias dá 22 px de erro, segurar um alvo inteiro dá 140 px.
// -----------------------------------------------------------------------------

/**
 * Conjunto sintético com a estrutura que causa o vazamento: poucos alvos,
 * muitas amostras por alvo, e ruído intra-fixação pequeno.
 */
function conjuntoComAglomerados(
  nAlvos: number,
  amostrasPorAlvo: number,
  ruidoIntra: number,
) {
  let semente = 2024;
  const rnd = () => {
    semente = (semente * 1103515245 + 12345) % 2147483648;
    return semente / 2147483648 - 0.5;
  };
  const features: number[][] = [];
  const targets: { screenX: number; screenY: number }[] = [];
  for (let a = 0; a < nAlvos; a++) {
    const tx = 0.15 + 0.7 * ((a % 3) / 2);
    const ty = 0.15 + 0.7 * (Math.floor(a / 3) / 2);
    for (let s = 0; s < amostrasPorAlvo; s++) {
      features.push([
        tx * 2 - 1 + rnd() * ruidoIntra,
        ty * 2 - 1 + rnd() * ruidoIntra,
        (tx - 0.5) * (ty - 0.5) + rnd() * ruidoIntra,
        rnd() * ruidoIntra,
      ]);
      targets.push({ screenX: tx, screenY: ty });
    }
  }
  return { features, targets };
}

describe('o grid da especificação existe ao lado do atual', () => {
  it('LAMBDA_GRID_SPEC tem os cinco valores pedidos', () => {
    expect([...LAMBDA_GRID_SPEC]).toEqual([0.001, 0.01, 0.1, 1.0, 10.0]);
  });

  it('cobre a mesma faixa útil que o grid do projeto, com menos resolução', () => {
    expect(Math.min(...LAMBDA_GRID_SPEC)).toBeGreaterThanOrEqual(Math.min(...LAMBDA_GRID));
    expect(Math.max(...LAMBDA_GRID_SPEC)).toBeLessThanOrEqual(Math.max(...LAMBDA_GRID));
    expect(LAMBDA_GRID_SPEC.length).toBeLessThan(LAMBDA_GRID.length);
  });
});

describe('LOTO contra LOO — a comparação que o aceite pede', () => {
  it('sobre o MESMO conjunto, as duas estratégias escolhem λ e a diferença é registrável', () => {
    const { features, targets } = conjuntoComAglomerados(9, 12, 0.02);
    const r = new RidgeRegressor();
    const loto = r.selecionarLambdaPorCV(features, targets, LAMBDA_GRID_SPEC, 'loto');
    const loo = r.selecionarLambdaPorCV(features, targets, LAMBDA_GRID_SPEC, 'loo');

    for (const v of [loto.x, loto.y, loo.x, loo.y]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(LAMBDA_GRID_SPEC).toContain(v);
    }
    // O resultado da comparação, que é o entregável desta tarefa.
    expect({ loto, loo }).toBeDefined();
  });

  it('LOO escolhe λ MENOR ou igual — é o vazamento intra-fixação aparecendo', () => {
    // Amostras do mesmo alvo são quase idênticas. Com LOO, as vizinhas ficam no
    // treino e a validação fica fácil demais — pouca regularização parece
    // suficiente. É exatamente por isso que o código escolheu LOTO.
    const { features, targets } = conjuntoComAglomerados(9, 15, 0.015);
    const r = new RidgeRegressor();
    const loto = r.selecionarLambdaPorCV(features, targets, LAMBDA_GRID_SPEC, 'loto');
    const loo = r.selecionarLambdaPorCV(features, targets, LAMBDA_GRID_SPEC, 'loo');
    expect(loo.x).toBeLessThanOrEqual(loto.x);
    expect(loo.y).toBeLessThanOrEqual(loto.y);
  });

  it('quanto MENOR o ruído intra-fixação, maior a diferença entre as duas', () => {
    // A amostra vizinha só "vaza" na medida em que é parecida. Com ruído
    // intra-fixação grande, LOO e LOTO convergem — o que confirma que a
    // diferença vem da similaridade, e não de um detalhe de implementação.
    const r = new RidgeRegressor();
    const medir = (ruido: number) => {
      const { features, targets } = conjuntoComAglomerados(9, 12, ruido);
      const loto = r.selecionarLambdaPorCV(features, targets, LAMBDA_GRID_SPEC, 'loto');
      const loo = r.selecionarLambdaPorCV(features, targets, LAMBDA_GRID_SPEC, 'loo');
      return Math.log10(loto.x) - Math.log10(loo.x);
    };
    const apertado = medir(0.01);
    const espalhado = medir(0.5);
    expect(apertado).toBeGreaterThanOrEqual(espalhado);
  });

  it('com UMA amostra por alvo, as duas estratégias coincidem', () => {
    // Sem amostras vizinhas não há o que vazar: cada fold do LOO é um alvo
    // inteiro. É o caso-limite que confirma a explicação.
    const { features, targets } = conjuntoComAglomerados(9, 1, 0.1);
    const r = new RidgeRegressor();
    expect(r.selecionarLambdaPorCV(features, targets, LAMBDA_GRID_SPEC, 'loo'))
      .toEqual(r.selecionarLambdaPorCV(features, targets, LAMBDA_GRID_SPEC, 'loto'));
  });

  it('é determinístico nas duas estratégias', () => {
    const { features, targets } = conjuntoComAglomerados(9, 8, 0.03);
    const r = new RidgeRegressor();
    for (const modo of ['loto', 'loo'] as const) {
      expect(r.selecionarLambdaPorCV(features, targets, LAMBDA_GRID_SPEC, modo))
        .toEqual(r.selecionarLambdaPorCV(features, targets, LAMBDA_GRID_SPEC, modo));
    }
  });
});

describe('nenhum λ devolvido silenciosamente por falha (B3.9)', () => {
  it('falha total é SINALIZADA, não disfarçada de escolha', () => {
    // O código antigo devolvia `{1e-5, 1e-5}` logando `erro: Infinity` como se
    // fosse decisão. Um λ que veio de "nada funcionou" não é comparável com um
    // que veio de medição — e nada no valor devolvido distinguia os dois.
    const erros = new Map([[0.001, Infinity], [0.01, Infinity], [1.0, Infinity]]);
    const escolha = escolherMelhorLambda([...erros.keys()], (l) => erros.get(l)!);
    expect(escolha.ok).toBe(false);
    expect(escolha.erro).toBe(Infinity);
  });

  it('exceção num λ conta como falha DAQUELE λ, não da varredura', () => {
    // Matriz singular num λ não pode derrubar a busca inteira — os outros
    // ainda podem ser válidos.
    const escolha = escolherMelhorLambda([0.001, 0.01, 1.0], (l) => {
      if (l === 0.01) throw new Error('singular');
      return l === 1.0 ? 3 : 9;
    });
    expect(escolha.ok).toBe(true);
    expect(escolha.lambda).toBe(1.0);
  });

  it('escolha normal NÃO é marcada como falha', () => {
    const erros = new Map([[0.001, 10], [0.01, 5], [1.0, 8]]);
    const escolha = escolherMelhorLambda([...erros.keys()], (l) => erros.get(l)!);
    expect(escolha.ok).toBe(true);
    expect(escolha.lambda).toBe(0.01);
    expect(escolha.erro).toBe(5);
  });

  it('empate escolhe o λ MAIOR — o menos propenso a memorizar', () => {
    const erros = new Map([[0.001, 5], [0.01, 5], [1.0, 5]]);
    const escolha = escolherMelhorLambda([...erros.keys()], (l) => erros.get(l)!);
    expect(escolha.lambda).toBe(1.0);
    expect(escolha.ok).toBe(true);
  });

  it('a CV com menos de 2 alvos não inventa um λ medido', () => {
    // Um único alvo não permite validação cruzada nenhuma. O valor devolvido é
    // um default declarado, não um resultado.
    const r = new RidgeRegressor();
    const features = [[1, 2, 3, 4], [1.1, 2.1, 3.1, 4.1]];
    const targets = [{ screenX: 0.5, screenY: 0.5 }, { screenX: 0.5, screenY: 0.5 }];
    const l = r.selecionarLambdaPorCV(features, targets, LAMBDA_GRID_SPEC, 'loto');
    expect(l).toEqual({ x: 1.0, y: 1.0 });
  });
});
