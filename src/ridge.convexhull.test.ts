import { describe, it, expect, beforeAll } from 'vitest';
import { trainRidgeModel, predictRidge } from './ridge';
import { StandardScaler } from './scaler';

// Diagnóstico (NÃO correção) da hipótese: o Ridge de ridge.ts, por ser um
// modelo linear regularizado sem termo de kernel/expansão polinomial, pode
// extrapolar de forma instável quando o vetor de features em tempo real cai
// fora do fecho convexo dos pontos coletados na calibração.
//
// Este teste é determinístico (não depende de webcam) e documenta o
// comportamento ATUAL. Não implementa nenhum guard-rail de distância nem
// migração para Kernel Ridge — isso é decisão futura.

const SCREEN_WIDTH = 1920;
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

/**
 * Perfil de calibração sintético: grade 3x3 (replica os 9 pontos de
 * TARGET_POINTS em calibration.ts). 4 features: f0/f1 têm relação linear
 * "verdadeira" com a posição do olhar (gx, gy); f2/f3 são baixa-variância,
 * análogas às muitas dimensões quase-constantes do vetor real de 53 dims
 * produzido por extractor.ts.
 */
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

function nearestDistance(vec: number[], pool: number[][]): number {
  let best = Infinity;
  for (const p of pool) {
    let s = 0;
    for (let i = 0; i < vec.length; i++) s += (vec[i] - p[i]) ** 2;
    best = Math.min(best, Math.sqrt(s));
  }
  return best;
}

describe('Ridge: extrapolação fora do fecho convexo (diagnóstico)', () => {
  it('documenta o salto desproporcional de predictRidge para um vetor fora do fecho convexo', () => {
    const { features, targets } = buildSyntheticProfile();

    // Mesma pipeline de calibration.ts: fit do StandardScaler sobre o
    // perfil, treino do Ridge sobre features JÁ normalizadas.
    const scaler = new StandardScaler();
    scaler.fit(features);
    const scaledFeatures = scaler.transform(features);
    const model = trainRidgeModel(scaledFeatures, targets); // lambda default = 1.0, igual à produção

    // Ponto DENTRO do fecho convexo: centro da grade (gx=gy=0.5 → f0=f1=0)
    const inHullRaw = [0, 0, 0.1, 0.05];
    const inHullScaled = scaler.transformSingle(inHullRaw);
    const inHullPred = predictRidge(model, inHullScaled);
    const distInHull = nearestDistance(inHullScaled, scaledFeatures);

    // Vetor FORA do fecho convexo: 2x o valor máximo observado em f0 (raw),
    // conforme sugerido no enunciado da tarefa.
    const maxF0Raw = Math.max(...features.map(f => f[0]));
    const outOfHullRaw = [maxF0Raw * 2, 0, 0.1, 0.05];
    const outOfHullScaled = scaler.transformSingle(outOfHullRaw);
    const outOfHullPred = predictRidge(model, outOfHullScaled);
    const distOutOfHull = nearestDistance(outOfHullScaled, scaledFeatures);

    // Erro vs. o alvo geometricamente mais plausível para cada vetor: o
    // centro da grade para o ponto in-hull, e o ponto de borda direita
    // (gx=0.95) para o vetor out-of-hull, já que f0 alto deveria significar
    // "olhando para a direita".
    // Sprint 4: predictRidge agora retorna coordenadas normalizadas [0,1].
    // Erros aqui também são normalizados; multiplique por SCREEN_* na UI.
    const errInHull = Math.hypot(
      inHullPred.x - 0.5,
      inHullPred.y - 0.5
    );
    const errOutOfHull = Math.hypot(
      outOfHullPred.x - 0.95,
      outOfHullPred.y - 0.5
    );

    console.log('[diagnóstico] inHull:  distNearest=%s pred=(%s, %s) err=%s',
      distInHull.toFixed(3), inHullPred.x.toFixed(4), inHullPred.y.toFixed(4), errInHull.toFixed(4));
    console.log('[diagnóstico] outOfHull: distNearest=%s pred=(%s, %s) err=%s',
      distOutOfHull.toFixed(3), outOfHullPred.x.toFixed(4), outOfHullPred.y.toFixed(4), errOutOfHull.toFixed(4));
    console.log('[diagnóstico] razão distância (outOfHull/inHull)=%s razão erro (outOfHull/inHull)=%s',
      (distOutOfHull / (distInHull || 1e-9)).toFixed(2),
      (errOutOfHull / (errInHull || 1e-9)).toFixed(2));

    // 1) O vetor construído está de fato mais longe do ponto de calibração
    //    mais próximo do que o ponto de referência in-hull.
    expect(distOutOfHull).toBeGreaterThan(distInHull);

    // 2) Comportamento ATUAL documentado (Sprint 1.2): predictRidge NÃO
    //    aplica mais clamp. A extrapolação linear ultrapassa a faixa [0,1]
    //    livremente; o clamp é feito APÓS a média binocular em
    //    `calibration.mapGaze`. Esta asserção verifica que o valor extrapolado
    //    saiu fora do intervalo [0,1] — se cair dentro, o vetor não é
    //    verdadeiramente "out of hull" ou a semântica do modelo mudou.
    expect(outOfHullPred.x < 0 || outOfHullPred.x > 1).toBe(true);

    // 3) O erro fora do fecho convexo é desproporcional ao erro dentro dele.
    //    Se esta asserção falhar no futuro, é porque o comportamento de
    //    extrapolação foi corrigido (guard-rail de distância / Kernel Ridge)
    //    — não "conserte" este teste às cegas, revise-o.
    expect(errOutOfHull).toBeGreaterThan(errInHull);
  });
});
