import { describe, it, expect } from 'vitest';
import {
  extractCompactFeatures,
  projectFeatureSet,
  activeFeatureDims,
  featureVectorId,
  expandirPolinomioNoConjunto,
  SPEC11_DIMS,
  BlinkDetector,
} from './extractor';
import type { Point3D } from './extractor';

// -----------------------------------------------------------------------------
// P6.5 — o conjunto de 11 features da especificação, atrás de flag.
//
// ── Este é o conflito C6, e o repositório tem evidência CONTRA ──────────────
//
// O cabeçalho de `extractor.ts` registra a medição: ampliar o vetor com pose e
// interações degradou o erro de 140 px para 322 px, em duas gravações e em
// todos os k de calibração. A hipótese registrada é memorização de aglomerados
// — 9 alvos não determinam 45 parâmetros por olho.
//
// Por isso este conjunto entra como ALTERNATIVA a medir, sem trocar o default.
// A decisão sai do `F8.4`, com dado.
//
// ── O que a especificação pede, e o que o vetor tinha ───────────────────────
//
// Pedido: pitch, yaw, head_pitch, head_yaw, head_roll, distância_câmera,
// EAR_left, EAR_right, pitch×yaw, pitch², yaw².
//
// Dos 11, o vetor existente só tinha 5: os dois ângulos do L2CS ([37,38]) e os
// três de pose ([22..24]). Os outros seis NÃO EXISTIAM:
//
//   • distância da câmera — nunca entrou no vetor
//   • EAR dos DOIS olhos — o vetor é POR OLHO e carrega um `ear` só
//   • os três termos quadráticos do gaze — as interações [25..36] são
//     pose × offset, não gaze × gaze
//
// Ou seja: não dava para montar o conjunto selecionando índices. Foi preciso
// estender o vetor com um bloco novo, [44..49].
// -----------------------------------------------------------------------------

const W = 1920, H = 1080;

function rosto(): Point3D[] {
  const p: Point3D[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const olho = (cx: number, cy: number, e: number, d: number, c: number, b: number) => {
    p[e] = { x: cx - 0.03, y: cy, z: 0 };
    p[d] = { x: cx + 0.03, y: cy, z: 0 };
    p[c] = { x: cx, y: cy - 0.012, z: 0 };
    p[b] = { x: cx, y: cy + 0.012, z: 0 };
  };
  olho(0.40, 0.45, 33, 133, 159, 145);
  olho(0.60, 0.45, 362, 263, 386, 374);
  p[468] = { x: 0.405, y: 0.452, z: 0 };
  p[473] = { x: 0.605, y: 0.452, z: 0 };
  for (const i of [469, 470, 471, 472]) p[i] = { x: 0.40, y: 0.45, z: 0 };
  for (const i of [474, 475, 476, 477]) p[i] = { x: 0.60, y: 0.45, z: 0 };
  p[1] = { x: 0.5, y: 0.5, z: 0 };
  p[10] = { x: 0.5, y: 0.3, z: 0 };
  p[152] = { x: 0.5, y: 0.7, z: 0 };
  return p;
}

const GAZE = { yaw: 0.15, pitch: -0.08, valid: true, confidence: 0.9 };

describe('o conjunto existe e tem 11 dimensões', () => {
  it('SPEC11_DIMS é 11, como a especificação', () => {
    expect(SPEC11_DIMS).toBe(11);
    expect(activeFeatureDims('spec11')).toBe(11);
  });

  it('projeta exatamente 11 dimensões a partir do vetor completo', () => {
    const r = extractCompactFeatures(rosto(), undefined, GAZE, new BlinkDetector(), W, H);
    expect(projectFeatureSet(r.featuresLeft, 'spec11')).toHaveLength(11);
    expect(projectFeatureSet(r.featuresRight, 'spec11')).toHaveLength(11);
  });

  it('vetor curto demais para o conjunto é rejeitado, não truncado', () => {
    // Truncar em silêncio é o defeito de `B1.1`: o vetor sai com o
    // comprimento errado e o modelo aceita, porque o número de dimensões
    // "parece" plausível.
    expect(() => projectFeatureSet([1, 2, 3], 'spec11')).toThrow();
  });
});

describe('o conteúdo das 11 dimensões', () => {
  function vetor11() {
    const r = extractCompactFeatures(rosto(), undefined, GAZE, new BlinkDetector(), W, H);
    return { completo: r.featuresLeft, onze: projectFeatureSet(r.featuresLeft, 'spec11'), r };
  }

  it('as duas primeiras são os ângulos do L2CS', () => {
    const { completo, onze } = vetor11();
    expect(onze[0]).toBe(completo[37]);
    expect(onze[1]).toBe(completo[38]);
  });

  it('as três seguintes são a pose da cabeça', () => {
    const { completo, onze } = vetor11();
    expect(onze.slice(2, 5)).toEqual([completo[22], completo[23], completo[24]]);
  });

  it('a distância da câmera entrou no vetor — ela NÃO existia antes', () => {
    const { onze, r } = vetor11();
    expect(onze[5]).toBeCloseTo(r.advancedFeatures!.face.cameraDistanceEstimate, 9);
    expect(Number.isFinite(onze[5])).toBe(true);
  });

  it('os EAR dos DOIS olhos entram no MESMO vetor', () => {
    // O vetor é por olho e carregava um `ear` só. A especificação pede os dois,
    // então o bloco novo leva o par — e ele é idêntico nos vetores dos dois
    // olhos, como já acontece com a pose e o bloco angular.
    const r = extractCompactFeatures(rosto(), undefined, GAZE, new BlinkDetector(), W, H);
    const esq = projectFeatureSet(r.featuresLeft, 'spec11');
    const dir = projectFeatureSet(r.featuresRight, 'spec11');
    expect(esq[6]).toBeCloseTo(r.leftEAR!, 9);
    expect(esq[7]).toBeCloseTo(r.rightEAR!, 9);
    expect(dir[6]).toBeCloseTo(r.leftEAR!, 9);
    expect(dir[7]).toBeCloseTo(r.rightEAR!, 9);
  });

  it('os três últimos são a EXPANSÃO dos dois primeiros', () => {
    // Duas coisas de uma vez:
    //
    // 1. As interações [25..36] que já existiam são POSE × OFFSET. A
    //    especificação pede termos quadráticos do GAZE, que são outra coisa.
    // 2. Os quadráticos usam as MESMAS grandezas das features lineares. Se
    //    [0] é `tan(yaw)` e [9] fosse `yaw_cru²`, os dois descreveriam coisas
    //    diferentes — e aí desligar a expansão polinomial deixaria de fazer
    //    sentido, porque não haveria duplicata a evitar.
    const { onze } = vetor11();
    const yaw = onze[0], pitch = onze[1];
    expect(onze[8]).toBeCloseTo(yaw * pitch, 9);
    expect(onze[9]).toBeCloseTo(yaw * yaw, 9);
    expect(onze[10]).toBeCloseTo(pitch * pitch, 9);
  });

  it('os quadráticos são limitados — o clamp de ±π/4 do bloco garante', () => {
    // `tan` tem polo em ±π/2. `buildL2CSBlock` clampa em ±π/4 antes de
    // aplicá-la, então tan fica em [−1, 1] e o quadrado em [0, 1]. Sem esse
    // clamp, um gaze próximo de 90° produziria um termo quadrático enorme que
    // dominaria o Ridge inteiro.
    const r = extractCompactFeatures(
      rosto(), undefined, { yaw: 1.5, pitch: -1.5, valid: true, confidence: 0.9 },
      new BlinkDetector(), W, H,
    );
    const onze = projectFeatureSet(r.featuresLeft, 'spec11');
    expect(Math.abs(onze[9])).toBeLessThanOrEqual(1.0001);
    expect(Math.abs(onze[10])).toBeLessThanOrEqual(1.0001);
  });

  it('sem bloco L2CS, os termos de gaze zeram em vez de virar NaN', () => {
    const r = extractCompactFeatures(
      rosto(), undefined, { yaw: 0, pitch: 0, valid: false }, new BlinkDetector(), W, H,
    );
    const onze = projectFeatureSet(r.featuresLeft, 'spec11');
    expect(onze.every(Number.isFinite)).toBe(true);
  });
});

describe('a expansão polinomial NÃO se aplica a este conjunto', () => {
  it('spec11 já traz os termos quadráticos explícitos', () => {
    // Com `polynomialFeatures: true`, 11 dims viram 77. E os termos
    // quadráticos do gaze estariam DUPLICADOS: uma vez explícitos na
    // especificação, outra pela expansão. Duplicata em regressão linear não é
    // inofensiva — é colinearidade perfeita, que é exatamente o que o Ridge
    // regulariza contra, gastando λ para desfazer o que nós criamos.
    expect(expandirPolinomioNoConjunto('spec11')).toBe(false);
  });

  it('os demais conjuntos continuam expandindo', () => {
    expect(expandirPolinomioNoConjunto('irisCore+l2cs')).toBe(true);
    expect(expandirPolinomioNoConjunto('iris12')).toBe(true);
  });
});

describe('identidade do conjunto — um perfil não carrega no outro', () => {
  it('FEATURE_VECTOR_ID distingue spec11 dos demais', () => {
    const idSpec11 = featureVectorId('spec11');
    expect(idSpec11).toContain('spec11');
    expect(idSpec11).not.toBe(featureVectorId('irisCore+l2cs'));
    expect(idSpec11).not.toBe(featureVectorId('iris12+l2cs'));
  });

  it('o ID carrega a contagem de dimensões', () => {
    expect(featureVectorId('spec11')).toBe('spec11:11');
  });

  it('conjuntos de MESMA dimensão ainda têm IDs diferentes', () => {
    // Só a contagem não basta como identidade: dois conjuntos podem ter 11
    // dims e significar coisas completamente diferentes. Um perfil trocado
    // entre eles produziria predições plausíveis e erradas.
    const onzeDims = featureVectorId('spec11');
    const outro = featureVectorId('irisCore+l2cs+pose');
    expect(activeFeatureDims('irisCore+l2cs+pose')).toBe(11);
    expect(activeFeatureDims('spec11')).toBe(11);
    expect(onzeDims).not.toBe(outro);
  });
});
