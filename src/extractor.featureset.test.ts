import { describe, it, expect } from 'vitest';
import { projectFeatureSet, activeFeatureDims, IRIS12_DIMS } from './extractor';

// O que se testa aqui é só que a projeção seleciona os índices certos do vetor
// completo. Qual conjunto é melhor não é questão de teste unitário: é questão
// de harness.
//
// Layout do vetor completo (ver o comentário grande em extractor.ts):
//   [0,1] offset · [2,3] rel · [4..11] contorno da íris · [12..19] cantos
//   [20] ear · [21] irisRadius · [22..24] yaw,pitch,roll · [25..36] interações

/** Vetor completo onde cada posição vale o próprio índice — assim o valor
 *  projetado denuncia de onde veio. */
const marcado = (n = 37) => Array.from({ length: n }, (_, i) => i);

describe('projectFeatureSet', () => {
  it('iris12 leva as 12 primeiras', () => {
    expect(projectFeatureSet(marcado(), 'iris12')).toEqual([0,1,2,3,4,5,6,7,8,9,10,11]);
  });

  it('iris12+pose acrescenta yaw, pitch e roll — e nada de cantos', () => {
    const v = projectFeatureSet(marcado(), 'iris12+pose');
    expect(v).toEqual([0,1,2,3,4,5,6,7,8,9,10,11, 22,23,24]);
    // Os cantos e ear/irisRadius seguem fora: a redução de 44→12 não está
    // sendo desfeita, só a pose está voltando.
    for (const descartado of [12,13,14,15,16,17,18,19,20,21]) {
      expect(v).not.toContain(descartado);
    }
  });

  it('iris12+posecross acrescenta as 6 interações de PRIMEIRA ordem', () => {
    const v = projectFeatureSet(marcado(), 'iris12+posecross');
    expect(v).toEqual([0,1,2,3,4,5,6,7,8,9,10,11, 22,23,24, 25,26,27,28,29,30]);
    // As de 2ª ordem [31..36] ficam de fora de propósito: 9 alvos restringem
    // mal 21 parâmetros, e termo quadrático é o primeiro a virar memorização.
    for (const quadratico of [31,32,33,34,35,36]) {
      expect(v).not.toContain(quadratico);
    }
  });

  it('compact devolve o vetor intacto', () => {
    const v = marcado(44);
    expect(projectFeatureSet(v, 'compact')).toBe(v);
  });

  it('vetor curto demais LANÇA em vez de degradar em silêncio (B1.1)', () => {
    // ATÉ B1.1 este teste afirmava o oposto: que o vetor curto passava intacto.
    // Esse era o bug. Devolver um vetor de 12 dims onde o conjunto declara 15
    // fazia o Ridge treinar com uma semântica que o `FEATURE_VECTOR_ID` não
    // descrevia — e um perfil gravado assim era aceito por uma sessão
    // incompatível, terminando em `clearCalibration()` no meio do uso.
    const curto = marcado(12);
    expect(() => projectFeatureSet(curto, 'iris12+pose')).toThrow(RangeError);
  });

  it('vetor VAZIO segue passando — é o frame sem rosto, tratado pelo caller', () => {
    // A única exceção legítima ao contrato de comprimento.
    expect(projectFeatureSet([], 'iris12+posecross')).toEqual([]);
    expect(projectFeatureSet([], 'iris12+pose')).toEqual([]);
  });

  it('iris12 aceita um vetor de exatamente 12 sem alterá-lo', () => {
    expect(projectFeatureSet(marcado(12), 'iris12')).toEqual(marcado(12));
  });
});

describe('activeFeatureDims', () => {
  it('reporta o tamanho real de cada conjunto', () => {
    expect(activeFeatureDims('iris12')).toBe(IRIS12_DIMS);
    expect(activeFeatureDims('iris12+pose')).toBe(15);
    expect(activeFeatureDims('iris12+posecross')).toBe(21);
    expect(activeFeatureDims('compact')).toBe('var');
  });

  it('bate com o que projectFeatureSet devolve — senão FEATURE_VECTOR_ID mente', () => {
    for (const set of ['iris12', 'iris12+pose', 'iris12+posecross'] as const) {
      expect(projectFeatureSet(marcado(), set).length).toBe(activeFeatureDims(set));
    }
  });
});
