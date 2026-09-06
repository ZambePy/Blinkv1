// Fronteira entre o extractor e o resto do pipeline: extrai o vetor completo e
// projeta no conjunto ativo. É aqui que se decide o que o modelo vê.

import {
  extractCompactFeatures,
  projectFeatureSet,
  activeFeatureDims,
  ACTIVE_FEATURE_SET,
  FEATURE_VECTOR_ID,
} from './extractor';
import type { Point3D, AdvancedFrameFeatures, L2CSGazeInput, FeatureSet, BlinkDetector } from './extractor';

export interface FeaturePipelineResult {
  featuresLeft: number[];
  featuresRight: number[];
  blinkDetected: boolean;
  advancedFeatures?: AdvancedFrameFeatures;
  leftEAR?: number;
  rightEAR?: number;
}

export function extractFeatures(
  landmarks: Point3D[],
  faceMatrix?: Float32Array,
  l2csGaze?: L2CSGazeInput | null,
  videoWidth?: number,
  videoHeight?: number,
  /** Conjunto a projetar. O app usa o ativo; o harness pode variar sobre a mesma gravação. */
  featureSet?: FeatureSet,
  /** Detector de piscada. Sem ele vale o singleton do módulo. */
  blinkDetector?: BlinkDetector,
): FeaturePipelineResult {
  const geo = extractCompactFeatures(landmarks, faceMatrix, l2csGaze, blinkDetector, videoWidth, videoHeight);

  const featuresLeft = projectFeatureSet(geo.featuresLeft, featureSet);
  const featuresRight = projectFeatureSet(geo.featuresRight, featureSet);

  // Segunda barreira de dimensão: se a projeção produzir um comprimento
  // diferente do que `FEATURE_VECTOR_ID` anuncia, um perfil salvo seria
  // carregado por uma sessão cujo vetor tem outra semântica.
  const esperado = activeFeatureDims(featureSet ?? ACTIVE_FEATURE_SET);
  if (typeof esperado === 'number') {
    if (featuresLeft.length > 0 && featuresLeft.length !== esperado) {
      throw new RangeError(
        `[featurePipeline] vetor esquerdo com ${featuresLeft.length} dims, ` +
        `mas o conjunto ativo declara ${esperado} (FEATURE_VECTOR_ID='${FEATURE_VECTOR_ID}').`,
      );
    }
    if (featuresRight.length > 0 && featuresRight.length !== esperado) {
      throw new RangeError(
        `[featurePipeline] vetor direito com ${featuresRight.length} dims, ` +
        `mas o conjunto ativo declara ${esperado} (FEATURE_VECTOR_ID='${FEATURE_VECTOR_ID}').`,
      );
    }
  }

  return {
    featuresLeft,
    featuresRight,
    blinkDetected: geo.blinkDetected,
    advancedFeatures: geo.advancedFeatures,
    leftEAR: geo.leftEAR,
    rightEAR: geo.rightEAR,
  };
}
