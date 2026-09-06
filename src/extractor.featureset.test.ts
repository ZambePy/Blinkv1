import { describe, it, expect } from 'vitest';
import { projectFeatureSet, activeFeatureDims } from './extractor';

// O que se testa aqui é só que a projeção seleciona os índices certos do vetor
// completo. Qual conjunto é melhor não é questão de teste unitário: é questão
// de harness.
//
// Layout do vetor completo (ver o comentário grande em extractor.ts):
//   [0,1] offset · [2,3] rel · [4..11] contorno da íris · [12..19] cantos
//   [20] ear · [21] irisRadius · [22..24] yaw,pitch,roll · [25..36] interações
//   [37..43] bloco L2CS

/** Vetor completo onde cada posição vale o próprio índice — assim o valor
 *  projetado denuncia de onde veio. */
const marcado = (n = 44) => Array.from({ length: n }, (_, i) => i);

describe('projectFeatureSet', () => {
  it('irisCore leva as 4 primeiras', () => {
    expect(projectFeatureSet(marcado(), 'irisCore')).toEqual([0, 1, 2, 3]);
  });

  it('irisCore+l2cs acrescenta só as duas dims angulares de 1ª ordem do L2CS', () => {
    const v = projectFeatureSet(marcado(), 'irisCore+l2cs');
    expect(v).toEqual([0, 1, 2, 3, 37, 38]);
    // Contorno, cantos, pose e interações seguem fora de propósito: a pose é
    // correlacionada com a ordem de coleta e viraria atalho para o Ridge.
    for (const descartado of [4, 12, 20, 21, 22, 23, 24, 25, 36, 39, 43]) {
      expect(v).not.toContain(descartado);
    }
  });

  it('compact devolve o vetor intacto', () => {
    const v = marcado(44);
    expect(projectFeatureSet(v, 'compact')).toBe(v);
  });

  it('vetor curto demais LANÇA em vez de degradar em silêncio', () => {
    // Devolver um vetor de 37 dims (sem o bloco angular) onde o conjunto
    // declara 6 fazia o Ridge treinar com uma semântica que o
    // `FEATURE_VECTOR_ID` não descrevia — e um perfil gravado assim era aceito
    // por uma sessão incompatível, terminando em `clearCalibration()` no meio
    // do uso.
    expect(() => projectFeatureSet(marcado(37), 'irisCore+l2cs')).toThrow(RangeError);
    expect(() => projectFeatureSet(marcado(3), 'irisCore')).toThrow(RangeError);
  });

  it('vetor VAZIO segue passando — é o frame sem rosto, tratado pelo caller', () => {
    // A única exceção legítima ao contrato de comprimento.
    expect(projectFeatureSet([], 'irisCore+l2cs')).toEqual([]);
    expect(projectFeatureSet([], 'irisCore')).toEqual([]);
  });

  it('irisCore aceita um vetor de exatamente 4 sem alterá-lo', () => {
    expect(projectFeatureSet(marcado(4), 'irisCore')).toEqual(marcado(4));
  });
});

describe('activeFeatureDims', () => {
  it('reporta o tamanho real de cada conjunto', () => {
    expect(activeFeatureDims('irisCore')).toBe(4);
    expect(activeFeatureDims('irisCore+l2cs')).toBe(6);
    expect(activeFeatureDims('compact')).toBe('var');
  });

  it('bate com o que projectFeatureSet devolve — senão FEATURE_VECTOR_ID mente', () => {
    for (const set of ['irisCore', 'irisCore+l2cs'] as const) {
      expect(projectFeatureSet(marcado(), set).length).toBe(activeFeatureDims(set));
    }
  });
});
