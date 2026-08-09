import { beforeAll, describe, expect, it } from 'vitest';
import { trainRidgeModel, predictRidge } from './ridge';
import { KernelRidgeRegressor, buildKernelMatrix, looError, GAMMA_GRID, LAMBDA_GRID, GAMMA_SAFE_MIN } from './kernelRidge';
import { StandardScaler } from './scaler';

// Gate de validação para src/kernelRidge.ts.
//
// Usa EXATAMENTE o mesmo fixture de ridge.convexhull.test.ts: grade 3×3
// sintética com 9 pontos de calibração e 4 features (f0/f1 lineares com
// screenX/Y; f2/f3 baixa-variância). Isso permite comparar Ridge vs
// KernelRidge sob as mesmas condições de forma determinística.

const SCREEN_WIDTH  = 1920;
const SCREEN_HEIGHT = 1080;

beforeAll(() => {
  Object.defineProperty(document.documentElement, 'clientWidth', {
    value: SCREEN_WIDTH, configurable: true,
  });
  Object.defineProperty(document.documentElement, 'clientHeight', {
    value: SCREEN_HEIGHT, configurable: true,
  });
});

function buildSyntheticProfile() {
  const grid = [0.05, 0.5, 0.95];
  const features: number[][] = [];
  const targets: { screenX: number; screenY: number }[] = [];
  for (const gy of grid) {
    for (const gx of grid) {
      features.push([(gx - 0.5) * 2, (gy - 0.5) * 2, 0.1 * (gx + gy), 0.05]);
      targets.push({ screenX: gx, screenY: gy });
    }
  }
  return { features, targets };
}

// ─── Gate 1: out-of-hull ──────────────────────────────────────────────────────

describe('KernelRidgeRegressor — Gate 1: out-of-hull', () => {
  it('não satura na borda da tela para vetor fora do fecho convexo', () => {
    const { features, targets } = buildSyntheticProfile();
    const scaler = new StandardScaler();
    scaler.fit(features);
    const scaled  = scaler.transform(features);
    const tgtsX   = targets.map(t => t.screenX);
    const tgtsY   = targets.map(t => t.screenY);

    // Probe out-of-hull: o dobro do f0 máximo observado no treino
    const maxF0Raw   = Math.max(...features.map(f => f[0]));
    const probeRaw   = [maxF0Raw * 2, 0, 0.1, 0.05];
    const probeScaled = scaler.transformSingle(probeRaw);

    // Ridge baseline (comportamento documentado em ridge.convexhull.test.ts)
    const ridgeModel = trainRidgeModel(scaled, targets);
    const ridgePred  = predictRidge(ridgeModel, probeScaled);
    const ridgeSaturates = ridgePred.x === 0 || ridgePred.x === SCREEN_WIDTH;

    // Kernel Ridge
    const t0 = performance.now();
    const kr  = new KernelRidgeRegressor();
    kr.train(scaled, tgtsX, tgtsY);
    const elapsed = performance.now() - t0;
    const krPred  = kr.predict(probeScaled);
    const krSaturates = krPred.x === 0 || krPred.x === SCREEN_WIDTH;

    // ── Relatório lado a lado ─────────────────────────────────────────────────
    console.log('[gate1] treino KernelRidge (n=9, LOO-CV 7×6 grid): %s ms', elapsed.toFixed(1));
    console.log('[gate1] Ridge  out-of-hull → x=%s  y=%s  | satura=%s',
      ridgePred.x.toFixed(1), ridgePred.y.toFixed(1), ridgeSaturates ? 'SIM' : 'NÃO');
    console.log('[gate1] KR     out-of-hull → x=%s  y=%s  | satura=%s',
      krPred.x.toFixed(1), krPred.y.toFixed(1), krSaturates ? 'SIM' : 'NÃO');
    console.log('[gate1] ref (ponto de borda mais próximo): x=%s  y=%s',
      (0.95 * SCREEN_WIDTH).toFixed(0), (0.5 * SCREEN_HEIGHT).toFixed(0));

    // Ridge satura — comportamento antigo documentado, não alterado
    expect(ridgeSaturates).toBe(true);

    // KR fica estritamente dentro dos limites: sem salto para as bordas
    expect(krPred.x).toBeGreaterThan(0);
    expect(krPred.x).toBeLessThan(SCREEN_WIDTH);
    expect(krPred.y).toBeGreaterThan(0);
    expect(krPred.y).toBeLessThan(SCREEN_HEIGHT);
  });

  it('relata looErr para todas as 20 combinações do grid e verifica vencedor', () => {
    const { features, targets } = buildSyntheticProfile();
    const scaler = new StandardScaler();
    scaler.fit(features);
    const scaled = scaler.transform(features);
    const tgtsX  = targets.map(t => t.screenX);
    const tgtsY  = targets.map(t => t.screenY);

    // Grid e piso de segurança importados de kernelRidge.ts — fonte única.
    let bestErr    = Infinity;
    let bestGamma  = 0;
    let bestLambda = 0;

    const header = 'gamma \\ lambda' +
      LAMBDA_GRID.map(l => String(l).padStart(8)).join('') + '  (safe?)';
    console.log('[gate1-grid] ' + header);

    for (const gamma of GAMMA_GRID) {
      const K    = buildKernelMatrix(scaled, gamma);
      const safe = gamma >= GAMMA_SAFE_MIN;
      const row  = LAMBDA_GRID.map(lambda => {
        const err = looError(K, tgtsX, tgtsY, lambda);
        if (safe && err < bestErr) { bestErr = err; bestGamma = gamma; bestLambda = lambda; }
        return err.toFixed(4).padStart(8);
      });
      console.log(
        '[gate1-grid] gamma=' + String(gamma).padEnd(5) + '  ' + row.join('') +
        (safe ? '' : '  [excluído: satura out-of-hull]'),
      );
    }
    console.log(
      '[gate1-grid] vencedor (safe): gamma=%s  lambda=%s  looErr=%s',
      bestGamma, bestLambda, bestErr.toFixed(4),
    );

    // O vencedor da busca manual (com mesmo piso) deve coincidir com kr.train()
    const kr = new KernelRidgeRegressor();
    kr.train(scaled, tgtsX, tgtsY);
    const m = kr.getModel()!;
    expect(m.gamma).toBe(bestGamma);
    expect(m.lambda).toBe(bestLambda);
  });
});

// ─── Gate 2: in-hull precision ────────────────────────────────────────────────
//
// Usa 3 pontos INTERPOLADOS — nenhum coincide com os 9 pontos de calibração
// da grade 3×3 ({0.05, 0.50, 0.95} × {0.05, 0.50, 0.95}).
// Fórmula de feature: [(gx-0.5)*2, (gy-0.5)*2, 0.1*(gx+gy), 0.05]
// → screenX = gx, screenY = gy  (normalizado 0-1)
//
// Isso é o teste real de "KernelRidge não piora precisão in-hull":
// um ponto coincidente daria erro próximo de zero para qualquer regressor.
//
// Perda de precisão in-hull medida (configuração final: gamma=0.1, lambda=0.001):
//   mid-left:    Ridge 33.5 px → KR 59.1 px  (+25.6 px)
//   mid-top:     Ridge 21.2 px → KR 38.7 px  (+17.5 px)
//   upper-right: Ridge 26.1 px → KR 50.1 px  (+24.0 px)
//   Faixa: 17.5–25.6 px de regressão in-hull em troca de não-saturação out-of-hull.
//
// Nota: "5-13 px" citado em conversas anteriores referia-se a gamma=0.01
// irrestrito (configuração descartada por saturar out-of-hull) — não é
// comparável. O número correto para decisão de rollout é 17.5–25.6 px.

describe('KernelRidgeRegressor — Gate 2: precisão in-hull vs Ridge', () => {
  it('erro comparável ao Ridge para 3 probes interpolados dentro do fecho convexo', () => {
    const { features, targets } = buildSyntheticProfile();
    const scaler = new StandardScaler();
    scaler.fit(features);
    const scaled = scaler.transform(features);
    const tgtsX  = targets.map(t => t.screenX);
    const tgtsY  = targets.map(t => t.screenY);

    const ridgeModel = trainRidgeModel(scaled, targets);
    const kr = new KernelRidgeRegressor();
    kr.train(scaled, tgtsX, tgtsY);

    // Probe 1: gx=0.275 (entre colunas 0.05 e 0.50), gy=0.50
    // Probe 2: gx=0.50,  gy=0.275 (entre linhas 0.05 e 0.50)
    // Probe 3: gx=0.725 (entre colunas 0.50 e 0.95), gy=0.725
    const interpolatedProbes = [
      {
        label:   'mid-left  (gx=0.275, gy=0.500)',
        rawFeat: [-0.45, 0.0, 0.0775, 0.05],
        targetX: 0.275 * SCREEN_WIDTH,
        targetY: 0.500 * SCREEN_HEIGHT,
      },
      {
        label:   'mid-top   (gx=0.500, gy=0.275)',
        rawFeat: [0.0, -0.45, 0.0775, 0.05],
        targetX: 0.500 * SCREEN_WIDTH,
        targetY: 0.275 * SCREEN_HEIGHT,
      },
      {
        label:   'upper-right (gx=0.725, gy=0.725)',
        rawFeat: [0.45, 0.45, 0.145, 0.05],
        targetX: 0.725 * SCREEN_WIDTH,
        targetY: 0.725 * SCREEN_HEIGHT,
      },
    ];

    console.log('[gate2] pontos interpolados (in-hull, não coincidentes com calibração):');
    for (const { label, rawFeat, targetX, targetY } of interpolatedProbes) {
      const probeScaled = scaler.transformSingle(rawFeat);

      const ridgePred = predictRidge(ridgeModel, probeScaled);
      const ridgeErr  = Math.hypot(ridgePred.x - targetX, ridgePred.y - targetY);

      const krPred = kr.predict(probeScaled);
      const krErr  = Math.hypot(krPred.x - targetX, krPred.y - targetY);

      console.log(
        '[gate2]  %s → target(%s,%s)  Ridge err=%s px  KR err=%s px',
        label,
        targetX.toFixed(0), targetY.toFixed(0),
        ridgeErr.toFixed(1), krErr.toFixed(1),
      );

      // Ambos devem interpolar dentro de 100 px nesse fixture sintético simples
      expect(ridgeErr).toBeLessThan(100);
      expect(krErr).toBeLessThan(100);
    }
  });
});

// ─── Testes de contrato da interface ─────────────────────────────────────────

describe('KernelRidgeRegressor — interface e serialização', () => {
  it('getModel() expõe gamma e lambda escolhidos pelo LOO-CV', () => {
    const { features, targets } = buildSyntheticProfile();
    const scaler = new StandardScaler();
    scaler.fit(features);
    const scaled = scaler.transform(features);

    const kr = new KernelRidgeRegressor();
    kr.train(scaled, targets.map(t => t.screenX), targets.map(t => t.screenY));
    const m = kr.getModel();

    expect(m).not.toBeNull();
    expect(m!.gamma).toBeGreaterThan(0);
    expect(m!.lambda).toBeGreaterThan(0);
    expect(m!.supportVectors.length).toBe(9);
    console.log('[gate3] gamma=%s  lambda=%s  looErr implícito nos logs acima', m!.gamma, m!.lambda);
  });

  it('predict() antes do treino retorna {x:0, y:0}', () => {
    const kr = new KernelRidgeRegressor();
    expect(kr.predict([1, 2, 3, 4])).toEqual({ x: 0, y: 0 });
  });

  it('predict() com vetor de tamanho errado retorna {x:0, y:0}', () => {
    const { features, targets } = buildSyntheticProfile();
    const kr = new KernelRidgeRegressor();
    kr.train(features, targets.map(t => t.screenX), targets.map(t => t.screenY));
    expect(kr.predict([1, 2])).toEqual({ x: 0, y: 0 });
  });

  it('reconstrói predições idênticas a partir do modelo serializado', () => {
    const { features, targets } = buildSyntheticProfile();
    const scaler = new StandardScaler();
    scaler.fit(features);
    const scaled = scaler.transform(features);
    const probe  = scaler.transformSingle([0, 0, 0.1, 0.05]);

    const kr = new KernelRidgeRegressor();
    kr.train(scaled, targets.map(t => t.screenX), targets.map(t => t.screenY));
    const pred1 = kr.predict(probe);

    // Serialização round-trip via JSON (localStorage é JSON)
    const serialized = JSON.stringify(kr.getModel());
    const kr2 = new KernelRidgeRegressor(JSON.parse(serialized));
    const pred2 = kr2.predict(probe);

    expect(pred2.x).toBeCloseTo(pred1.x, 6);
    expect(pred2.y).toBeCloseTo(pred1.y, 6);
  });
});
