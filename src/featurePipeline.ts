import { extractEyeFeatures } from './extractor';
import type { Point3D } from './extractor';

export interface FeaturePipelineResult {
  featuresLeft: number[];
  featuresRight: number[];
  blinkDetected: boolean;
}

export function extractFeatures(
  landmarks: Point3D[],
  faceMatrix?: Float32Array
): FeaturePipelineResult {
  // Geometric features from extractor.ts — today the only source.
  // Future CNN embedding: compute embedding, then push into featuresLeft/Right below.
  const geo = extractEyeFeatures(landmarks, faceMatrix);

  const featuresLeft = [...geo.featuresLeft];
  const featuresRight = [...geo.featuresRight];

  return { featuresLeft, featuresRight, blinkDetected: geo.blinkDetected };
}
