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

// Estes testes cobrem o ANEXO do bloco L2CS, que é responsabilidade de
// `extractCompactFeatures`. Com a projeção no conjunto ativo (ver
// `ACTIVE_FEATURE_SET`), a fronteira do pipeline devolve a dimensão do
// conjunto (6 dims hoje para `irisCore+l2cs`) — então a asserção do bloco
// angular COMPLETO precisa ser feita direto no extractor. A projeção em si
// tem cobertura própria no fim do arquivo.
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
    // ⚠️ O bloco L2CS NÃO é mais o final do vetor.
    //
    // `P6.5` acrescentou o bloco `spec11` em [44..49], então "os últimos 7"
    // deixou de localizar o bloco angular — passou a apanhar os quadráticos do
    // gaze e os EAR. O índice FIXO [37..43] é a única forma estável de apontar
    // para ele, e é a mesma lição que `l2csSlotsInSet` já tinha registrado:
    // localizar bloco por posição relativa ao fim quebra quando o vetor cresce.
    expect(withInvalid.featuresLeft.length).toBe(baseline.featuresLeft.length + L2CS_BLOCK_DIM + 6);
    expect(withInvalid.featuresRight.length).toBe(baseline.featuresRight.length + L2CS_BLOCK_DIM + 6);
    for (let i = 0; i < L2CS_BLOCK_DIM; i++) {
      expect(withInvalid.featuresLeft[37 + i]).toBe(0);
      expect(withInvalid.featuresRight[37 + i]).toBe(0);
    }
  });

  it('gaze valid: o bloco em [37..43] bate com buildL2CSBlock(...)', () => {
    if (!USE_COMPACT_FEATURES) return;
    const lms = makeLandmarks();
    const gaze = { yaw: 0.1, pitch: 0.05, valid: true };
    const result = extractFull(lms, undefined, gaze);

    // Precisamos do dProxy que o extractor usa (cameraDistanceEstimate).
    // Chamamos extractCompactFeatures diretamente para obter advancedFeatures.face.
    const direct = extractCompactFeatures(lms);
    const dProxy = direct.advancedFeatures!.face.cameraDistanceEstimate;
    const expected = buildL2CSBlock(gaze.yaw, gaze.pitch, gaze.valid, dProxy);

    // Índice FIXO [37..43] — ver a nota sobre "os últimos 7" acima.
    for (let i = 0; i < L2CS_BLOCK_DIM; i++) {
      expect(result.featuresLeft[37 + i]).toBeCloseTo(expected[i], 12);
      expect(result.featuresRight[37 + i]).toBeCloseTo(expected[i], 12);
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

  it('diff de tamanho é o bloco L2CS mais o bloco spec11 de P6.5', () => {
    if (!USE_COMPACT_FEATURES) return;
    const lms = makeLandmarks();
    const off = extractFull(lms);
    const on = extractFull(lms, undefined, { yaw: 0, pitch: 0, valid: true });
    // 7 do bloco angular + 6 do bloco `spec11` (P6.5). Os dois são anexados
    // JUNTOS e sob a mesma condição — três dos seis termos do spec11 são
    // funções do gaze, e anexá-los sem gaze produziria constantes.
    const SPEC11_BLOCK_DIM = 6;
    expect(on.featuresLeft.length - off.featuresLeft.length).toBe(L2CS_BLOCK_DIM + SPEC11_BLOCK_DIM);
    expect(on.featuresRight.length - off.featuresRight.length).toBe(L2CS_BLOCK_DIM + SPEC11_BLOCK_DIM);
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

  it('vetor COMPLETO tem sempre 50 dims quando l2csGaze != null, independente de valid', () => {
    if (!USE_COMPACT_FEATURES) return;
    const lms = makeLandmarks();
    
    const withValid = extractFull(lms, undefined, { yaw: 0, pitch: 0, valid: true });
    expect(withValid.featuresLeft).toHaveLength(50);
    expect(withValid.featuresRight).toHaveLength(50);
    
    const withInvalid = extractFull(lms, undefined, { yaw: 0, pitch: 0, valid: false });
    expect(withInvalid.featuresLeft).toHaveLength(50);
    expect(withInvalid.featuresRight).toHaveLength(50);
  });
});


// ─── Projeção no conjunto de features ativo ─────────────────────────────────
describe('projeção do vetor no conjunto ativo', () => {
  it('a fronteira do pipeline entrega exatamente activeFeatureDims dims', () => {
    const lms = makeLandmarks();
    const piped = extractFeatures(lms, undefined, { yaw: 0.1, pitch: 0.05, valid: true });
    const dims = activeFeatureDims() as number;
    expect(piped.featuresLeft).toHaveLength(dims);
    expect(piped.featuresRight).toHaveLength(dims);
  });

  it('as dimensões entregues são as posições EXATAS do vetor completo (sem reordenar)', () => {
    // Reordenar silenciosamente seria o pior tipo de bug aqui: o modelo
    // treinaria e prediria com significados trocados, sem erro nenhum. Como
    // `irisCore+l2cs` seleciona índices [0,1,2,3, 37,38] (não é prefixo
    // contíguo), comparamos posição-a-posição via a mesma tabela que o
    // extractor usa.
    const lms = makeLandmarks();
    const full = extractCompactFeatures(lms, undefined, { yaw: 0.1, pitch: 0.05, valid: true });
    const piped = extractFeatures(lms, undefined, { yaw: 0.1, pitch: 0.05, valid: true });
    const dims = activeFeatureDims() as number;
    // Ativa hoje: irisCore(4) + tan(yaw), tan(pitch) = 6 dims nas posições
    // [0,1,2,3, 37,38] do vetor completo.
    const expectedIndices = [0, 1, 2, 3, 37, 38];
    expect(dims).toBe(expectedIndices.length);
    for (let i = 0; i < dims; i++) {
      expect(piped.featuresLeft[i]).toBe(full.featuresLeft[expectedIndices[i]]);
      expect(piped.featuresRight[i]).toBe(full.featuresRight[expectedIndices[i]]);
    }
  });

  it('o bloco L2CS influencia o vetor entregue ao modelo — é a razão de ligar', () => {
    // Antes o conjunto ativo era `irisCore` (só [0..3]) e o bloco angular era
    // descartado; com `irisCore+l2cs` as posições [4] e [5] carregam
    // tan(yaw) e tan(pitch), então a saída do L2CS chega ao Ridge. Este teste
    // é a inversão explícita da versão anterior.
    const lms = makeLandmarks();
    const comValido = extractFeatures(lms, undefined, { yaw: 0.2, pitch: 0.1, valid: true });
    const comInvalido = extractFeatures(lms, undefined, { yaw: 0, pitch: 0, valid: false });
    // Prefixo irisCore igual (depende só de landmarks).
    expect(comValido.featuresLeft.slice(0, 4)).toEqual(comInvalido.featuresLeft.slice(0, 4));
    // Sufixo angular diferente.
    expect(comValido.featuresLeft.slice(4)).not.toEqual(comInvalido.featuresLeft.slice(4));
    // Invalid vem zerado por buildL2CSBlock.
    expect(comInvalido.featuresLeft.slice(4)).toEqual([0, 0]);
    expect(comInvalido.featuresRight.slice(4)).toEqual([0, 0]);
  });

  it("projectFeatureSet('compact') é identidade", () => {
    const v = Array.from({ length: 50 }, (_, i) => i * 1.5);
    expect(projectFeatureSet(v, 'compact')).toEqual(v);
  });

  it('projectFeatureSet preserva vetor vazio (frame sem rosto)', () => {
    expect(projectFeatureSet([], 'iris12')).toEqual([]);
  });
});
