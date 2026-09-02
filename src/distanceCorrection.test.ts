import { describe, it, expect } from 'vitest';
import {
  applyDistanceCorrectionToFeatures,
  computeDistanceCorrectionRatio,
  IRIS_OFFSET_DIMS,
  OFFSET_INTERACTION_DIMS,
  MIN_DISTANCE_RATIO,
  MAX_DISTANCE_RATIO,
} from './distanceCorrection';

// Correção geométrica de distância câmera-rosto.
// Testes ancoram: identidade quando distância = calibração; escala esperada
// nas duas direções; guardas contra inputs patológicos.

// Vetor de 44 dims (base + pose linear + interações + L2CS block), preenchido
// com valores diagnósticos que permitem afirmar quais índices foram escalados
// e quais NÃO — cada índice guarda seu próprio valor (`i + 1`, começando em 1
// para diferenciar de 0-escalado-por-0-que-também-vira-0).
function synthVec(len = 44): number[] {
  return Array.from({ length: len }, (_, i) => i + 1);
}

describe('computeDistanceCorrectionRatio', () => {
  it('identidade quando distâncias são iguais', () => {
    expect(computeDistanceCorrectionRatio(0.6, 0.6)).toBe(1);
    expect(computeDistanceCorrectionRatio(1.234, 1.234)).toBe(1);
  });

  it('ratio > 1 quando o usuário está mais LONGE agora (current > ref)', () => {
    // Ex.: calibrou a d_ref = 1.0 e agora está a d = 1.5 → ratio = 1.5.
    expect(computeDistanceCorrectionRatio(1.5, 1.0)).toBeCloseTo(1.5, 10);
  });

  it('ratio < 1 quando o usuário está mais PERTO agora (current < ref)', () => {
    expect(computeDistanceCorrectionRatio(0.5, 1.0)).toBeCloseTo(0.5, 10);
  });

  it('clampa em MAX_DISTANCE_RATIO quando o usuário se afastou demais', () => {
    // 10× mais longe — o Ridge nunca viu esse regime na calibração; clampeia
    // ao invés de deixar o Ridge extrapolar com features fora do domínio.
    expect(computeDistanceCorrectionRatio(10, 1)).toBe(MAX_DISTANCE_RATIO);
  });

  it('clampa em MIN_DISTANCE_RATIO quando o usuário se aproximou demais', () => {
    expect(computeDistanceCorrectionRatio(0.1, 1)).toBe(MIN_DISTANCE_RATIO);
  });

  it('retorna 1 (sem correção) para inputs null/undefined', () => {
    expect(computeDistanceCorrectionRatio(null, 1)).toBe(1);
    expect(computeDistanceCorrectionRatio(1, null)).toBe(1);
    expect(computeDistanceCorrectionRatio(undefined, undefined)).toBe(1);
  });

  it('retorna 1 para inputs não-finitos', () => {
    expect(computeDistanceCorrectionRatio(NaN, 1)).toBe(1);
    expect(computeDistanceCorrectionRatio(1, NaN)).toBe(1);
    expect(computeDistanceCorrectionRatio(Infinity, 1)).toBe(1);
    expect(computeDistanceCorrectionRatio(1, Infinity)).toBe(1);
  });

  it('retorna 1 para distâncias absurdamente pequenas (proxy numericamente ruim)', () => {
    // 1/scale3D pode disparar quando scale3D ~ 0 (rosto tão pequeno na
    // imagem que a proxy explode); guarda contra esse regime.
    expect(computeDistanceCorrectionRatio(1e-10, 1)).toBe(1);
    expect(computeDistanceCorrectionRatio(1, 1e-10)).toBe(1);
  });

  it('rejeita distâncias negativas ou zero como não-físicas', () => {
    expect(computeDistanceCorrectionRatio(-1, 1)).toBe(1);
    expect(computeDistanceCorrectionRatio(0, 1)).toBe(1);
  });
});

describe('applyDistanceCorrectionToFeatures', () => {
  it('ratio = 1 → cópia identidade, sem mutação do input', () => {
    const input = synthVec();
    const snap = [...input];
    const out = applyDistanceCorrectionToFeatures(input, 1);
    expect(out).toEqual(snap);       // conteúdo igual
    expect(out).not.toBe(input);     // referência diferente (é slice)
    expect(input).toEqual(snap);     // input não foi mutado
  });

  it('ratio = 2 escala EXATAMENTE as dims de offset + interações de offset', () => {
    const input = synthVec();
    const out = applyDistanceCorrectionToFeatures(input, 2);
    const scaledIdx = new Set([...IRIS_OFFSET_DIMS, ...OFFSET_INTERACTION_DIMS]);
    for (let i = 0; i < input.length; i++) {
      if (scaledIdx.has(i)) {
        expect(out[i], `dim ${i} devia ser escalada`).toBeCloseTo(input[i] * 2, 12);
      } else {
        expect(out[i], `dim ${i} NÃO devia ser escalada`).toBe(input[i]);
      }
    }
  });

  it('ratio = 0.5 escala para baixo nas mesmas dims', () => {
    const input = synthVec();
    const out = applyDistanceCorrectionToFeatures(input, 0.5);
    const scaledIdx = new Set([...IRIS_OFFSET_DIMS, ...OFFSET_INTERACTION_DIMS]);
    for (let i = 0; i < input.length; i++) {
      if (scaledIdx.has(i)) {
        expect(out[i]).toBeCloseTo(input[i] * 0.5, 12);
      } else {
        expect(out[i]).toBe(input[i]);
      }
    }
  });

  it('L2CS block (indices 37..43) NÃO é escalado — opera em ângulos, invariante à distância', () => {
    const input = synthVec();
    const out = applyDistanceCorrectionToFeatures(input, 2);
    for (let i = 37; i < 44; i++) {
      expect(out[i], `L2CS dim ${i} não deve mudar`).toBe(input[i]);
    }
  });

  it('pose linear (indices 22..24) NÃO é escalada — ângulos de pose são independentes da distância', () => {
    const input = synthVec();
    const out = applyDistanceCorrectionToFeatures(input, 2);
    expect(out[22]).toBe(input[22]);
    expect(out[23]).toBe(input[23]);
    expect(out[24]).toBe(input[24]);
  });

  it('interações pose·scale sem offset (indices 35..36) NÃO são escaladas', () => {
    // O layout de `interactions` em extractor.ts termina com `pose.yaw *
    // pose.scale` e `pose.pitch * pose.scale` — sem offset como fator. A
    // correção geométrica não deve tocá-los.
    const input = synthVec();
    const out = applyDistanceCorrectionToFeatures(input, 2);
    expect(out[35]).toBe(input[35]);
    expect(out[36]).toBe(input[36]);
  });

  it('vetor curto (extractor legado, 37 dims sem L2CS) é bem tolerado', () => {
    const input = synthVec(37); // base + pose + interações, sem L2CS block
    const out = applyDistanceCorrectionToFeatures(input, 2);
    // Índices escalados até 34 (últimos de OFFSET_INTERACTION_DIMS).
    for (const idx of IRIS_OFFSET_DIMS) expect(out[idx]).toBeCloseTo(input[idx] * 2, 12);
    for (const idx of OFFSET_INTERACTION_DIMS) expect(out[idx]).toBeCloseTo(input[idx] * 2, 12);
    // Índices que iam além (37..43) simplesmente não existem — não crasha.
    expect(out).toHaveLength(37);
  });

  it('ratio não-finito → cópia idêntica (guarda defensiva contra bug do caller)', () => {
    const input = synthVec();
    const outNaN = applyDistanceCorrectionToFeatures(input, NaN);
    expect(outNaN).toEqual(input);
    const outInf = applyDistanceCorrectionToFeatures(input, Infinity);
    expect(outInf).toEqual(input);
  });

  it('vetor vazio devolve vetor vazio (sem crash)', () => {
    expect(applyDistanceCorrectionToFeatures([], 2)).toEqual([]);
  });

  it('sinal do offset é preservado (ratio positivo não muda direção do olhar)', () => {
    // Um usuário olhando para a ESQUERDA (offsetX < 0) deve continuar
    // olhando para a esquerda após correção — só a magnitude muda.
    const input = new Array(44).fill(0);
    input[0] = -0.3;  // offsetX
    input[1] = +0.2;  // offsetY
    const out = applyDistanceCorrectionToFeatures(input, 1.5);
    expect(out[0]).toBeCloseTo(-0.45, 12);
    expect(out[1]).toBeCloseTo(+0.30, 12);
  });
});
