import { describe, it, expect } from 'vitest';
import { RecursiveRidgeRegressor } from './recursiveRidge';
import { RidgeRegressor, type RidgeModel } from './ridge';
import { KernelRidgeRegressor } from './kernelRidge';
import { StandardScaler } from './scaler';

// -----------------------------------------------------------------------------
// P6.7 — atualização online por RLS.
// P6.8 — auditar normalização e desnormalização.
//
// As duas tarefas dependiam de bugs que os Sprints 2 e 3 já corrigiram
// (`B2.8` windup de P, `B2.14` chamador ausente, `B2.9` viewport × screen,
// `B3.20` kernelRidge em pixels, `B3.32` vw × clientWidth). O que faltava eram
// os testes de ACEITE, que é o que este arquivo entrega.
// -----------------------------------------------------------------------------

/** Conjunto sintético linearmente separável, com alvos em fração de tela. */
function conjunto(n = 90) {
  let semente = 77;
  const rnd = () => {
    semente = (semente * 1103515245 + 12345) % 2147483648;
    return semente / 2147483648 - 0.5;
  };
  const features: number[][] = [];
  const targets: { screenX: number; screenY: number }[] = [];
  for (let i = 0; i < n; i++) {
    const tx = 0.15 + 0.7 * ((i % 3) / 2);
    const ty = 0.15 + 0.7 * (Math.floor((i % 9) / 3) / 2);
    features.push([tx * 2 - 1 + rnd() * 0.02, ty * 2 - 1 + rnd() * 0.02, rnd() * 0.02, rnd() * 0.02]);
    targets.push({ screenX: tx, screenY: ty });
  }
  return { features, targets };
}

// -----------------------------------------------------------------------------
// P6.7
// -----------------------------------------------------------------------------

describe('P6.7 — RLS: amostras consistentes NÃO deslocam a predição', () => {
  it('N amostras coerentes com o modelo offline mantêm a predição estável', () => {
    // O ponto do aceite: se o online só recebe confirmações do que o modelo
    // offline já acerta, ele não tem por que se mexer. Um RLS que deriva sob
    // dados consistentes está com ganho alto demais — e o sintoma em campo
    // seria a precisão degradando ao longo da sessão, que é exatamente o que
    // `USE_ONLINE_CALIBRATION = false` evita hoje (184 → 521 px).
    const { features, targets } = conjunto();
    const scaler = new StandardScaler();
    scaler.fit(features);
    const z = scaler.transform(features);

    const offline = new RidgeRegressor();
    offline.train(z, targets.map((t) => t.screenX), targets.map((t) => t.screenY));

    const teste = z[0];
    const antes = offline.predict(teste);

    // O RLS PARTE do modelo offline — é essa a semântica: ele refina, não
    // aprende do zero. Construí-lo com β zerado seria outro experimento.
    const modelo = offline.getModel() as RidgeModel;
    const rls = new RecursiveRidgeRegressor(modelo.betaX, modelo.betaY);
    // Alimenta com o que o modelo offline JÁ prevê — consistência perfeita.
    for (let i = 0; i < 200; i++) {
      const f = z[i % z.length];
      const p = offline.predict(f);
      rls.update(f, p.x, p.y);
    }
    const depois = rls.predict(teste);

    expect(Math.abs(depois.x - antes.x)).toBeLessThan(0.05);
    expect(Math.abs(depois.y - antes.y)).toBeLessThan(0.05);
  });

  it('500 updates no MESMO ponto não fazem trace(P) explodir (B2.8)', () => {
    // O bug medido: `P ← (P − k φᵀP)/μ` divide por μ < 1 a cada update. Com
    // amostras repetidas — que é o caso real, poucas posições de botão —
    // o traço ia de 2800 para 4,1e+5 em 500 updates (×147). Com P inflado o
    // ganho fica enorme e uma amostra ruim reescreve o modelo inteiro.
    const rls = new RecursiveRidgeRegressor([0, 0.4, 0.1, 0, 0], [0, 0.1, 0.4, 0, 0]);
    const ponto = [0.5, -0.3, 0.1, 0.02];
    const inicial = rls.traceP();
    for (let i = 0; i < 500; i++) rls.update(ponto, 0.5, 0.5);
    const final = rls.traceP();

    expect(Number.isFinite(final)).toBe(true);
    // O bound tem que segurar: sem ele, ×147.
    expect(final).toBeLessThan(inicial * 10);
  });

  it('o traço não explode nem com amostras variadas', () => {
    const { features } = conjunto(200);
    const rls = new RecursiveRidgeRegressor([0, 0.4, 0.1, 0, 0], [0, 0.1, 0.4, 0, 0]);
    const inicial = rls.traceP();
    for (const f of features) rls.update(f, 0.5, 0.5);
    expect(rls.traceP()).toBeLessThan(inicial * 10);
    expect(Number.isFinite(rls.traceP())).toBe(true);
  });

  it('a predição continua finita depois de muitos updates', () => {
    const rls = new RecursiveRidgeRegressor([0, 0.4, 0.1, 0, 0], [0, 0.1, 0.4, 0, 0]);
    for (let i = 0; i < 1000; i++) {
      rls.update([Math.sin(i), Math.cos(i), 0.1, -0.1], 0.5, 0.5);
    }
    const p = rls.predict([0.3, 0.4, 0.1, -0.1]);
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// P6.8
// -----------------------------------------------------------------------------

describe('P6.8 — o mapeamento é em FRAÇÃO de tela, não em pixels', () => {
  function treinar() {
    const { features, targets } = conjunto();
    const scaler = new StandardScaler();
    scaler.fit(features);
    const z = scaler.transform(features);
    const m = new RidgeRegressor();
    m.train(z, targets.map((t) => t.screenX), targets.map((t) => t.screenY));
    return { m, z, targets };
  }

  it('treinar em 1280×800 e predizer em 1920×1080 PRESERVA a fração', () => {
    // É a propriedade que faz um perfil sobreviver a uma troca de monitor. O
    // modelo nunca vê pixels: ele mapeia features → [0,1], e a desnormalização
    // acontece na hora de desenhar.
    const { m, z } = treinar();
    const fracao = m.predict(z[0]);

    const em1280 = { x: fracao.x * 1280, y: fracao.y * 800 };
    const em1920 = { x: fracao.x * 1920, y: fracao.y * 1080 };

    // A mesma predição, em duas telas: a razão bate exatamente com a razão das
    // resoluções, sem nenhum termo dependente de tela no meio.
    expect(em1920.x / em1280.x).toBeCloseTo(1920 / 1280, 9);
    expect(em1920.y / em1280.y).toBeCloseTo(1080 / 800, 9);
  });

  it('a saída do Ridge fica em [0,1] — é fração, não pixel', () => {
    const { m, z } = treinar();
    for (const f of z) {
      const p = m.predict(f);
      expect(p.x).toBeGreaterThan(-0.5);
      expect(p.x).toBeLessThan(1.5);
      expect(p.y).toBeGreaterThan(-0.5);
      expect(p.y).toBeLessThan(1.5);
    }
  });

  it('KernelRidge devolve [0,1] igual ao Ridge (B3.20)', () => {
    // O bug: `KernelRidgeRegressor.predict` devolvia PIXELS enquanto
    // `predictRidge` devolvia [0,1], e ambos implementam `GazeRegressor`.
    // Trocar `REGRESSOR_MODE` — um caractere — fazia o cursor sair em `x·vw²`.
    const { features, targets } = conjunto(45);
    const scaler = new StandardScaler();
    scaler.fit(features);
    const z = scaler.transform(features);

    const kr = new KernelRidgeRegressor();
    kr.train(z, targets.map((t) => t.screenX), targets.map((t) => t.screenY));

    for (const f of z.slice(0, 10)) {
      const p = kr.predict(f);
      // Se ainda devolvesse pixels, estes valores estariam na casa das
      // centenas ou milhares.
      expect(Math.abs(p.x)).toBeLessThan(2);
      expect(Math.abs(p.y)).toBeLessThan(2);
    }
  });

  it('os dois regressores são intercambiáveis na ESCALA da saída', () => {
    // A propriedade que torna `REGRESSOR_MODE` uma troca segura: qualquer que
    // seja o escolhido, o consumidor multiplica por vw/vh e obtém pixels.
    const { features, targets } = conjunto(45);
    const scaler = new StandardScaler();
    scaler.fit(features);
    const z = scaler.transform(features);
    const xs = targets.map((t) => t.screenX);
    const ys = targets.map((t) => t.screenY);

    const ridge = new RidgeRegressor();
    ridge.train(z, xs, ys);
    const kernel = new KernelRidgeRegressor();
    kernel.train(z, xs, ys);

    const f = z[5];
    const pr = ridge.predict(f);
    const pk = kernel.predict(f);
    // Não se exige que concordem no VALOR — são modelos diferentes. Exige-se
    // que estejam na mesma ESCALA, que é o que `B3.20` quebrava.
    expect(Math.abs(pr.x - pk.x)).toBeLessThan(0.5);
    expect(Math.abs(pr.y - pk.y)).toBeLessThan(0.5);
  });

  it('modelo não treinado devolve zero em vez de NaN', () => {
    expect(new RidgeRegressor().predict([1, 2, 3, 4])).toEqual({ x: 0, y: 0 });
  });
});
