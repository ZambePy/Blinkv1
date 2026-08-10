import { describe, it, expect } from 'vitest';
import { extractEyeFeatures, extractCompactFeatures } from './extractor';
import { extractFeatures, USE_COMPACT_FEATURES } from './featurePipeline';
import type { Point3D } from './extractor';

// Deterministic synthetic MediaPipe frame: 478 landmarks with unique non-degenerate
// coordinates (irrational multipliers ensure landmarks[33] ≠ landmarks[263], so
// the normalization path in extractor.ts always runs rather than short-circuiting).
function makeSyntheticLandmarks(): Point3D[] {
  return Array.from({ length: 478 }, (_, i) => ({
    x: 0.5 + 0.4 * Math.sin(i * 0.1357),
    y: 0.5 + 0.3 * Math.cos(i * 0.2137),
    z: 0.05 * Math.sin(i * 0.3577),
  }));
}

describe('featurePipeline: parity with the active extractor', () => {
  it('extractFeatures returns featuresLeft and featuresRight with identical length, order, and values to the underlying extractor', () => {
    const landmarks = makeSyntheticLandmarks();

    // Sprint 5 introduced USE_COMPACT_FEATURES: the pipeline routes to
    // extractCompactFeatures (~31 dims) when the flag is on, and to
    // extractEyeFeatures (~260 dims) otherwise. Parity is checked against
    // whichever path is currently active — a silent divergence between the
    // pipeline and its underlying extractor would break stored profiles.
    const direct = USE_COMPACT_FEATURES
      ? extractCompactFeatures(landmarks)
      : extractEyeFeatures(landmarks);
    const piped = extractFeatures(landmarks);

    // Length must match — a silent truncation or extension would break stored profiles
    expect(piped.featuresLeft.length).toBe(direct.featuresLeft.length);
    expect(piped.featuresRight.length).toBe(direct.featuresRight.length);

    // Element-by-element exact equality — any field reordering is a real bug:
    // profiles calibrated before the refactor encode dimensions in the original order,
    // and a mismatch here would cause silent wrong predictions without any visible error.
    for (let i = 0; i < direct.featuresLeft.length; i++) {
      expect(piped.featuresLeft[i]).toBe(direct.featuresLeft[i]);
    }
    for (let i = 0; i < direct.featuresRight.length; i++) {
      expect(piped.featuresRight[i]).toBe(direct.featuresRight[i]);
    }
  });
});
