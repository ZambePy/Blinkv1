import { extractEyeFeatures, extractCompactFeatures } from './extractor';
import type { Point3D, AdvancedFrameFeatures, L2CSGazeInput } from './extractor';

export interface FeaturePipelineResult {
  featuresLeft:  number[];
  featuresRight: number[];
  blinkDetected: boolean;
  advancedFeatures?: AdvancedFrameFeatures;
  // Repassa EARs por olho (calculados no extractor) para o engine ponderar
  // a fusão binocular durante a inferência live.
  leftEAR?: number;
  rightEAR?: number;
}

// BUG-10: A correção de isotropicLandmarks era aplicada DUAS VEZES quando a
// flag estava ligada — uma aqui e outra dentro de extractEyeFeatures (chamado
// por extractCompactFeatures). O resultado: x *= aspectRatio², z *= aspectRatio².
// Isso impedia que a flag funcionasse corretamente. A correção fica APENAS
// dentro de extractEyeFeatures, que recebe videoWidth/videoHeight do caller.
import { EXPERIMENT } from './config/experiment';

export const USE_COMPACT_FEATURES = true;

export function extractFeatures(
  landmarks: Point3D[],
  faceMatrix?: Float32Array,
  l2csGaze?: L2CSGazeInput | null,
  videoWidth?: number,
  videoHeight?: number,
): FeaturePipelineResult {
  // extractEyeFeatures (path legado, USE_COMPACT_FEATURES=false) não recebe
  // L2CS por design — só o compact expõe o extension point; se um dia quiser
  // suportar no path full, adicionar aqui.
  //
  let workingLandmarks = landmarks;
  if (EXPERIMENT.isotropicLandmarks && videoWidth && videoHeight && videoHeight > 0) {
    const aspectRatio = videoWidth / videoHeight;
    workingLandmarks = landmarks.map(p => ({
      ...p,
      x: p.x * aspectRatio,
      z: p.z * aspectRatio,
    }));
  }

  const geo = USE_COMPACT_FEATURES
    ? extractCompactFeatures(workingLandmarks, faceMatrix, l2csGaze)
    : extractEyeFeatures(workingLandmarks, faceMatrix);

  return {
    featuresLeft: [...geo.featuresLeft],
    featuresRight: [...geo.featuresRight],
    blinkDetected: geo.blinkDetected,
    advancedFeatures: geo.advancedFeatures,
    leftEAR: geo.leftEAR,
    rightEAR: geo.rightEAR,
  };
}
