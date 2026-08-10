import { extractEyeFeatures, extractCompactFeatures } from './extractor';
import type { Point3D, AdvancedFrameFeatures } from './extractor';

export interface FeaturePipelineResult {
  featuresLeft:  number[];
  featuresRight: number[];
  blinkDetected: boolean;
  advancedFeatures?: AdvancedFrameFeatures;
}

export const USE_COMPACT_FEATURES = true;

export function extractFeatures(
  landmarks: Point3D[],
  faceMatrix?: Float32Array,
): FeaturePipelineResult {
  const geo = USE_COMPACT_FEATURES 
    ? extractCompactFeatures(landmarks, faceMatrix)
    : extractEyeFeatures(landmarks, faceMatrix);

  return {
    featuresLeft: [...geo.featuresLeft],
    featuresRight: [...geo.featuresRight],
    blinkDetected: geo.blinkDetected,
    advancedFeatures: geo.advancedFeatures,
  };
}
