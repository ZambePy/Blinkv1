import { describe, it, expect } from 'vitest';
import { projectFeatureSet, activeFeatureDims, ACTIVE_FEATURE_SET } from './extractor';
import { extractFeatures } from './featurePipeline';
import type { Point3D } from './extractor';

// -----------------------------------------------------------------------------
// B1.1 — `projectFeatureSet` devolvia 37 dimensões em vez de 6, em silêncio.
//
// Cadeia do defeito (registrada em tasks.md §Sprint 1):
//   `ACTIVE_FEATURE_SET = 'irisCore+l2cs'` seleciona [0,1,2,3,37,38] e exige
//   comprimento ≥ 39. O bloco L2CS (índices 37–43) só é anexado quando o engine
//   passa `l2csGaze != null`. Com `EXPERIMENT.enableL2CS = false` — acionável em
//   runtime por `__irisflowExp.set('enableL2CS', false)` — `l2csGaze` fica null
//   para sempre e o vetor tem 37 dims. O guard `if (full.length < MIN) return
//   full` deixava passar INTACTO.
//
// Consequência: Ridge treina com 37 dims (incluindo pose [22..24] e as 12
// interações [25..36] que a análise em extractor.ts:300-330 exclui de propósito
// por memorização — 322 px medidos contra 140 px). Com `polynomialFeatures`,
// ~740 features contra ~240 amostras. E `FEATURE_VECTOR_ID` continua gravando
// "irisCore+l2cs:6", então `buildContextKey()` produz a MESMA chave dos perfis
// de 6 dims: um perfil de 37 dims é aceito por uma sessão de 6, `predictRidge`
// lança RangeError no primeiro frame, `mapGaze` executa `clearCalibration()`
// e O PACIENTE PERDE A CALIBRAÇÃO NO MEIO DA SESSÃO.
//
// Correção: lançar quando o comprimento não bate, EXCETO para o vetor vazio
// (frame sem rosto, que o caller já trata).
// -----------------------------------------------------------------------------

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

describe('B1.1 — projectFeatureSet não pode degradar em silêncio', () => {
  it('lança quando o vetor é curto demais para o conjunto pedido', () => {
    // 37 dims (sem bloco L2CS) contra 'irisCore+l2cs' que exige 39.
    // Este é EXATAMENTE o cenário de `enableL2CS: false`.
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
    expect(projectFeatureSet([], 'iris12+posecross')).toEqual([]);
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

describe('B1.1 — o erro sobe até o featurePipeline em vez de virar vetor errado', () => {
  it('extractFeatures sem l2csGaze lança no PRIMEIRO frame, não silencia', () => {
    // Cenário do engine com `EXPERIMENT.enableL2CS = false`: `initL2CSAsync`
    // retorna antes de criar o client, o guard falha, `l2csGaze` fica null,
    // o extractor devolve 37 dims. Antes desta correção isso produzia um vetor
    // de 37 dims que o Ridge aceitava e treinava.
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
    // O bloco é anexado ZERADO quando inválido — é degradação graciosa
    // documentada (§E4). O que não pode acontecer é o bloco sumir.
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

describe('B1.1 — assertiva de dimensão no featurePipeline', () => {
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
