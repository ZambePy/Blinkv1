import { describe, it, expect, beforeAll } from 'vitest';
import { SVRRegressor } from './svr';
import { StandardScaler } from './scaler';

// Diagnóstico (NÃO correção) da hipótese: o SVRRegressor com kernel LINEAR,
// sendo um modelo linear sem decaimento de kernel, pode extrapolar de forma
// instável quando o vetor de features em tempo real cai fora do fecho convexo
// dos pontos coletados na calibração — reintroduzindo o mesmo risco de
// saturação na borda que motivou a adoção do Kernel Ridge/RBF.
//
// Usa EXATAMENTE o mesmo fixture de ridge.convexhull.test.ts: grade 3×3
// sintética, 9 pontos de calibração, 4 features, mesmo probe (2× f0_max).
// Isso torna a comparação Ridge vs. KernelRidge vs. SVR direta e determinística.
//
// Este teste é de diagnóstico e NÃO implementa nenhuma correção.

const SCREEN_WIDTH  = 1920;
const SCREEN_HEIGHT = 1080;

beforeAll(() => {
  Object.defineProperty(document.documentElement, 'clientWidth', {
    value: SCREEN_WIDTH,
    configurable: true,
  });
  Object.defineProperty(document.documentElement, 'clientHeight', {
    value: SCREEN_HEIGHT,
    configurable: true,
  });
});

function buildSyntheticProfile() {
  const grid = [0.05, 0.5, 0.95];
  const features: number[][] = [];
  const targets: { screenX: number; screenY: number }[] = [];

  for (const gy of grid) {
    for (const gx of grid) {
      const f0 = (gx - 0.5) * 2; // [-0.9, 0.9]
      const f1 = (gy - 0.5) * 2; // [-0.9, 0.9]
      const f2 = 0.1 * (gx + gy);
      const f3 = 0.05;
      features.push([f0, f1, f2, f3]);
      targets.push({ screenX: gx, screenY: gy });
    }
  }
  return { features, targets };
}

describe('SVR: extrapolação fora do fecho convexo (diagnóstico)', () => {
  it('documenta o comportamento do SVRRegressor LINEAR para vetor fora do fecho convexo', () => {
    const { features, targets } = buildSyntheticProfile();

    const scaler = new StandardScaler();
    scaler.fit(features);
    const scaledFeatures = scaler.transform(features);
    const targetsX = targets.map(t => t.screenX);
    const targetsY = targets.map(t => t.screenY);

    const svr = new SVRRegressor();
    svr.train(scaledFeatures, targetsX, targetsY);

    // Ponto DENTRO do fecho convexo: centro da grade (gx=gy=0.5 → f0=f1=0)
    const inHullRaw    = [0, 0, 0.1, 0.05];
    const inHullScaled = scaler.transformSingle(inHullRaw);
    const inHullPred   = svr.predict(inHullScaled);

    // Probe FORA do fecho convexo: idêntico ao de ridge.convexhull.test.ts
    // f0 = 2× o valor máximo observado no treino (0.9 → 1.8)
    const maxF0Raw      = Math.max(...features.map(f => f[0]));
    const outOfHullRaw  = [maxF0Raw * 2, 0, 0.1, 0.05];
    const outOfHullScaled = scaler.transformSingle(outOfHullRaw);
    const outOfHullPred = svr.predict(outOfHullScaled);

    const svrSaturates = outOfHullPred.x === 0 || outOfHullPred.x === SCREEN_WIDTH;

    const errInHull    = Math.hypot(
      inHullPred.x    - 0.5  * SCREEN_WIDTH,
      inHullPred.y    - 0.5  * SCREEN_HEIGHT,
    );
    const errOutOfHull = Math.hypot(
      outOfHullPred.x - 0.95 * SCREEN_WIDTH,
      outOfHullPred.y - 0.5  * SCREEN_HEIGHT,
    );

    console.log('[svr-hull] inHull:    pred=(%s, %s)  err vs centro=%.1f px',
      inHullPred.x.toFixed(1), inHullPred.y.toFixed(1), errInHull);
    console.log('[svr-hull] outOfHull: pred=(%s, %s)  satura=%s  err vs borda-direita=%.1f px',
      outOfHullPred.x.toFixed(1), outOfHullPred.y.toFixed(1),
      svrSaturates ? 'SIM' : 'NÃO', errOutOfHull);
    console.log('[svr-hull] ratio errOutOfHull/errInHull=%.2f',
      errOutOfHull / (errInHull || 1e-9));
    console.log('[svr-hull] DIAGNÓSTICO: SVR LINEAR %s para probe out-of-hull',
      svrSaturates
        ? 'SATURA na borda — risco de extrapolação reintroduzido (mesmo comportamento do Ridge)'
        : 'NÃO satura — comportamento seguro');

    // Documentação do comportamento ATUAL.
    // O SVR LINEAR é um hiperplano global: extrapola além dos alvos de treino
    // quando o input sai do fecho convexo, e o predict() corta em [0,1].
    // Isso produz o mesmo salto para a borda que motivou a adoção do KR/RBF.
    //
    // Se esta asserção falhar no futuro, o comportamento de extrapolação mudou
    // — investigue a causa raiz antes de atualizar o teste.
    expect(svrSaturates).toBe(true);

    // Erro fora do hull deve ser maior que dentro dele.
    expect(errOutOfHull).toBeGreaterThan(errInHull);
  }, 60_000);
});
