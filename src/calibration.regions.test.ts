// D9 — benchmark de precisão POR REGIÃO: centro, bordas, quatro cantos e
// transições entre elas.
//
// Contexto: o relatório `accuracy-report-1787682565489` mostrou erro médio de
// 173 px. A decomposição afim dos 9 pares (ground-truth → predito) devolveu
// resíduo de 36,5 px — ou seja, 79% do erro era um mapa afim coerente
// (ganho X 1,294, ganho Y 0,930), não ruído. Um modelo linear nas features não
// consegue ganho > 1 no interior e acertar os extremos ao mesmo tempo: a
// amplitude de olhar registrada nos alvos tinha que ser menor que a nominal.
// Ver o cabeçalho de `computeCalibrationTargets` em calibration.ts.
//
// Este arquivo trava as duas coisas que a investigação estabeleceu:
//   1. A decomposição afim identifica corretamente cada família de erro.
//   2. O pipeline (StandardScaler + RidgeRegressor reais) atinge, por região,
//      erros dentro dos limites medidos — com atenção às regiões onde a UI
//      realmente coloca alvos.
//
// ⚠️ Os números vêm de um SIMULADOR (`testUtils/gazeSimulator`), não de
// gravação real — `fixtures/replay` é gitignored. Os limites abaixo são
// folgados de propósito: servem para pegar REGRESSÃO de pipeline, não para
// prometer precisão de campo.

import { describe, it, expect, beforeAll } from 'vitest';
import { StandardScaler } from './scaler';
import { RidgeRegressor } from './ridge';
import { affineErrorDecomposition, checkValidationOverlap } from './accuracy';
import {
  computeCalibrationTargets,
  MAX_ECCENTRICITY_DEG,
  DEFAULT_SCREEN_DIAGONAL_IN,
  DEFAULT_VIEWING_DISTANCE_CM,
} from './calibration';
import {
  simulateCalibration,
  GazeSimSession,
  SIM_DEFAULTS,
  SIM_SCREEN_W_PX,
  SIM_SCREEN_H_PX,
} from './testUtils/gazeSimulator';

const W = SIM_SCREEN_W_PX;
const H = SIM_SCREEN_H_PX;
const GEOMETRY = {
  screenWidthPx: W,
  screenHeightPx: H,
  screenDiagonalIn: DEFAULT_SCREEN_DIAGONAL_IN,
  viewingDistanceCm: DEFAULT_VIEWING_DISTANCE_CM,
  maxEccentricityDeg: MAX_ECCENTRICITY_DEG,
};

// Geometria REAL da interface: `GazeGrid` preenche o viewport e recomenda no
// máximo 6 alvos, então os centros das células caem em x ∈ {1/6, 1/2, 5/6} e
// y ∈ {1/4, 3/4}. Nenhum alvo interativo do app fica a menos de ~17% da borda.
const S6 = 1 / 6;
const S56 = 5 / 6;

const REGIONS = {
  centro: [{ x: 0.5, y: 0.5 }],
  bordas: [
    { x: 0.5, y: 0.25 }, { x: 0.5, y: 0.75 },
    { x: S6, y: 0.5 }, { x: S56, y: 0.5 },
  ],
  cantos: [
    { x: S6, y: 0.25 }, { x: S56, y: 0.25 },
    { x: S6, y: 0.75 }, { x: S56, y: 0.75 },
  ],
  transicoes: [
    { x: 0.25, y: 0.25 }, { x: 0.75, y: 0.25 },
    { x: 0.25, y: 0.75 }, { x: 0.75, y: 0.75 },
    { x: 0.375, y: 0.5 }, { x: 0.625, y: 0.5 },
    { x: 0.5, y: 0.375 }, { x: 0.5, y: 0.625 },
  ],
  gradeDoTeste: [
    { x: 0.25, y: 0.25 }, { x: 0.5, y: 0.25 }, { x: 0.75, y: 0.25 },
    { x: 0.25, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.75, y: 0.5 },
    { x: 0.25, y: 0.75 }, { x: 0.5, y: 0.75 }, { x: 0.75, y: 0.75 },
  ],
} as const;

type Region = keyof typeof REGIONS;

interface Fitted {
  predict(l: number[], r: number[]): { x: number; y: number };
}

function trainPipeline(seed: number, targets: readonly { x: number; y: number }[]): Fitted {
  const { featuresLeft, featuresRight, targetsX, targetsY } =
    simulateCalibration(targets, { seed });
  const scL = new StandardScaler(); scL.fit(featuresLeft);
  const scR = new StandardScaler(); scR.fit(featuresRight);
  const regL = new RidgeRegressor(); regL.train(scL.transform(featuresLeft), targetsX, targetsY);
  const regR = new RidgeRegressor(); regR.train(scR.transform(featuresRight), targetsX, targetsY);
  return {
    predict(l, r) {
      const a = regL.predict(scL.transformSingle(l));
      const b = regR.predict(scR.transformSingle(r));
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    },
  };
}

/** Erro médio (px) e jitter RMS (px) de uma região, com sessão fresca. */
function measureRegion(seed: number, fit: Fitted, region: Region) {
  const session = new GazeSimSession({ ...SIM_DEFAULTS, seed: seed + 1 });
  const errors: number[] = [];
  const jitters: number[] = [];
  const pairs: { groundX: number; groundY: number; predX: number; predY: number }[] = [];

  for (const t of REGIONS[region]) {
    session.advancePoint();
    const xs: number[] = [];
    const ys: number[] = [];
    for (let f = 0; f < 30; f++) {
      const [l, r] = session.frame(t.x, t.y);
      const p = fit.predict(l, r);
      xs.push(p.x * W);
      ys.push(p.y * H);
    }
    const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
    const my = ys.reduce((s, v) => s + v, 0) / ys.length;
    errors.push(Math.hypot(mx - t.x * W, my - t.y * H));
    let sq = 0;
    for (let i = 0; i < xs.length; i++) sq += (xs[i] - mx) ** 2 + (ys[i] - my) ** 2;
    jitters.push(Math.sqrt(sq / xs.length));
    pairs.push({ groundX: t.x * W, groundY: t.y * H, predX: mx, predY: my });
  }
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  return { error: mean(errors), jitter: mean(jitters), pairs };
}

const SEEDS = [7919, 15838, 23757];

// Treinar o pipeline é a parte cara (CV de 22 λ × 9 folds por olho). Sem
// memoização, cada asserção por região retreinaria tudo e a suíte levaria
// minutos. A chave inclui as posições dos alvos porque comparamos protocolos.
const fitCache = new Map<string, Fitted>();
function cachedFit(seed: number, targets: readonly { x: number; y: number }[]): Fitted {
  const key = `${seed}|${targets.map((t) => `${t.x.toFixed(4)},${t.y.toFixed(4)}`).join(';')}`;
  let fit = fitCache.get(key);
  if (!fit) {
    fit = trainPipeline(seed, targets);
    fitCache.set(key, fit);
  }
  return fit;
}

function meanOverSeeds(targets: readonly { x: number; y: number }[], region: Region) {
  const errs = SEEDS.map((s) => measureRegion(s, cachedFit(s, targets), region).error);
  return errs.reduce((a, b) => a + b, 0) / errs.length;
}

// Protocolos comparados. `LEGACY_TARGETS` é a grade 5%/95% de antes do D9.
const LEGACY_TARGETS = [
  { x: 0.05, y: 0.05 }, { x: 0.5, y: 0.05 }, { x: 0.95, y: 0.05 },
  { x: 0.05, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.95, y: 0.5 },
  { x: 0.05, y: 0.95 }, { x: 0.5, y: 0.95 }, { x: 0.95, y: 0.95 },
];
const NEW_TARGETS = computeCalibrationTargets(GEOMETRY, false);

// Aquece o cache num hook com timeout próprio: treinar os 6 pipelines
// (2 protocolos × 3 sementes) leva alguns segundos e estouraria o timeout
// default de 5 s do primeiro `it` que precisasse deles.
beforeAll(() => {
  for (const seed of SEEDS) {
    cachedFit(seed, NEW_TARGETS);
    cachedFit(seed, LEGACY_TARGETS);
  }
}, 120_000);

// ── Decomposição afim ────────────────────────────────────────────────────────

describe('D9 — decomposição afim do erro (diagnóstico)', () => {
  const grid = REGIONS.gradeDoTeste;

  it('erro puramente afim é reconhecido como afim (resíduo ~0)', () => {
    // Reproduz exatamente o mapa medido no relatório real.
    const pairs = grid.map((t) => ({
      groundX: t.x * W,
      groundY: t.y * H,
      predX: (1.2937 * t.x - 0.0309 * t.y - 0.1353) * W,
      predY: (-0.173 * t.x + 0.9305 * t.y + 0.2359) * H,
    }));
    const meanError =
      pairs.reduce((s, p) => s + Math.hypot(p.predX - p.groundX, p.predY - p.groundY), 0) /
      pairs.length;
    const a = affineErrorDecomposition(pairs, W, H, meanError);
    expect(a).toBeDefined();
    expect(a!.gainX).toBeCloseTo(1.2937, 3);
    expect(a!.gainY).toBeCloseTo(0.9305, 3);
    expect(a!.shearYX).toBeCloseTo(-0.173, 3);
    expect(a!.residualPx).toBeLessThan(1);
    expect(a!.explainedFraction).toBeGreaterThan(0.99);
  });

  it('erro incoerente NÃO é explicado por mapa afim', () => {
    // Deslocamentos alternados: nenhum mapa afim os reproduz.
    const pairs = grid.map((t, i) => ({
      groundX: t.x * W,
      groundY: t.y * H,
      predX: t.x * W + (i % 2 === 0 ? 120 : -120),
      predY: t.y * H + (i % 3 === 0 ? -110 : 110),
    }));
    const meanError =
      pairs.reduce((s, p) => s + Math.hypot(p.predX - p.groundX, p.predY - p.groundY), 0) /
      pairs.length;
    const a = affineErrorDecomposition(pairs, W, H, meanError);
    expect(a).toBeDefined();
    expect(a!.explainedFraction).toBeLessThan(0.4);
  });

  it('devolve undefined com menos de 4 pontos (3 parâmetros por eixo)', () => {
    const pairs = grid.slice(0, 3).map((t) => ({
      groundX: t.x * W, groundY: t.y * H, predX: t.x * W, predY: t.y * H,
    }));
    expect(affineErrorDecomposition(pairs, W, H, 10)).toBeUndefined();
  });
});

// ── Precisão por região ──────────────────────────────────────────────────────

describe('D9 — precisão por região (centro, bordas, cantos, transições)', () => {
  const targets = NEW_TARGETS;

  // Limites medidos no simulador com as 3 sementes de SEEDS, na geometria de
  // referência (23,6" a 60 cm, orçamento de 16°). Valor observado entre
  // parênteses; folga de ~50% para não virar teste flaky.
  //
  // Entre parênteses também o valor do protocolo antigo (5%/95%), para deixar
  // registrado no próprio teste o tamanho do ganho:
  const BOUNDS: Record<Region, number> = {
    centro: 20,       // observado 9,5 px  (legado 10,1)
    bordas: 28,       // observado 15,6 px (legado 65,3)
    cantos: 32,       // observado 18,0 px (legado 117,9)
    transicoes: 58,   // observado 37,7 px (legado 103,6)
    gradeDoTeste: 58, // observado 36,7 px (legado 106,7)
  };

  for (const region of Object.keys(BOUNDS) as Region[]) {
    it(`${region}: erro médio dentro do limite de regressão`, () => {
      const err = meanOverSeeds(targets, region);
      expect(err).toBeLessThan(BOUNDS[region]);
      expect(Number.isFinite(err)).toBe(true);
    });
  }

  it('nenhuma região é catastroficamente pior que o centro', () => {
    const centro = meanOverSeeds(targets, 'centro');
    for (const region of ['bordas', 'cantos', 'transicoes'] as Region[]) {
      const err = meanOverSeeds(targets, region);
      // Erro de borda/canto pode ser maior que o do centro (extrapolação),
      // mas não uma ordem de grandeza — isso seria colapso do modelo.
      expect(err).toBeLessThan(Math.max(centro * 4, 120));
    }
  });

  it('jitter no centro fica na ordem do medido em campo (~30-50 px), não explode', () => {
    const seed = SEEDS[0];
    const { jitter } = measureRegion(seed, cachedFit(seed, targets), 'centro');
    expect(jitter).toBeGreaterThan(0);
    expect(jitter).toBeLessThan(120);
  });
});

// ── Orçamento de excentricidade vs. protocolo antigo (5%/95%) ────────────────

describe('D9 — guarda de contaminação treino→teste', () => {
  // A grade de calibração agora depende da geometria configurada. Para certas
  // combinações de tela/distância ela pode cair EM CIMA da grade de validação,
  // e aí o teste de precisão mede memorização em vez de generalização — o
  // número fica bom pelo motivo errado.
  //
  // O caso concreto é o orçamento de 12° na tela de referência: ele põe os
  // alvos em x ∈ {25,6%, 50%, 74,4%} e y ∈ {6,6%, 50%, 93,4%}. A LINHA DO MEIO
  // (y = 50%) cai exatamente sobre P4/P5/P6.
  //
  // ⚠️ Coincidir só num eixo NÃO é vazamento. P1 (25%, 25%) divide a coluna x
  // com um alvo de calibração, mas o alvo mais próximo está em (25,6%, 6,6%) —
  // é outro ponto do espaço de entrada, e prever ali continua sendo
  // generalização. Por isso o guarda exige coincidência nos DOIS eixos.

  const VALIDATION = [
    { name: 'P1', screenX: 0.25, screenY: 0.25 },
    { name: 'P2', screenX: 0.5, screenY: 0.25 },
    { name: 'P3', screenX: 0.75, screenY: 0.25 },
    { name: 'P4', screenX: 0.25, screenY: 0.5 },
    { name: 'P5', screenX: 0.5, screenY: 0.5 },
    { name: 'P6', screenX: 0.75, screenY: 0.5 },
    { name: 'P7', screenX: 0.25, screenY: 0.75 },
    { name: 'P8', screenX: 0.5, screenY: 0.75 },
    { name: 'P9', screenX: 0.75, screenY: 0.75 },
  ];

  it('detecta a colisão que o orçamento de 12° produz na tela de referência', () => {
    const colidente = computeCalibrationTargets({ ...GEOMETRY, maxEccentricityDeg: 12 }, false);
    const hits = checkValidationOverlap(colidente, VALIDATION);
    // P4 e P6 exatamente: a linha do meio da calibração (y = 50%) coincide com
    // a linha do meio da validação, e aí x = 25,6%/74,4% fecha os dois eixos.
    // P5 é o centro, excluído por convenção. P1/P3/P7/P9 dividem só a coluna x.
    expect(hits.map((h) => h.validationPoint).sort()).toEqual(['P4', 'P6']);
  });

  it('o orçamento escolhido NÃO contamina a grade de validação', () => {
    expect(checkValidationOverlap(NEW_TARGETS, VALIDATION)).toEqual([]);
  });

  it('o protocolo legado 5%/95% também era limpo', () => {
    expect(checkValidationOverlap(LEGACY_TARGETS, VALIDATION)).toEqual([]);
  });

  it('não acusa colisão quando os alvos estão longe', () => {
    const longe = [{ x: 0.5, y: 0.05 }, { x: 0.05, y: 0.5 }];
    expect(checkValidationOverlap(longe, VALIDATION)).toEqual([]);
  });
});

describe('D9 — orçamento de excentricidade bate o protocolo 5%/95%', () => {
  it('a grade nova não coincide com a antiga no eixo X (e coincide no Y)', () => {
    // A assimetria é o ponto: 12° cobre a altura inteira da tela, mas não a
    // largura. É a mesma assimetria que o relatório real mediu.
    const xs = [...new Set(NEW_TARGETS.map((t) => t.x))].sort((a, b) => a - b);
    const ys = [...new Set(NEW_TARGETS.map((t) => t.y))].sort((a, b) => a - b);
    expect(xs[0]).toBeGreaterThan(0.05);
    expect(ys[0]).toBeCloseTo(0.05, 2);
  });

  it('reduz o erro nas regiões onde a UI de fato coloca alvos', () => {
    for (const region of ['cantos', 'bordas', 'transicoes', 'gradeDoTeste'] as Region[]) {
      const legacy = meanOverSeeds(LEGACY_TARGETS, region);
      const novo = meanOverSeeds(NEW_TARGETS, region);
      expect(novo, `${region}: novo=${novo.toFixed(0)}px legacy=${legacy.toFixed(0)}px`)
        .toBeLessThan(legacy);
    }
  });

  it('não degrada o centro', () => {
    const legacy = meanOverSeeds(LEGACY_TARGETS, 'centro');
    const novo = meanOverSeeds(NEW_TARGETS, 'centro');
    expect(novo).toBeLessThan(legacy * 1.25);
  });
});
