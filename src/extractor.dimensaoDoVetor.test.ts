import { describe, it, expect } from 'vitest';
import { projectFeatureSet, activeFeatureDims, ACTIVE_FEATURE_SET } from './extractor';
import { extractFeatures } from './featurePipeline';
import type { Point3D } from './extractor';

// `projectFeatureSet` lança quando o vetor completo é curto demais para o
// conjunto pedido (ex.: 37 dims sem bloco L2CS contra 'irisCore+l2cs', que
// exige 39), em vez de devolver o vetor intacto — o que faria o Ridge treinar
// com 37 dims sob um FEATURE_VECTOR_ID de 6 e perder a calibração depois.
// Única exceção: o vetor vazio (frame sem rosto), que o caller já trata.

/** Vetor "marcado": v[i] === i. Facilita ver de onde cada dim veio. */
const marcado = (n: number) => Array.from({ length: n }, (_, i) => i);

/** Rosto sintético com os 478 landmarks que o extractor exige. Valores
 *  arbitrários mas determinísticos — o teste não mede geometria, só o
 *  contrato de comprimento do vetor projetado. */
function rostoSintetico(): Point3D[] {
  return Array.from({ length: 478 }, (_, i) => ({
    x: 0.5 + Math.sin(i * 0.7) * 0.02,
    y: 0.5 + Math.cos(i * 0.9) * 0.02,
    z: Math.sin(i * 0.3) * 0.01,
  }));
}

describe('projectFeatureSet não pode degradar em silêncio', () => {
  it('lança quando o vetor é curto demais para o conjunto pedido', () => {
    // 37 dims (sem bloco L2CS) contra 'irisCore+l2cs' que exige 39 — o
    // cenário de `enableL2CS: false`.
    expect(() => projectFeatureSet(marcado(37), 'irisCore+l2cs')).toThrow();
  });

  it('a mensagem de erro nomeia o conjunto, o esperado e o recebido', () => {
    // Sem esses três dados, o erro chega no console e ninguém sabe qual flag
    // desligar para reproduzir.
    let msg = '';
    try {
      projectFeatureSet(marcado(37), 'irisCore+l2cs');
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
    expect(msg).toContain('irisCore+l2cs');
    expect(msg).toContain('39');
    expect(msg).toContain('37');
  });

  it('o vetor VAZIO continua passando — frame sem rosto é do caller', () => {
    // Esta é a única exceção legítima. O engine trata `featuresLeft.length === 0`
    // no ramo de piscada/sem-rosto; transformar isso em exceção quebraria o
    // loop a cada frame sem rosto.
    expect(projectFeatureSet([], 'irisCore+l2cs')).toEqual([]);
    expect(projectFeatureSet([], 'irisCore')).toEqual([]);
  });

  it('vetor de comprimento exato continua projetando normalmente', () => {
    const v = projectFeatureSet(marcado(39), 'irisCore+l2cs');
    expect(v).toEqual([0, 1, 2, 3, 37, 38]);
  });

  it('vetor mais longo que o mínimo continua projetando normalmente', () => {
    const v = projectFeatureSet(marcado(44), 'irisCore+l2cs');
    expect(v).toEqual([0, 1, 2, 3, 37, 38]);
  });

  it("'compact' segue devolvendo o vetor intacto, de qualquer comprimento", () => {
    // `compact` não tem comprimento mínimo — é o vetor completo por definição.
    const curto = marcado(12);
    expect(projectFeatureSet(curto, 'compact')).toBe(curto);
  });
});

describe('o erro sobe até o featurePipeline em vez de virar vetor errado', () => {
  it('extractFeatures sem l2csGaze lança no PRIMEIRO frame, não silencia', () => {
    // Cenário do engine com `EXPERIMENT.enableL2CS = false`: `initL2CSAsync`
    // retorna antes de criar o client, `l2csGaze` fica null e o extractor
    // devolve 37 dims.
    const lm = rostoSintetico();
    expect(() => extractFeatures(lm, undefined, null, 1920, 1080)).toThrow();
  });

  it('extractFeatures COM l2csGaze válido devolve o vetor de 6 dims', () => {
    const lm = rostoSintetico();
    const r = extractFeatures(
      lm,
      undefined,
      { yaw: 0.12, pitch: -0.08, valid: true },
      1920,
      1080,
    );
    expect(r.featuresLeft).toHaveLength(6);
    expect(r.featuresRight).toHaveLength(6);
  });

  it('extractFeatures com l2csGaze {valid:false} também devolve 6 dims', () => {
    // O bloco é anexado ZERADO quando inválido — degradação graciosa. O que
    // não pode acontecer é o bloco sumir.
    const lm = rostoSintetico();
    const r = extractFeatures(
      lm,
      undefined,
      { yaw: 0, pitch: 0, valid: false },
      1920,
      1080,
    );
    expect(r.featuresLeft).toHaveLength(6);
  });

  it('frame sem rosto (menos de 478 landmarks) não lança — devolve vazio', () => {
    // Regressão importante: o guard de vetor vazio precisa continuar valendo
    // pelo caminho do pipeline inteiro, não só na função pura.
    const poucos: Point3D[] = Array.from({ length: 100 }, () => ({ x: 0, y: 0, z: 0 }));
    const r = extractFeatures(poucos, undefined, null, 1920, 1080);
    expect(r.featuresLeft).toEqual([]);
    expect(r.featuresRight).toEqual([]);
  });
});

describe('assertiva de dimensão no featurePipeline', () => {
  it('o vetor projetado sempre tem exatamente activeFeatureDims() dimensões', () => {
    // Trava o invariante que `FEATURE_VECTOR_ID` promete. Se algum dia a
    // projeção devolver comprimento diferente do que o ID anuncia, os perfis
    // salvos passam a ser aceitos por sessões incompatíveis (a cadeia que
    // termina em clearCalibration no meio da sessão).
    const lm = rostoSintetico();
    const r = extractFeatures(
      lm,
      undefined,
      { yaw: 0.1, pitch: -0.05, valid: true },
      1920,
      1080,
    );
    const esperado = activeFeatureDims(ACTIVE_FEATURE_SET);
    expect(r.featuresLeft).toHaveLength(esperado as number);
    expect(r.featuresRight).toHaveLength(esperado as number);
  });
});
