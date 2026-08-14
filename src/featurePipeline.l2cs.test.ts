import { describe, it, expect } from 'vitest';
import { extractFeatures, USE_COMPACT_FEATURES } from './featurePipeline';
import { extractCompactFeatures } from './extractor';
import { buildL2CSBlock, L2CS_BLOCK_DIM } from './l2cs/block';
import type { Point3D } from './extractor';

// Reutiliza o mesmo shape do parity test para landmarks sintéticos
// determinísticos.
function makeLandmarks(): Point3D[] {
  return Array.from({ length: 478 }, (_, i) => ({
    x: 0.5 + 0.4 * Math.sin(i * 0.1357),
    y: 0.5 + 0.3 * Math.cos(i * 0.2137),
    z: 0.05 * Math.sin(i * 0.3577),
  }));
}

describe('E6 — anexo do bloco L2CS ao vetor por olho', () => {
  it('sem l2csGaze: comportamento idêntico ao pré-L2CS (parity mantida)', () => {
    const lms = makeLandmarks();
    const withoutArg = extractFeatures(lms);
    const explicitNull = extractFeatures(lms, undefined, null);
    const explicitUndefined = extractFeatures(lms, undefined, undefined);
    expect(withoutArg.featuresLeft.length).toBe(explicitNull.featuresLeft.length);
    expect(withoutArg.featuresLeft.length).toBe(explicitUndefined.featuresLeft.length);
    // Element-by-element idêntico
    for (let i = 0; i < withoutArg.featuresLeft.length; i++) {
      expect(withoutArg.featuresLeft[i]).toBe(explicitNull.featuresLeft[i]);
    }
  });

  it('gaze invalid: anexa 7 zeros no fim de ambos os vetores', () => {
    if (!USE_COMPACT_FEATURES) return; // path legado sem suporte
    const lms = makeLandmarks();
    const baseline = extractFeatures(lms);
    const withInvalid = extractFeatures(lms, undefined, {
      yaw: 0.3,
      pitch: 0.2,
      valid: false,
    });
    expect(withInvalid.featuresLeft.length).toBe(baseline.featuresLeft.length + L2CS_BLOCK_DIM);
    expect(withInvalid.featuresRight.length).toBe(baseline.featuresRight.length + L2CS_BLOCK_DIM);
    // Últimos 7 elementos = zeros (buildL2CSBlock com valid=false)
    for (let i = 0; i < L2CS_BLOCK_DIM; i++) {
      const idx = withInvalid.featuresLeft.length - L2CS_BLOCK_DIM + i;
      expect(withInvalid.featuresLeft[idx]).toBe(0);
      expect(withInvalid.featuresRight[idx]).toBe(0);
    }
  });

  it('gaze valid: os últimos 7 dims batem com buildL2CSBlock(...)', () => {
    if (!USE_COMPACT_FEATURES) return;
    const lms = makeLandmarks();
    const gaze = { yaw: 0.1, pitch: 0.05, valid: true };
    const result = extractFeatures(lms, undefined, gaze);

    // Precisamos do dProxy que o extractor usa (cameraDistanceEstimate).
    // Chamamos extractCompactFeatures diretamente para obter advancedFeatures.face.
    const direct = extractCompactFeatures(lms);
    const dProxy = direct.advancedFeatures!.face.cameraDistanceEstimate;
    const expected = buildL2CSBlock(gaze.yaw, gaze.pitch, gaze.valid, dProxy);

    for (let i = 0; i < L2CS_BLOCK_DIM; i++) {
      const idx = result.featuresLeft.length - L2CS_BLOCK_DIM + i;
      expect(result.featuresLeft[idx]).toBeCloseTo(expected[i], 12);
      expect(result.featuresRight[idx]).toBeCloseTo(expected[i], 12);
    }
  });

  it('ambos olhos recebem OS MESMOS 7 dims (gaze é face-level)', () => {
    if (!USE_COMPACT_FEATURES) return;
    const lms = makeLandmarks();
    const result = extractFeatures(lms, undefined, { yaw: 0.15, pitch: -0.1, valid: true });
    for (let i = 0; i < L2CS_BLOCK_DIM; i++) {
      const li = result.featuresLeft.length - L2CS_BLOCK_DIM + i;
      const ri = result.featuresRight.length - L2CS_BLOCK_DIM + i;
      expect(result.featuresLeft[li]).toBe(result.featuresRight[ri]);
    }
  });

  it('diff de tamanho é exatamente L2CS_BLOCK_DIM (nem mais, nem menos)', () => {
    if (!USE_COMPACT_FEATURES) return;
    const lms = makeLandmarks();
    const off = extractFeatures(lms);
    const on = extractFeatures(lms, undefined, { yaw: 0, pitch: 0, valid: true });
    expect(on.featuresLeft.length - off.featuresLeft.length).toBe(L2CS_BLOCK_DIM);
    expect(on.featuresRight.length - off.featuresRight.length).toBe(L2CS_BLOCK_DIM);
  });

  it('gaze extremo (fora do clamp) continua produzindo vetor finito', () => {
    if (!USE_COMPACT_FEATURES) return;
    const lms = makeLandmarks();
    const result = extractFeatures(lms, undefined, {
      yaw: Math.PI,   // > π/4 — vai ser clampeado no bloco
      pitch: -Math.PI,
      valid: true,
    });
    // Todos os elementos precisam ser finitos (nem NaN nem Infinity)
    for (const v of result.featuresLeft) expect(Number.isFinite(v)).toBe(true);
    for (const v of result.featuresRight) expect(Number.isFinite(v)).toBe(true);
  });
});
