import { describe, it, expect, vi, afterEach } from 'vitest';
import { RidgeRegressor, LAMBDA_GRID, escolherMelhorLambda } from './ridge';
import { KernelRidgeRegressor } from './kernelRidge';

// -----------------------------------------------------------------------------
// B3.9 — `bestLambda` inicia em `lambdas[0]` com comparação `<` ESTRITA.
//
//   let bestLambdaX = lambdas[0];   // 1e-5
//   ...
//   if (meanFoldErrorX < minErrorX) { bestLambdaX = lambda; }
//
// Dois defeitos:
//
//  (a) **Empates ficam com o MENOR λ.** Com `<` estrito, um λ posterior que
//      empate não substitui. E o menor λ é o de menor regularização — ou seja,
//      o empate é sempre resolvido a favor do modelo mais propenso a
//      overfitting. Num platô de erro (comum quando o sinal é forte), isso
//      escolhe sistematicamente a pior ponta do platô.
//
//  (b) **Falha total devolve `{1e-5, 1e-5}` como se fosse escolha.** Se TODOS
//      os λ falharem (matriz singular em todos os folds), `minError` continua
//      `Infinity`, `bestLambda` continua `lambdas[0]`, e a função retorna esse
//      valor com um log dizendo `erro: Infinity` — que ninguém lê. O caller
//      treina com um λ que nunca foi validado.
//
//  (c) O comentário do cabeçalho dizia que o grid vai de 1e-4 a 1e3; ele
//      começa em 1e-5.
//
// B3.20 — `KernelRidgeRegressor.predict` devolve PIXELS; `predictRidge`
//         devolve [0,1].
//
// Ambos implementam `GazeRegressor` e todo consumidor multiplica por `vw`/`vh`.
// Trocar `REGRESSOR_MODE` — UM caractere — faz o cursor sair em `x·vw²`.
// -----------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
  RidgeRegressor.lambdaOverride = null;
});

describe('B3.9 — empates ficam com o MAIOR λ', () => {
  it('erro idêntico em vários λ escolhe o maior', () => {
    // Platô de erro: a escolha certa é o λ mais regularizado, porque entre
    // modelos que erram igual o menos propenso a memorizar é o melhor.
    const erros = new Map<number, number>();
    for (const l of [1e-5, 1e-3, 1e-1, 1, 10]) erros.set(l, 5.0);
    const escolhido = escolherMelhorLambda([1e-5, 1e-3, 1e-1, 1, 10], (l) => erros.get(l)!);
    expect(escolhido.lambda).toBe(10);
  });

  it('um mínimo estrito é respeitado, mesmo sendo o menor λ', () => {
    // A regra de desempate não pode virar "sempre o maior".
    const erros = new Map([[1e-5, 1.0], [1e-3, 5.0], [1e-1, 5.0], [1, 5.0]]);
    const escolhido = escolherMelhorLambda([1e-5, 1e-3, 1e-1, 1], (l) => erros.get(l)!);
    expect(escolhido.lambda).toBe(1e-5);
  });

  it('empate apenas no mínimo escolhe o maior dos empatados', () => {
    const erros = new Map([[1e-5, 9.0], [1e-3, 2.0], [1e-1, 2.0], [1, 7.0]]);
    const escolhido = escolherMelhorLambda([1e-5, 1e-3, 1e-1, 1], (l) => erros.get(l)!);
    expect(escolhido.lambda).toBe(1e-1);
  });

  it('empate dentro da tolerância numérica também conta como empate', () => {
    // Erros de ponto flutuante fazem dois λ que deveriam empatar diferirem na
    // 15ª casa. Sem tolerância, o desempate volta a ser acidental.
    const erros = new Map([[1e-3, 2.0], [1e-1, 2.0 + 1e-14]]);
    const escolhido = escolherMelhorLambda([1e-3, 1e-1], (l) => erros.get(l)!);
    expect(escolhido.lambda).toBe(1e-1);
  });
});

describe('B3.9 — falha total é SINALIZADA, não mascarada', () => {
  it('todos os λ falhando devolve ok=false', () => {
    // Antes: retornava `{1e-5, 1e-5}` silenciosamente, e o caller treinava com
    // um λ que nenhum fold validou.
    const r = escolherMelhorLambda([1e-5, 1e-3, 1], () => Infinity);
    expect(r.ok).toBe(false);
  });

  it('todos os λ lançando devolve ok=false', () => {
    const r = escolherMelhorLambda([1e-5, 1e-3, 1], () => {
      throw new Error('matriz singular');
    });
    expect(r.ok).toBe(false);
  });

  it('NaN no erro conta como falha daquele λ', () => {
    const r = escolherMelhorLambda([1e-5, 1e-3, 1], (l) => (l === 1e-3 ? 4 : NaN));
    expect(r.ok).toBe(true);
    expect(r.lambda).toBe(1e-3);
  });

  it('pelo menos um λ válido devolve ok=true', () => {
    const r = escolherMelhorLambda([1e-5, 1e-3, 1], (l) => (l === 1 ? 3 : Infinity));
    expect(r.ok).toBe(true);
    expect(r.lambda).toBe(1);
  });

  it('grid vazio devolve ok=false em vez de lançar', () => {
    expect(escolherMelhorLambda([], () => 1).ok).toBe(false);
  });
});

describe('B3.9 — o grid documentado é o grid real', () => {
  it('LAMBDA_GRID é exportado e ordenado', () => {
    expect(LAMBDA_GRID.length).toBeGreaterThan(5);
    for (let i = 1; i < LAMBDA_GRID.length; i++) {
      expect(LAMBDA_GRID[i]).toBeGreaterThan(LAMBDA_GRID[i - 1]);
    }
  });

  it('o comentário do módulo não pode divergir dos extremos reais', () => {
    // O cabeçalho afirmava "de 1e-4 a 1e3"; o grid começa em 1e-5. Travar os
    // extremos aqui força a documentação a acompanhar qualquer mudança.
    expect(LAMBDA_GRID[0]).toBe(1e-5);
    expect(LAMBDA_GRID[LAMBDA_GRID.length - 1]).toBe(1000);
  });
});

describe('B3.20 — os dois regressores devolvem a MESMA unidade', () => {
  /** Conjunto linearmente separável: alvo = 0,2 + 0,6·f. */
  function treinar() {
    const features: number[][] = [];
    const tx: number[] = [];
    const ty: number[] = [];
    for (let i = 0; i < 40; i++) {
      const f = i / 39;
      features.push([f, f * f]);
      tx.push(0.2 + 0.6 * f);
      ty.push(0.8 - 0.6 * f);
    }
    return { features, tx, ty };
  }

  it('KernelRidge devolve coordenada NORMALIZADA, não pixels', () => {
    // O bug: `KernelRidgeRegressor.predict` devolvia px enquanto
    // `predictRidge` devolvia [0,1]. Todo consumidor multiplica por `vw`/`vh`,
    // então trocar `REGRESSOR_MODE` (um caractere) fazia o cursor sair em
    // `x·vw²` — coordenadas na casa dos milhões.
    const { features, tx, ty } = treinar();
    const kr = new KernelRidgeRegressor();
    kr.train(features, tx, ty);
    const p = kr.predict([0.5, 0.25]);
    expect(p.x).toBeGreaterThan(-0.5);
    expect(p.x).toBeLessThan(1.5);
    expect(p.y).toBeGreaterThan(-0.5);
    expect(p.y).toBeLessThan(1.5);
  });

  it('Ridge e KernelRidge produzem valores da mesma ordem de grandeza', () => {
    const { features, tx, ty } = treinar();
    const ridge = new RidgeRegressor();
    ridge.train(features, tx, ty);
    const kr = new KernelRidgeRegressor();
    kr.train(features, tx, ty);

    const a = ridge.predict([0.5, 0.25]);
    const b = kr.predict([0.5, 0.25]);
    // Não exigimos igualdade — são modelos diferentes. Exigimos que não haja
    // um fator de ~1920 entre eles.
    expect(Math.abs(a.x - b.x)).toBeLessThan(0.5);
    expect(Math.abs(a.y - b.y)).toBeLessThan(0.5);
  });

  it('KernelRidge NÃO clampa por olho', () => {
    // O clamp por olho, antes da média binocular, distorce a fusão: se o olho
    // direito prevê 1,05 e o esquerdo 0,9, a média correta é ~0,975; com clamp
    // por olho vira (1,0+0,9)/2 = 0,95, puxando o cursor para dentro da tela.
    // O clamp certo é DEPOIS da média, em `mapGaze`.
    const features: number[][] = [];
    const tx: number[] = [];
    const ty: number[] = [];
    for (let i = 0; i < 30; i++) {
      const f = i / 29;
      features.push([f]);
      tx.push(f * 2 - 0.5);   // alvos deliberadamente fora de [0,1]
      ty.push(0.5);
    }
    const kr = new KernelRidgeRegressor();
    kr.train(features, tx, ty);
    const p = kr.predict([1.0]);
    // Deve conseguir extrapolar acima de 1 — se estiver clampado, satura em 1.
    expect(p.x).toBeGreaterThan(1.0);
  });
});
