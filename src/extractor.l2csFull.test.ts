import { describe, expect, it } from 'vitest';
import { activeFeatureDims, featureVectorId, l2csSlotsInSet, projectFeatureSet } from './extractor';

/** Vetor "marcado": v[i] === i, para ver de onde cada dimensão veio. */
const marcado = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("conjunto 'irisCore+l2csFull' (sprint S7)", () => {
  it('leva as quatro de íris e as SETE do bloco angular', () => {
    const v = projectFeatureSet(marcado(44), 'irisCore+l2csFull');
    expect(v).toEqual([0, 1, 2, 3, 37, 38, 39, 40, 41, 42, 43]);
    expect(activeFeatureDims('irisCore+l2csFull')).toBe(11);
  });

  it('inclui os produtos com a distância, que a expansão polinomial não recria', () => {
    // 39 e 40 são `tan yaw · d` e `tan pitch · d`. O grau 2 sobre {37,38} gera
    // 37², 38² e 37·38 — nunca 37·d. É essa a aposta desta ablação.
    const v = projectFeatureSet(marcado(44), 'irisCore+l2csFull');
    expect(v).toContain(39);
    expect(v).toContain(40);
    const curto = projectFeatureSet(marcado(44), 'irisCore+l2cs');
    expect(curto).not.toContain(39);
    expect(curto).not.toContain(40);
  });

  it('os slots do bloco angular apontam para as posições certas do vetor projetado', () => {
    // Posições 4..10 do vetor de 11 dimensões.
    expect(l2csSlotsInSet('irisCore+l2csFull')).toEqual([4, 5, 6, 7, 8, 9, 10]);
    // No conjunto curto, só duas.
    expect(l2csSlotsInSet('irisCore+l2cs')).toEqual([4, 5]);
  });

  it('a identidade do vetor muda — é o que invalida os perfis salvos', () => {
    expect(featureVectorId('irisCore+l2csFull')).toBe('irisCore+l2csFull:11');
    expect(featureVectorId('irisCore+l2csFull')).not.toBe(featureVectorId('irisCore+l2cs'));
  });

  it('vetor curto lança em vez de degradar em silêncio', () => {
    // 43 dims: falta a última do bloco. Aceitar isto treinaria 11 dimensões
    // sob um id que promete outra coisa.
    expect(() => projectFeatureSet(marcado(43), 'irisCore+l2csFull')).toThrow();
    expect(() => projectFeatureSet(marcado(39), 'irisCore+l2csFull')).toThrow();
  });

  it('vetor vazio (quadro sem rosto) continua devolvendo vazio', () => {
    expect(projectFeatureSet([], 'irisCore+l2csFull')).toEqual([]);
  });
});
