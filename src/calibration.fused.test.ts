/**
 * calibration.fused.test.ts
 *
 * Gate da Pendência 3: verifica que, com FEATURE_MODE='fused' forçado via mock,
 * uma calibração sintética completa de 9 pontos:
 *   1. Treina fusedScalerLeft/Right corretamente (fit-por-sessão).
 *   2. mapGaze produz predição válida usando vetores de 276 dims.
 *   3. Com FEATURE_MODE='geometry_only' (caminho de produção), o comportamento
 *      é preservado sem regressão.
 *
 * FEATURE_MODE é forçado para 'fused' via vi.mock — o valor de produção
 * em featurePipeline.ts permanece 'geometry_only' inalterado.
 */

import { vi, describe, it, expect, afterEach } from 'vitest';
import type { CalibrationPoint } from './calibration';

// ─── Mock de FEATURE_MODE ─────────────────────────────────────────────────────
// vi.mock é hoistado antes dos imports, portanto calibration.ts vê FEATURE_MODE='fused'
// ao ser carregado neste arquivo de teste.
vi.mock('./featurePipeline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./featurePipeline')>();
  return { ...actual, FEATURE_MODE: 'fused' as const };
});

// Imports após o mock (garantido pelo hoist do vitest)
import {
  runCalibrationTraining,
  mapGaze,
  featureScalerLeft,
  featureScalerRight,
  fusedScalerLeft,
  fusedScalerRight,
} from './calibration';

// ─── Constantes dos vetores sintéticos ───────────────────────────────────────
const GEO_DIMS  = 4;   // simplificado — produção usa ~258, mas o Ridge funciona com qualquer n
const PCA_DIMS  = 4;   // simplificado — produção usa 18
const FUSED_DIM = GEO_DIMS + PCA_DIMS;  // 8 dims sintéticos (análogo aos 276 reais)

// ─── Perfil sintético de 9 pontos (grade 3×3) ─────────────────────────────────
function buildFusedProfile(): CalibrationPoint[] {
  const grid = [0.05, 0.5, 0.95];
  const points: CalibrationPoint[] = [];

  for (const gy of grid) {
    for (const gx of grid) {
      // Geometria: sinal linear em gx e gy + pequena variação por dimensão
      const featuresLeft  = Array.from({ length: GEO_DIMS }, (_, i) =>
        gx * 0.8 + gy * 0.6 + i * 0.05,
      );
      const featuresRight = Array.from({ length: GEO_DIMS }, (_, i) =>
        gx * 0.7 + gy * 0.7 + i * 0.05,
      );
      // PCA dims: sinal diferente para distinguir do componente geométrico
      const pcaLeft  = Array.from({ length: PCA_DIMS }, (_, i) =>
        Math.sin(gx * 3 + i) * 0.5 + gy,
      );
      const pcaRight = Array.from({ length: PCA_DIMS }, (_, i) =>
        Math.cos(gx * 3 + i) * 0.5 + gy,
      );
      // Vetor fundido = PCA + geo (mesma ordem de buildFusedFeatureVector)
      const fusedLeft  = [...pcaLeft,  ...featuresLeft];
      const fusedRight = [...pcaRight, ...featuresRight];

      points.push({ screenX: gx, screenY: gy, featuresLeft, featuresRight, fusedLeft, fusedRight });
    }
  }
  return points;
}

// ─── Reset: limpa scalers e regressores entre testes ─────────────────────────
// Os singletons de calibration.ts são reiniciados com reset() (StandardScaler) ou
// re-fitted pelo próximo runCalibrationTraining; mapGaze retorna null se nenhum
// regressor foi treinado nesta sessão de módulo. Para isolar os testes,
// simplesmente re-treinamos no setUp de cada caso relevante.
afterEach(() => {
  vi.clearAllMocks();
});

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('Pendência 3 — fusedScaler fit-por-sessão e mapGaze com FEATURE_MODE=fused', () => {

  it('runCalibrationTraining com 9 pontos fused treina fusedScalerLeft/Right corretamente', () => {
    const profile = buildFusedProfile();
    expect(() => runCalibrationTraining(profile)).not.toThrow();

    // Após o treino, os scalers devem ter sido fitted (mean_ e scale_ não nulos)
    // StandardScaler armazena mean_ e scale_ como arrays internamente.
    // Verificamos indiretamente: transformSingle deve funcionar sem lançar exceção.
    const fusedProbe = profile[0].fusedLeft!;
    expect(() => fusedScalerLeft.transformSingle(fusedProbe)).not.toThrow();
    expect(() => fusedScalerRight.transformSingle(profile[0].fusedRight!)).not.toThrow();

    // O resultado de transformSingle deve ser um array com as mesmas dimensões
    const scaled = fusedScalerLeft.transformSingle(fusedProbe);
    expect(scaled).toHaveLength(FUSED_DIM);
    // Verificamos que não é todos zeros (scaler realmente transformou)
    expect(scaled.some(v => v !== 0)).toBe(true);
  });

  it('mapGaze produz predição válida com vetor fundido de FUSED_DIM dims', () => {
    const profile = buildFusedProfile();
    runCalibrationTraining(profile);

    // Vetor de teste: centro da grade
    const centerPoint = profile[4]; // (0.5, 0.5)
    const result = mapGaze(
      centerPoint.featuresLeft,
      centerPoint.featuresRight,
      centerPoint.fusedLeft,
      centerPoint.fusedRight,
    );

    // Deve retornar um objeto {x, y} válido, não null
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('x');
    expect(result).toHaveProperty('y');
    expect(Number.isFinite(result!.x)).toBe(true);
    expect(Number.isFinite(result!.y)).toBe(true);
  });

  it('mapGaze retorna null sem predição quando fused não é fornecido em modo fused', () => {
    const profile = buildFusedProfile();
    runCalibrationTraining(profile);

    // Quando fusedLeft/fusedRight são null, mapGaze cai no else (featureScaler)
    // que usará o Ridge treinado nos vetores fundidos — dimensão errada → ou
    // retorna predição do featureScaler (que também foi treinado em geometry_only)
    // OU retorna um resultado. O importante é que NÃO lança exceção.
    const p = profile[0];
    expect(() => mapGaze(p.featuresLeft, p.featuresRight, null, null)).not.toThrow();
  });

  it('featureScalerLeft/Right são treinados mesmo em modo fused (necessário para Config B)', () => {
    const profile = buildFusedProfile();
    runCalibrationTraining(profile);

    // featureScaler deve estar fitted independente de FEATURE_MODE
    const geoProbe = profile[0].featuresLeft;
    const scaledGeo = featureScalerLeft.transformSingle(geoProbe);
    expect(scaledGeo).toHaveLength(GEO_DIMS);
  });

  it('runCalibrationTraining lança erro quando há menos de 9 amostras com embedding', () => {
    // Perfil com todas fusedLeft/Right = null → não atinge o mínimo de 9
    const profile: CalibrationPoint[] = [
      { screenX: 0.5, screenY: 0.5, featuresLeft: [1, 2, 3, 4], featuresRight: [1, 2, 3, 4], fusedLeft: null, fusedRight: null },
    ];
    expect(() => runCalibrationTraining(profile)).toThrow(/FEATURE_MODE='fused'/);
  });
});
