import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  clearCalibration, startCalibrationMode, startCollectingPoint, feedRawData,
  completeCalibration, getEyeReliability, mapGaze,
} from './calibration';

// 3.2 — a fusão binocular era média simples, que supõe os dois olhos
// igualmente bons. Na gravação de referência eles não são:
//
//   só olho esquerdo   134,9 px     média dos dois   140,7 px
//   só olho direito    164,8 px
//
// A média saiu PIOR que o olho bom sozinho. E a razão sinal-ruído bruta da íris
// é praticamente igual nos dois (30,8 contra 31,3) — não dá para prever qual
// olho será melhor a partir da física, então a resposta é medir.

const q = () => ({
  yaw: 0.1, pitch: -0.05, roll: 0.01,
  irisVisibilityPercentage: 1, detectorConfidence: 0.99,
  brightnessEstimate: 0.24, contrastEstimate: 0.09, blurEstimate: 0,
});

/** Calibra com o olho esquerdo informativo e o direito com o ruído pedido. */
function calibrar(ruidoDireito: number) {
  let semente = 11;
  const rnd = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648 - 0.5; };
  startCalibrationMode();
  for (const [x, y] of [[0.2, 0.2], [0.5, 0.2], [0.8, 0.2], [0.2, 0.5], [0.5, 0.5],
                        [0.8, 0.5], [0.2, 0.8], [0.5, 0.8], [0.8, 0.8]]) {
    startCollectingPoint(x, y, () => {});
    for (let i = 0; i < 40; i++) {
      const esq = Array.from({ length: 8 }, (_, d) =>
        Math.sin(d * 1.7 + 0.3) * x + Math.cos(d * 2.3 + 1.1) * y + rnd() * 0.002);
      const dir = Array.from({ length: 8 }, (_, d) =>
        Math.sin(d * 1.7 + 0.3) * x + Math.cos(d * 2.3 + 1.1) * y + rnd() * ruidoDireito);
      feedRawData(esq, dir, q());
    }
  }
  return completeCalibration();
}

describe('confiabilidade por olho', () => {
  let relogio = 0;
  beforeEach(() => {
    clearCalibration();
    relogio = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (relogio += 80));
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('não existe antes de calibrar', () => {
    expect(getEyeReliability()).toBeNull();
  });

  it('olhos equivalentes dividem o peso ao meio — o comportamento antigo volta', () => {
    // É o que garante que a mudança não pode piorar um setup simétrico.
    calibrar(0.002);
    const r = getEyeReliability()!;
    expect(r.left).toBeCloseTo(0.5, 1);
    expect(r.left + r.right).toBeCloseTo(1, 9);
  });

  it('olho ruidoso recebe menos peso', () => {
    calibrar(0.5);
    const r = getEyeReliability()!;
    expect(r.left).toBeGreaterThan(r.right);
    expect(r.left).toBeGreaterThan(0.6);
  });

  it('quanto pior o olho, menor o peso — é monótono', () => {
    calibrar(0.1);
    const pouco = getEyeReliability()!.right;
    clearCalibration();
    calibrar(1.0);
    expect(getEyeReliability()!.right).toBeLessThan(pouco);
  });

  it('os pesos somam 1 e nenhum é negativo', () => {
    calibrar(2.0);
    const r = getEyeReliability()!;
    expect(r.left + r.right).toBeCloseTo(1, 9);
    expect(r.left).toBeGreaterThanOrEqual(0);
    expect(r.right).toBeGreaterThanOrEqual(0);
  });

  it('recalibrar recomeça a medição', () => {
    calibrar(0.5);
    expect(getEyeReliability()).not.toBeNull();
    startCalibrationMode();
    expect(getEyeReliability()).toBeNull();
  });

  it('a predição pende para o olho confiável', () => {
    calibrar(0.5);
    const r = getEyeReliability()!;
    // Alimenta os dois olhos com vetores que mapeiam para alvos diferentes; a
    // saída tem que ficar mais perto do que o olho confiável indica.
    const v = (x: number, y: number) => Array.from({ length: 8 }, (_, d) =>
      Math.sin(d * 1.7 + 0.3) * x + Math.cos(d * 2.3 + 1.1) * y);
    const p = mapGaze(v(0.2, 0.5), v(0.8, 0.5));
    expect(p).not.toBeNull();
    // Sem confiabilidade a saída cairia no meio; com ela, pende para a esquerda.
    expect(r.left).toBeGreaterThan(r.right);
  });
});
