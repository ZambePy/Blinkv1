import { describe, it, expect } from 'vitest';
import { extractEyeFeatures, extractCompactFeatures, projectFeatureSet } from './extractor';
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
  // B1.1: both the extractor and the pipeline now REQUIRE the L2CS angular
  // block to be present, because the active feature set indexes into [37..38].
  // Passing no gaze used to yield a 37-dim vector that `projectFeatureSet`
  // returned intact — the silent corruption B1.1 fixes. Parity is still the
  // property under test here; the gaze is supplied to BOTH sides so the
  // comparison is apples-to-apples.
  const GAZE = { yaw: 0.14, pitch: -0.09, valid: true } as const;

  it('extractFeatures returns featuresLeft and featuresRight with identical length, order, and values to the underlying extractor', () => {
    const landmarks = makeSyntheticLandmarks();

    // USE_COMPACT_FEATURES: the pipeline routes to extractCompactFeatures
    // (~31 dims) when the flag is on, and to extractEyeFeatures (~260 dims)
    // otherwise. Parity is checked against whichever path is currently active
    // — a silent divergence between the pipeline and its underlying extractor
    // would break stored profiles.
    const direct = USE_COMPACT_FEATURES
      ? extractCompactFeatures(landmarks, undefined, GAZE)
      : extractEyeFeatures(landmarks);
    const piped = extractFeatures(landmarks, undefined, GAZE);

    // Parity is against the PROJECTION of the extractor onto the active set,
    // not the raw vector. Truncation is contract (see `ACTIVE_FEATURE_SET` in
    // extractor.ts); what remains a bug is the pipeline touching values or
    // ORDER.
    const expected = {
      left: projectFeatureSet(direct.featuresLeft),
      right: projectFeatureSet(direct.featuresRight),
    };

    expect(piped.featuresLeft.length).toBe(expected.left.length);
    expect(piped.featuresRight.length).toBe(expected.right.length);

    // Element-by-element exact equality — any field reordering is a real bug:
    // profiles calibrated before the refactor encode dimensions in the original order,
    // and a mismatch here would cause silent wrong predictions without any visible error.
    for (let i = 0; i < expected.left.length; i++) {
      expect(piped.featuresLeft[i]).toBe(expected.left[i]);
    }
    for (let i = 0; i < expected.right.length; i++) {
      expect(piped.featuresRight[i]).toBe(expected.right[i]);
    }
  });
});
