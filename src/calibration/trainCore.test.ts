import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { treinarCalibracao } from './trainCore';
import { StandardScaler } from '../scaler';
import { RidgeRegressor } from '../ridge';
import { expandPolynomialFeatures } from './polynomial';
import { snapshotConfigDoRegressor, aplicarConfigDoRegressor } from './regressorConfig';

// -----------------------------------------------------------------------------
// A equivalência que ANTES NUNCA RODAVA.
//
// `client.test.ts` tinha o teste certo — "produz mesmos pesos que treino
// síncrono (tolerância 1e-9)" — atrás deste guard:
//
//     const hasWorker = typeof Worker !== 'undefined';
//     if (!hasWorker) { it.skip('sem Worker global disponível — skip', ...); return; }
//
// E **jsdom não implementa Web Workers**. Confirmado no ambiente do projeto:
// `typeof Worker === 'undefined'`. O `describe` inteiro retornava cedo, o teste
// real nunca era registrado, e a suíte ficava verde — o skip educado escondendo
// que a equivalência não era verificada em lugar nenhum.
//
// Com o núcleo de treino extraído de `calibration.worker.ts` para `trainCore.ts`
// (mesmo padrão de `P4.2` para a captura), a equivalência deixa de precisar de
// Worker: os dois lados chamam a MESMA função.
//
// ── O que continua sem cobertura, e é honesto dizer ─────────────────────────
//
// A clonagem estruturada do `postMessage`, o carregamento do módulo dentro do
// worker, e concorrência real. Nada disso roda em jsdom. O que fica provado
// aqui é a MATEMÁTICA; o transporte é coberto por `client.b3-10.test.ts` (a
// config viaja na mensagem) e, em runtime, pelo Dia 7.
// -----------------------------------------------------------------------------

/**
 * Conjunto com perfis de erro DIFERENTES por eixo: X bem predito, Y ruidoso.
 *
 * Isto importa para o teste de `axisScale`. Com um conjunto onde os dois eixos
 * têm o mesmo perfil, o CV escolhe o mesmo λ para qualquer escala e o teste não
 * discrimina nada — foi o que aconteceu na primeira tentativa, com os dois
 * lados devolvendo λ = 1000.
 */
function conjuntoAssimetrico() {
  let s = 42;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296 - 0.5;
  };
  const featuresLeft: number[][] = [];
  const featuresRight: number[][] = [];
  const targetsX: number[] = [];
  const targetsY: number[] = [];
  for (let a = 0; a < 9; a++) {
    const cx = (a % 3) / 2;
    const cy = Math.floor(a / 3) / 2;
    for (let i = 0; i < 8; i++) {
      featuresLeft.push([cx * 2 - 1 + rnd() * 0.02, cy * 2 - 1 + rnd() * 0.6, rnd() * 0.05, rnd() * 0.05]);
      featuresRight.push([cx * 2 - 1 + rnd() * 0.02, cy * 2 - 1 + rnd() * 0.6, rnd() * 0.05, rnd() * 0.05]);
      targetsX.push(cx);
      targetsY.push(cy);
    }
  }
  return { featuresLeft, featuresRight, targetsX, targetsY };
}

/** Conjunto sintético determinístico: 5 alvos × 6 amostras, 4 dims por olho. */
function conjunto() {
  let s = 42;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296 - 0.5;
  };
  const featuresLeft: number[][] = [];
  const featuresRight: number[][] = [];
  const targetsX: number[] = [];
  const targetsY: number[] = [];
  for (let a = 0; a < 5; a++) {
    const cx = (a % 3) / 2;
    const cy = Math.floor(a / 3) / 2;
    for (let i = 0; i < 6; i++) {
      featuresLeft.push(Array.from({ length: 4 }, () => rnd()));
      featuresRight.push(Array.from({ length: 4 }, () => rnd()));
      targetsX.push(cx);
      targetsY.push(cy);
    }
  }
  return { featuresLeft, featuresRight, targetsX, targetsY };
}

/** O caminho SÍNCRONO da main thread, escrito à mão para a comparação valer. */
function treinoSincrono(
  features: number[][],
  targetsX: number[],
  targetsY: number[],
  polinomial: boolean,
) {
  const exp = polinomial ? features.map((f) => expandPolynomialFeatures(f)) : features;
  const scaler = new StandardScaler();
  scaler.fit(exp);
  const reg = new RidgeRegressor();
  reg.train(scaler.transform(exp), targetsX, targetsY);
  return { scaler: scaler.getParams(), modelo: reg.getModel()! };
}

describe('treinarCalibracao — equivalência com o treino síncrono', () => {
  // ⚠️ `treinarCalibracao` ESCREVE nos estáticos do `RidgeRegressor` (é o que
  // faz o worker treinar com a config da main thread). Salvar e restaurar não
  // é zelo excessivo: sem isso, este arquivo mudaria o ambiente dos outros e a
  // suíte ficaria sensível à ordem — o padrão que a análise I.3 do plano lista
  // como problema estrutural.
  let salvo: ReturnType<typeof snapshotConfigDoRegressor>;
  beforeEach(() => { salvo = snapshotConfigDoRegressor(); });
  afterEach(() => { aplicarConfigDoRegressor(salvo); });

  for (const polinomial of [false, true]) {
    it(`produz os MESMOS pesos que o treino síncrono (polinomial=${polinomial})`, () => {
      const { featuresLeft, featuresRight, targetsX, targetsY } = conjunto();
      const config = snapshotConfigDoRegressor();

      const viaCore = treinarCalibracao({
        featuresLeft, featuresRight, targetsX, targetsY,
        polynomialFeatures: polinomial,
        regressorConfig: config,
      });

      const esqSinc = treinoSincrono(featuresLeft, targetsX, targetsY, polinomial);
      const dirSinc = treinoSincrono(featuresRight, targetsX, targetsY, polinomial);

      // Tolerância 1e-9, como o teste original pedia.
      expect(viaCore.modelLeft.betaX).toHaveLength(esqSinc.modelo.betaX.length);
      viaCore.modelLeft.betaX.forEach((v, i) => expect(v).toBeCloseTo(esqSinc.modelo.betaX[i], 9));
      viaCore.modelLeft.betaY.forEach((v, i) => expect(v).toBeCloseTo(esqSinc.modelo.betaY[i], 9));
      viaCore.modelRight.betaX.forEach((v, i) => expect(v).toBeCloseTo(dirSinc.modelo.betaX[i], 9));
      viaCore.modelRight.betaY.forEach((v, i) => expect(v).toBeCloseTo(dirSinc.modelo.betaY[i], 9));
    });
  }

  it('os scalers também batem', () => {
    const { featuresLeft, featuresRight, targetsX, targetsY } = conjunto();
    const viaCore = treinarCalibracao({
      featuresLeft, featuresRight, targetsX, targetsY,
      polynomialFeatures: true,
      regressorConfig: snapshotConfigDoRegressor(),
    });
    const sinc = treinoSincrono(featuresLeft, targetsX, targetsY, true);
    viaCore.scalerLeft.mean.forEach((v, i) => expect(v).toBeCloseTo(sinc.scaler.means[i], 9));
    viaCore.scalerLeft.std.forEach((v, i) => expect(v).toBeCloseTo(sinc.scaler.stds[i], 9));
  });
});

describe('B3.10 — a config estática MUDA o modelo, e por isso precisa viajar', () => {
  let salvo: ReturnType<typeof snapshotConfigDoRegressor>;
  beforeEach(() => { salvo = snapshotConfigDoRegressor(); });
  afterEach(() => { aplicarConfigDoRegressor(salvo); });

  it('treinar SEM a config produz modelo DIFERENTE de treinar com ela', () => {
    // É este o dano concreto do bug: um Web Worker tem registro de módulos
    // próprio, então `axisScale` valia `{1,1}` lá dentro e o CV escolhia λ
    // pesando X e Y igualmente. Em 1920×1080 isso subponderava o eixo X em
    // 3,16×.
    //
    // Se este teste passasse a NÃO ver diferença, significaria que `axisScale`
    // parou de influenciar o treino — e aí a correção de B3.10 teria virado
    // decorativa sem ninguém perceber.
    // ⚠️ Exige um conjunto ASSIMÉTRICO e `independentLambda` explícito.
    //
    // Com os dois eixos igualmente ruidosos, o CV escolhe o mesmo λ para
    // qualquer escala e o teste não discrimina nada — foi o que aconteceu na
    // primeira versão, com λ = 1000 dos dois lados. E `independentLambda` é um
    // ESTÁTICO global: sem fixá-lo aqui, o teste dependeria de quem rodou antes.
    const base = {
      ...conjuntoAssimetrico(),
      polynomialFeatures: false,
    };

    const comEscala = treinarCalibracao({
      ...base,
      regressorConfig: { ...salvo, independentLambda: true, axisScale: { x: 1920, y: 1080 } },
    });
    const semEscala = treinarCalibracao({
      ...base,
      regressorConfig: { ...salvo, independentLambda: true, axisScale: { x: 1, y: 1 } },
    });

    expect(comEscala.modelLeft.lambdaX).not.toBe(semEscala.modelLeft.lambdaX);
  });

  it('config ausente NÃO explode — cai no estado corrente do processo', () => {
    const { featuresLeft, featuresRight, targetsX, targetsY } = conjunto();
    expect(() => treinarCalibracao({
      featuresLeft, featuresRight, targetsX, targetsY,
      polynomialFeatures: false,
    })).not.toThrow();
  });

  it('é determinístico com a mesma entrada e a mesma config', () => {
    const { featuresLeft, featuresRight, targetsX, targetsY } = conjunto();
    const config = snapshotConfigDoRegressor();
    const req = {
      featuresLeft, featuresRight, targetsX, targetsY,
      polynomialFeatures: true, regressorConfig: config,
    };
    expect(treinarCalibracao(req)).toEqual(treinarCalibracao(req));
  });
});

describe('guardas', () => {
  let salvo: ReturnType<typeof snapshotConfigDoRegressor>;
  beforeEach(() => { salvo = snapshotConfigDoRegressor(); });
  afterEach(() => { aplicarConfigDoRegressor(salvo); });

  it('entrada VAZIA devolve um modelo degenerado — e isso é registrado aqui', () => {
    // ⚠️ Comportamento medido, não desejado.
    //
    // Eu esperava que lançasse. Não lança: `RidgeRegressor.train` com zero
    // amostras devolve um modelo com `betaX: []` — não-nulo, então a guarda
    // `if (!modelL || !modelR)` não pega. O resultado é um "modelo" que prediz
    // (0,0) para tudo, ou seja, cursor no canto da tela.
    //
    // Não está sendo corrigido aqui porque não é caminho alcançável: quem chama
    // é `completeCalibration`, que já barra sessões sem amostras
    // (`MIN_ACCEPTED_SAMPLES`). O teste existe para o dia em que outro chamador
    // aparecer — aí o comportamento estará documentado em vez de descoberto.
    const r = treinarCalibracao({
      featuresLeft: [], featuresRight: [], targetsX: [], targetsY: [],
      polynomialFeatures: false,
      regressorConfig: salvo,
    });
    expect(r.modelLeft.betaX).toHaveLength(0);
  });
});
