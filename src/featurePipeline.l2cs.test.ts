import { describe, it, expect } from 'vitest';
import { extractFeatures, USE_COMPACT_FEATURES } from './featurePipeline';
import { extractCompactFeatures, projectFeatureSet, IRIS12_DIMS, activeFeatureDims } from './extractor';
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

// D11 — estes testes cobrem o ANEXO do bloco L2CS, que é responsabilidade de
// `extractCompactFeatures`. Antes eles observavam esse comportamento através de
// `extractFeatures`, o que funcionava porque o pipeline repassava o vetor
// inteiro. Com a projeção no conjunto ativo (ver `ACTIVE_FEATURE_SET`), a
// fronteira do pipeline passou a devolver 12 dims — então a asserção correta é
// direto no extractor. A projeção em si tem cobertura própria no fim do arquivo.
const extractFull = (
  lms: Point3D[],
  faceMatrix?: Float32Array,
  l2csGaze?: Parameters<typeof extractCompactFeatures>[2],
) => extractCompactFeatures(lms, faceMatrix, l2csGaze);

describe('E6 — anexo do bloco L2CS ao vetor por olho', () => {
  it('sem l2csGaze: comportamento idêntico ao pré-L2CS (parity mantida)', () => {
    const lms = makeLandmarks();
    const withoutArg = extractFull(lms);
    const explicitNull = extractFull(lms, undefined, null);
    const explicitUndefined = extractFull(lms, undefined, undefined);
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
    const baseline = extractFull(lms);
    const withInvalid = extractFull(lms, undefined, {
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
    const result = extractFull(lms, undefined, gaze);

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
    const result = extractFull(lms, undefined, { yaw: 0.15, pitch: -0.1, valid: true });
    for (let i = 0; i < L2CS_BLOCK_DIM; i++) {
      const li = result.featuresLeft.length - L2CS_BLOCK_DIM + i;
      const ri = result.featuresRight.length - L2CS_BLOCK_DIM + i;
      expect(result.featuresLeft[li]).toBe(result.featuresRight[ri]);
    }
  });

  it('diff de tamanho é exatamente L2CS_BLOCK_DIM (nem mais, nem menos)', () => {
    if (!USE_COMPACT_FEATURES) return;
    const lms = makeLandmarks();
    const off = extractFull(lms);
    const on = extractFull(lms, undefined, { yaw: 0, pitch: 0, valid: true });
    expect(on.featuresLeft.length - off.featuresLeft.length).toBe(L2CS_BLOCK_DIM);
    expect(on.featuresRight.length - off.featuresRight.length).toBe(L2CS_BLOCK_DIM);
  });

  it('gaze extremo (fora do clamp) continua produzindo vetor finito', () => {
    if (!USE_COMPACT_FEATURES) return;
    const lms = makeLandmarks();
    const result = extractFull(lms, undefined, {
      yaw: Math.PI,   // > π/4 — vai ser clampeado no bloco
      pitch: -Math.PI,
      valid: true,
    });
    // Todos os elementos precisam ser finitos (nem NaN nem Infinity)
    for (const v of result.featuresLeft) expect(Number.isFinite(v)).toBe(true);
    for (const v of result.featuresRight) expect(Number.isFinite(v)).toBe(true);
  });

  it('vetor COMPLETO tem sempre 44 dims quando l2csGaze != null, independente de valid', () => {
    if (!USE_COMPACT_FEATURES) return;
    const lms = makeLandmarks();
    
    const withValid = extractFull(lms, undefined, { yaw: 0, pitch: 0, valid: true });
    expect(withValid.featuresLeft).toHaveLength(44);
    expect(withValid.featuresRight).toHaveLength(44);
    
    const withInvalid = extractFull(lms, undefined, { yaw: 0, pitch: 0, valid: false });
    expect(withInvalid.featuresLeft).toHaveLength(44);
    expect(withInvalid.featuresRight).toHaveLength(44);
  });
});


// ─── D11 — projeção no conjunto de features ativo ───────────────────────────
describe('D11 — projeção do vetor no conjunto ativo', () => {
  it('a fronteira do pipeline entrega exatamente activeFeatureDims dims', () => {
    const lms = makeLandmarks();
    const piped = extractFeatures(lms, undefined, { yaw: 0.1, pitch: 0.05, valid: true });
    const dims = activeFeatureDims() as number;
    expect(piped.featuresLeft).toHaveLength(dims);
    expect(piped.featuresRight).toHaveLength(dims);
  });

  it('as dimensões entregues são o PREFIXO exato do vetor completo (sem reordenar)', () => {
    // Reordenar silenciosamente seria o pior tipo de bug aqui: o modelo
    // treinaria e prediria com significados trocados, sem erro nenhum.
    const lms = makeLandmarks();
    const full = extractCompactFeatures(lms, undefined, { yaw: 0.1, pitch: 0.05, valid: true });
    const piped = extractFeatures(lms, undefined, { yaw: 0.1, pitch: 0.05, valid: true });
    const dims = activeFeatureDims() as number;
    for (let i = 0; i < dims; i++) {
      expect(piped.featuresLeft[i]).toBe(full.featuresLeft[i]);
      expect(piped.featuresRight[i]).toBe(full.featuresRight[i]);
    }
  });

  it('o bloco L2CS não influencia mais o vetor entregue ao modelo', () => {
    // Consequência direta da projeção: com L2CS válido ou inválido, o modelo vê
    // o mesmo vetor. É o que isola o pipeline do bug do crop preto (D10) até
    // haver gravação nova que avalie o bloco funcionando.
    const lms = makeLandmarks();
    const comValido = extractFeatures(lms, undefined, { yaw: 0.2, pitch: 0.1, valid: true });
    const comInvalido = extractFeatures(lms, undefined, { yaw: 0, pitch: 0, valid: false });
    expect(comValido.featuresLeft).toEqual(comInvalido.featuresLeft);
    expect(comValido.featuresRight).toEqual(comInvalido.featuresRight);
  });

  it("projectFeatureSet('compact') é identidade", () => {
    const v = Array.from({ length: 44 }, (_, i) => i * 1.5);
    expect(projectFeatureSet(v, 'compact')).toEqual(v);
  });

  it('projectFeatureSet preserva vetor vazio (frame sem rosto)', () => {
    expect(projectFeatureSet([], 'iris12')).toEqual([]);
  });
});
